const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');

test('não oferece horários fictícios quando a agenda falha', () => {
  assert.doesNotMatch(source, /let opcoesHorario = 'amanhã às 10h/);
  assert.match(source, /AGENDA TEMPORARIAMENTE INDISPONÍVEL PARA CONSULTA/);
  assert.match(source, /Não mencione, sugira nem invente horários/);
});

test('preserva o anúncio antes de iniciar o debounce', () => {
  const guardar = source.indexOf('if (anuncio) anuncioPendentePorLead.set(userPhone, anuncio);');
  const acumular = source.indexOf('mensagensPendentes[userPhone].push(userText);');
  assert.ok(guardar > 0);
  assert.ok(acumular > guardar);
});

test('limpeza da fila não cria rejeição secundária com finally', () => {
  const trecho = source.slice(
    source.indexOf('function processarComLock'),
    source.indexOf('function _naoEhSlotAtual')
  );
  assert.doesNotMatch(trecho, /proximo\.finally/);
  assert.match(trecho, /proximo\.then\(limpar, limpar\)/);
});

test('lead quente registra o painel antes de tentar o WhatsApp', () => {
  const trecho = source.slice(
    source.indexOf("if (userText && temIntencaoDeCompra"),
    source.indexOf('// Se o lead estava encerrado')
  );
  assert.ok(trecho.indexOf('await criarNotificacao') < trecho.indexOf('await enviarMensagem'));
  assert.match(trecho, /notificacao === 'existing'/);
});

// Bug real: a exclusão marcava deleted_at e o card sumia do Kanban, mas as
// tarefas, o histórico e as notas do lead continuavam aparecendo. Pior: o
// lembrete de tarefa por WhatsApp continuava cobrando o vendedor sobre um
// lead que ele tinha acabado de excluir.
test('lead na lixeira some de todas as leituras, não só do Kanban', () => {
  const semDeletado = /\(t\.lead_id IS NULL OR l\.deleted_at IS NULL\)/g;
  const ocorrencias = (source.match(semDeletado) || []).length;
  assert.ok(ocorrencias >= 4, `esperava o filtro em tasks (lista, lembrete, contadores, motivos de perda), achei ${ocorrencias}`);
  // histórico da conversa e log de anotações
  assert.match(source, /WHERE c\.lead_id = \$1 AND c\.client_id = \$2 AND l\.deleted_at IS NULL/);
  assert.match(source, /WHERE n\.lead_id = \$1 AND l\.client_id = \$2 AND l\.deleted_at IS NULL/);
  // BI de reuniões não pode contar reunião de lead excluído
  assert.match(source, /WHERE ma\.client_id = \$1 AND \(ma\.lead_id IS NULL OR l\.deleted_at IS NULL\)/);
});

test('exclusão definitiva alcança o que não tem CASCADE, menos o opt-out', () => {
  const trecho = source.slice(
    source.indexOf('async function excluirLeadDefinitivo'),
    source.indexOf('// DELETE /api/leads/:id — manda pra lixeira')
  );
  // chaveados por telefone: nenhum CASCADE chega neles
  assert.match(trecho, /DELETE FROM outbound_messages WHERE client_id = \$1 AND phone = \$2/);
  assert.match(trecho, /DELETE FROM bot_state WHERE client_id = \$1 AND phone = \$2/);
  // e o opt-out precisa sobreviver, senão o bot volta a escrever pra quem pediu pra parar
  assert.doesNotMatch(trecho, /DELETE FROM opt_outs/);
});

test('lead excluído que retorna começa com dados comerciais limpos', () => {
  const trecho = source.slice(
    source.indexOf('async function registrarLeadInicial'),
    source.indexOf('// Atualiza campos do lead no Postgres')
  );
  assert.match(trecho, /deleted_at = NULL/);
  assert.match(trecho, /name = EXCLUDED\.name, email = NULL, business_type = NULL/);
  assert.match(trecho, /score = NULL, close_probability = NULL, next_action = NULL/);
  assert.match(trecho, /scheduled_at = NULL, scheduled_at_ts = NULL/);
});

test('abertura usa nome do perfil sem pedir confirmação e não fica sem pergunta', () => {
  assert.match(source, /Considere o nome do perfil válido/);
  assert.match(source, /NÃO pergunte "posso te chamar de \$\{nomeDoWebhook\}\?"/);
  assert.match(source, /iniciandoNovaConversa && !conversaRetomada && !resposta\.includes\('\?'\)/);
  assert.match(source, /Me conta sobre a sua operação, o que você faz\?/);
});

test('lead que volta é reconhecido: histórico do banco é reidratado na memória', () => {
  // `conversas` só vive em memória e todo deploy do Railway zera o processo.
  // Sem reidratar, quem já está no CRM era recebido como desconhecido.
  assert.match(source, /async function carregarConversaDoBanco/);
  assert.match(source, /await carregarConversaDoBanco\(userPhone\)/);
  assert.match(source, /conversaRetomada = true/);
  // o papel gravado no painel é 'bot'; a API precisa de 'assistant'
  assert.match(source, /m\.role === 'bot' \|\| m\.role === 'assistant' \? 'assistant' : 'user'/);
  // lead na lixeira não volta a ser tratado como conhecido
  assert.match(source, /l\.deleted_at IS NULL/);
});

test('devolutiva não pode ser eco, e turno não repete a muleta do anterior', () => {
  // Visto em produção: "Entendi, você e sua secretária dividem o atendimento
  // na empresa de tecnologia" só devolve ao lead o que ele mesmo disse.
  assert.match(source, /ECO NÃO É DEVOLUTIVA/);
  assert.match(source, /se a frase só existe porque ele falou, é eco/);
  // O eco voltou justamente no turno de menos material ("sou eu mesmo")
  assert.match(source, /O TURNO MAIS DIFÍCIL é a resposta curta sobre quem atende/);
  assert.match(source, /Resposta curta do lead não te autoriza a devolver pouco/);
  assert.match(source, /REGRA DE ABERTURA DE TURNO/);
  assert.match(source, /nunca comece dois turnos seguidos com a mesma palavra/);
  // e a trava de código, porque instrução sozinha já falhou antes
  assert.match(source, /removerMuletaRepetida\(/);
  assert.match(source, /quebrasDeLinhaViramBaloes\(resposta\)/);
});

test('a cada dado que tira, o bot devolve algo, e demonstra o produto ao vivo', () => {
  // Lida da ótica do lead: perguntas em sequência sem devolutiva fazem ele
  // sentir que só ele trabalha, e é onde a conversa morre.
  assert.match(source, /REGRA DA TROCA JUSTA/);
  assert.match(source, /a cada informação que você TIRA do lead, DEVOLVA uma/);
  assert.match(source, /REGRA DA DEMONSTRAÇÃO AO VIVO/);
  assert.match(source, /você É o produto funcionando/);
});

test('pergunta de preço tem resposta com motivo, não esquiva', () => {
  assert.match(source, /"Quanto custa\? \/ Qual o valor\? \/ Qual o preço\?"/);
  assert.match(source, /NUNCA responda só "o especialista te fala"/);
  assert.match(source, /porque depende do tamanho do seu atendimento/);
});

test('confirmação do número é afirmação, para o turno ter uma pergunta só', () => {
  assert.match(source, /a confirmação do número é AFIRMAÇÃO, não pergunta/);
  assert.doesNotMatch(source, /Vou usar esse número mesmo pra contato, tá\?/);
});

test('a ponte usa 4 balões, com a pergunta isolada no último', () => {
  assert.match(source, /Responda em EXATAMENTE 4 partes separadas pelo marcador "\|\|\|"/);
  assert.match(source, /única etapa da conversa que usa 4 balões/);
  // As travas e o exemplo ficaram falando em 3 balões depois da v1.35.0, com
  // a pergunta na parte 3. O modelo obedeceu à trava, não ao cabeçalho: a
  // parte 4 saiu como sobra cortada ("É online, gratuita e sem") e a pergunta
  // sumiu. Roteiro que se contradiz é roteiro que o modelo resolve sozinho.
  assert.match(source, /SEMPRE os 4 balões separados por "\|\|\|"/);
  assert.match(source, /A parte 4 é OBRIGATÓRIA e termina em UMA ÚNICA pergunta/);
  assert.doesNotMatch(source, /SEMPRE os 3 balões/);
  assert.doesNotMatch(source, /A parte 3 termina em UMA ÚNICA pergunta/);
  // "corte palavra" era licença explícita pra entregar frase pela metade
  assert.doesNotMatch(source, /corte palavra em vez de criar outro balão/);
  assert.match(source, /NUNCA entregue um balão pela metade/);
  assert.match(source, /a prova ao vivo, ligando o tempo de resposta que ELE acabou de receber/);
  // "Acho que vale" (consultor dando opinião) em vez de "Ia te sugerir"
  // (recuo na hora do fechamento) ou "Vou te sugerir" (anuncia em vez de fazer).
  assert.match(source, /Acho que vale uma conversa com um especialista/);
  assert.doesNotMatch(source, /[Ii]a te sugerir/);
});

test('qualificação tem três dados obrigatórios e portão de saída', () => {
  // A estrutura antiga tinha 9 etapas, 3 delas "opcionais", sem critério de
  // conclusão: o modelo decidia sozinho quando propor a reunião.
  assert.match(source, /2\. QUALIFICAÇÃO: OS TRÊS DADOS OBRIGATÓRIOS/);
  assert.match(source, /DADO 1, o que o lead faz/);
  assert.match(source, /DADO 2, como ele atende hoje/);
  assert.match(source, /DADO 3, a dor principal/);
  assert.match(source, /PORTÃO DE SAÍDA/);
  // urgência deixa de ser pergunta e passa a ser deduzida
  assert.match(source, /URGÊNCIA: não pergunte, deduza/);
  // a pergunta longa que o lead ignorou 4 vezes não pode voltar
  assert.doesNotMatch(source, /pergunte sobre a operação, por exemplo/);
});

test('balão cortado e ponte sem pergunta são consertados antes do envio', () => {
  // Instrução no roteiro não basta: o lead não pode ver frase pela metade
  // nem ficar sem saber o que responder.
  assert.match(source, /balaoCortadoNoMeio\(ultimoBalao\)/);
  assert.match(source, /if \(ateFraseCompleta\) partesResposta\[partesResposta\.length - 1\] = ateFraseCompleta;/);
  assert.match(source, /apresentaConversa && !resposta\.includes\('\?'\)/);
  assert.match(source, /\|\|\|Quer que eu veja um horário\?/);
  // sem isso não dá pra distinguir "terminou" de "bateu no teto de tokens"
  assert.match(source, /stop_reason: \$\{response\.data\.stop_reason\}/);
});

test('portão de qualificação é trava de código, não só instrução', () => {
  assert.match(source, /propoeReuniao\(resposta\) && \(!negocioConhecido \|\| !dorConhecidaAgora\)/);
  assert.match(source, /NÃO proponha reunião, conversa com especialista nem horário nesta mensagem/);
});

test('CTA "testar a IA" da bio vira origem própria, separada do Instagram comum', () => {
  // Precisa ser checada ANTES do Instagram genérico, senão nunca dispara.
  const posTeste = source.indexOf("origemLead = 'Instagram (teste)'");
  const posGenerico = source.indexOf("origemLead = 'Instagram';");
  assert.ok(posTeste > 0, 'origem Instagram (teste) não existe');
  assert.ok(posTeste < posGenerico, 'a origem de teste precisa ser avaliada antes da genérica');
  // Exige Instagram E intenção de testar: "quero testar" sozinho não é dessa origem.
  assert.match(source, /\/instagram\/\.test\(textoInicial\) && \/testar a ia\|testar o bot\|quero testar\|teste uma conversa\//);
  assert.match(source, /LEAD QUE VEIO TESTAR/);
});

test('cada origem tem abertura própria, terminando na mesma pergunta', () => {
  assert.match(source, /LEAD INDICADO/);
  assert.match(source, /LEAD QUE CHEGOU \$\{canal\.toUpperCase\(\)\}/);
  assert.match(source, /const PERGUNTA_DADO_2 = 'Hoje quem responde o WhatsApp aí, é você mesmo\?'/);
  // Indicação, Site/Instagram e o caso com nome usam a MESMA pergunta final:
  // a origem muda como se chega, não o que se precisa saber.
  const usos = source.split('${PERGUNTA_DADO_2}').length - 1;
  assert.ok(usos >= 3, `PERGUNTA_DADO_2 deveria ser usada em 3+ aberturas, usada em ${usos}`);
});

test('não repete pergunta que o lead não respondeu, nem na conversa nem no follow-up', () => {
  // Visto em produção: o segmento foi perguntado 4 vezes seguidas (abertura,
  // 2 follow-ups e a resposta a uma dúvida). É o que mais denuncia robô.
  assert.match(source, /REGRA DE NÃO INSISTIR NA MESMA PERGUNTA/);
  assert.match(source, /NÃO repita aquela pergunta, nem reformulada com outras palavras/);
});

test('pergunta direta do lead é respondida antes de qualquer qualificação', () => {
  assert.match(source, /REGRA DE RESPONDER ANTES DE PERGUNTAR/);
  assert.match(source, /Informação não é moeda de troca/);
});

test('quebra em balões continua liberada depois da abertura', () => {
  // O roteiro dizia "a partir da segunda mensagem, responda sem o |||", o que
  // anulava a regra de tamanho: toda resposta virava um balão único e longo.
  assert.doesNotMatch(source, /responda normalmente sem o marcador/);
  assert.match(source, /o marcador "\|\|\|" continua valendo para a conversa inteira/);
  assert.match(source, /QUEBRE em balões com "\|\|\|"/);
});

test('roteiro não usa travessão no próprio corpo, só na regra que o proíbe', () => {
  // O modelo aprende por exemplo: um roteiro cheio de travessões ensina a usar
  // travessão, por mais que uma linha mande não usar.
  const inicio = source.indexOf('REGRA DE SAUDAÇÃO:');
  const fim = source.indexOf('Montar a mensagem do usuário');
  assert.ok(inicio > 0 && fim > inicio, 'não localizou o bloco do roteiro');
  const comTravessao = source.slice(inicio, fim)
    .split('\n')
    .filter(l => l.includes('—') && !l.includes('NUNCA use travessão'));
  assert.deepEqual(comTravessao, [], `linhas do roteiro ainda usam travessão:\n${comTravessao.join('\n')}`);
});

test('texto que menciona anúncio recebe a abertura especial mesmo sem referral da Meta', () => {
  assert.match(source, /\$\{origemLead === 'Anúncio' \?/);
});

// Conversa real (06/08 19:33): o bot perguntou "qual é o seu negócio?" e no
// turno seguinte disse "já tinha visto aqui que você trabalha com tecnologia".
test('segmento conhecido não é esquecido entre turnos, nem anunciado ao lead', () => {
  assert.match(source, /agendamentos\[userPhone\]\?\.tipoNegocioGravado/);
  assert.match(source, /NUNCA anuncie que já o tinha/);
  assert.match(source, /nada de "já tinha visto aqui"/);
});

// A confirmação é a mensagem mais importante da conversa e vinha como um
// parágrafo único com o link do Meet no meio.
test('confirmação do agendamento chega em balões, sem balão de espera antes', () => {
  assert.match(source, /const enviarEmBaloes = async \(partes\)/);
  assert.match(source, /O link da reunião é esse: \$\{meetLink\}`,/);
  // o comentário que explica a remoção cita a frase, então a asserção olha o ENVIO
  assert.doesNotMatch(source, /enviarERegistrar\(userPhone, 'Um segundo/);
});

// O lead disse "até lá" e recebeu a data e a hora de volta, por extenso.
test('despedida após fechar a reunião não reabre a conversa', () => {
  // A guarda lê agendamentosConfirmados. Gravar agendadoEm em agendamentos[]
  // passava numa asserção solta e não fazia nada em produção: o lead disse
  // "Combinado" e recebeu a data e a hora de volta mesmo assim. Por isso o
  // teste agora exige o campo DENTRO do objeto certo.
  assert.match(source, /const ag = agendamentosConfirmados\[userPhone\]/);
  const bloco = source.slice(
    source.indexOf('agendamentosConfirmados[userPhone] = {'),
    source.indexOf('// Atualizar banco com os dados do agendamento')
  );
  assert.ok(bloco.length > 0, 'não localizou o bloco de agendamento confirmado');
  assert.match(bloco, /agendadoEm: Date\.now\(\)/);
  assert.match(source, /Math\.max\(ag\.presencaConfirmadaEm \|\| 0, ag\.agendadoEm \|\| 0\)/);
});

// "X (horário de Brasília) ou Y (horário de Brasília)" na mesma frase.
test('fuso é citado uma vez por mensagem, não uma vez por horário', () => {
  assert.match(source, /const labelSemFuso = slot =>/);
  assert.match(source, /labelCurto: `\$\{nomeDia\} às \$\{horaBrasilia\}h`/);
  const paresCrus = (source.match(/\$\{\w+(?:\[0\]|\.rows\[0\])?\.label\} ou \$\{/g) || []);
  assert.deepEqual(paresCrus, [], `ainda há par de horários citando o fuso duas vezes:\n${paresCrus.join('\n')}`);
});

// Loop real em produção: três respostas seguidas com as MESMAS duas opções.
// Os bugs de data que causaram aquilo foram corrigidos, mas um dia
// genuinamente cheio traz o mesmo impasse.
test('não repete as mesmas alternativas de agenda duas vezes seguidas', () => {
  assert.match(source, /const ofertaDeAlternativas = async \(prefixo, alternativas\)/);
  assert.match(source, /if \(ag\.ultimaOfertaRepetida === chave\)/);
  assert.match(source, /Me diz um dia da semana que vem que eu procuro por lá/);
  // oferta boa zera o impasse, senão o lead ficaria preso na frase de saída
  assert.match(source, /const limparRepeticao = \(\) =>/);
  // e as duas frases de fallback com 2 opções passam pelo guarda, não pelo envio direto
  const trecho = source.slice(
    source.indexOf('const matchVerificar = resposta.match'),
    source.indexOf('await persistirLead(userPhone);', source.indexOf('const matchVerificar = resposta.match'))
  );
  assert.doesNotMatch(trecho, /enviarERegistrar\(userPhone, `Nesse dia eu não tenho horário livre\. As opções/);
  assert.doesNotMatch(trecho, /enviarERegistrar\(userPhone, `Nesse horário eu não tenho disponibilidade\. As opções/);
});

test('remarcação sincroniza próxima ação e limpa o estado transitório', () => {
  const trecho = source.slice(
    source.indexOf('async function tratarPosAgendamento'),
    source.indexOf('// Despedidas simples logo após a confirmação')
  );
  assert.match(trecho, /'PróximaAçãoEm': escolhido\.inicio/);
  assert.match(trecho, /delete ag\.remarcandoDesde/);
  assert.match(trecho, /ag\.remarcacaoTentativas = 0/);
  assert.match(trecho, /confirmouOpcaoUnica\(userText\)/);
  assert.doesNotMatch(trecho, /'Temperatura':/);
});

test('pedido de remarcação acolhe o imprevisto e usa o primeiro nome', () => {
  assert.match(source, /const primeiroNome = String\(ag\.nome \|\| ''\)/);
  assert.match(source, /Sem problema, \$\{primeiroNome\}! Imprevistos acontecem\./);
});
