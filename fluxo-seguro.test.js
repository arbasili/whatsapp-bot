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
