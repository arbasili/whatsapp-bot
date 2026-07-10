// Testes das heurísticas de interpretação de texto (npm test → node --test).
// Cobrem principalmente os casos que já causaram bugs reais em conversa.
const { test } = require('node:test');
const assert = require('node:assert');
const {
  textoDoConteudo,
  escolherSlot,
  extrairNomeLead,
  extrairUrgencia,
  extrairTipoNegocio,
  extrairDorLead,
  interpretarRespostaEmail,
  mesclarTurnosConsecutivos,
  querPararRemarcacao,
  querAdiarRemarcacao,
  interpretarDataTarefa,
} = require('./heuristicas');

// Monta uma conversa mínima: roteiro + ack + turnos reais
function conversaCom(...msgsUsuario) {
  const conversa = [
    { role: 'user', content: '(roteiro do sistema)' },
    { role: 'assistant', content: 'Entendido.' },
  ];
  for (const msg of msgsUsuario) {
    conversa.push({ role: 'user', content: msg });
    conversa.push({ role: 'assistant', content: 'ok' });
  }
  return conversa;
}

// Slots de exemplo: terça 10h e quarta 15h (nenhum em segunda-feira, de propósito —
// vários testes verificam que "segunda" em outro sentido não vira escolha da opção 2)
const slots = [
  { label: 'terça-feira, 7 de julho às 10h (horário de Brasília)', inicio: '2026-07-07T13:00:00.000Z' },
  { label: 'quarta-feira, 8 de julho às 15h (horário de Brasília)', inicio: '2026-07-08T18:00:00.000Z' },
];

// ─── escolherSlot: escolhas legítimas ────────────────────────────────────────

test('escolhe por dia da semana', () => {
  assert.strictEqual(escolherSlot('pode ser quarta', slots), slots[1]);
});

test('escolhe por dia do mês', () => {
  assert.strictEqual(escolherSlot('dia 7 fica bom pra mim', slots), slots[0]);
});

test('escolhe por hora com "as"', () => {
  assert.strictEqual(escolherSlot('pode as 15', slots), slots[1]);
});

test('escolhe por hora com sufixo h', () => {
  assert.strictEqual(escolherSlot('10h tá ótimo', slots), slots[0]);
});

test('escolhe por ordinal explícito: "a primeira"', () => {
  assert.strictEqual(escolherSlot('pode ser a primeira', slots), slots[0]);
});

test('escolhe por ordinal explícito: "opção 2"', () => {
  assert.strictEqual(escolherSlot('a opção 2 é melhor', slots), slots[1]);
});

test('escolhe por ordinal explícito: "o segundo"', () => {
  assert.strictEqual(escolherSlot('prefiro o segundo', slots), slots[1]);
});

test('escolhe por número solto como mensagem inteira', () => {
  assert.strictEqual(escolherSlot('2', slots), slots[1]);
  assert.strictEqual(escolherSlot('1', slots), slots[0]);
});

test('escolhe com "a segunda" quando nenhum slot é segunda-feira', () => {
  assert.strictEqual(escolherSlot('a segunda', slots), slots[1]);
});

test('escolhe segunda-feira quando há slot nesse dia', () => {
  const comSegunda = [
    { label: 'segunda-feira, 6 de julho às 9h (horário de Brasília)' },
    { label: 'terça-feira, 7 de julho às 14h (horário de Brasília)' },
  ];
  assert.strictEqual(escolherSlot('pode ser segunda', comSegunda), comSegunda[0]);
});

// ─── escolherSlot: falsos positivos que já causaram bug ──────────────────────

test('NÃO escolhe quando "segunda" é o dia que o lead recusou', () => {
  assert.strictEqual(escolherSlot('segunda não posso, prefiro outro dia', slots), null);
});

test('NÃO escolhe quando "segunda-feira" aparece negada', () => {
  assert.strictEqual(escolherSlot('a segunda-feira não dá pra mim', slots), null);
});

test('NÃO escolhe quando "primeiro" é conectivo de frase', () => {
  assert.strictEqual(escolherSlot('primeiro preciso falar com meu sócio', slots), null);
});

test('NÃO confunde quantidade com horário em texto curto', () => {
  assert.strictEqual(escolherSlot('são 10 pessoas', slots), null);
  assert.strictEqual(escolherSlot('15 clientes por dia', slots), null);
});

test('NÃO escolhe nada em confirmação vaga sem horário', () => {
  assert.strictEqual(escolherSlot('pode ser sim', slots), null);
});

// ─── extrairNomeLead ─────────────────────────────────────────────────────────

function conversaBase(...turnos) {
  return [
    { role: 'user', content: '(roteiro do sistema)' },
    { role: 'assistant', content: 'Entendido. Estou pronto.' },
    ...turnos,
  ];
}

test('extrai nome de resposta direta', () => {
  const conversa = conversaBase(
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'Olá!|||Sou o Lucas, do time da Clique e Fecha.|||Qual o seu nome?' },
    { role: 'user', content: 'Me chamo Adriano' },
    { role: 'assistant', content: 'Adriano, me conta sobre a sua operação?' },
  );
  assert.strictEqual(extrairNomeLead(conversa), 'Adriano');
});

test('extrai nome sugerido quando o lead confirma "pode sim"', () => {
  const conversa = conversaBase(
    { role: 'user', content: 'boa tarde' },
    { role: 'assistant', content: 'Boa tarde!|||Sou o Lucas.|||Posso te chamar de Bruna?' },
    { role: 'user', content: 'pode sim' },
    { role: 'assistant', content: 'Bruna, me conta sobre o seu negócio?' },
  );
  assert.strictEqual(extrairNomeLead(conversa), 'Bruna');
});

test('não extrai nome do próprio roteiro do sistema', () => {
  const conversa = conversaBase(
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'Olá! Tudo bem?' },
  );
  assert.strictEqual(extrairNomeLead(conversa), '');
});

// ─── extrairUrgencia ─────────────────────────────────────────────────────────

test('não detecta urgência nas primeiras mensagens (contexto casual)', () => {
  const conversa = [
    { role: 'user', content: '(roteiro)' },
    { role: 'assistant', content: 'ack' },
    { role: 'user', content: 'oi, hoje tá corrido' },
    { role: 'assistant', content: 'Qual o seu nome?' },
    { role: 'user', content: 'João' },
  ];
  assert.strictEqual(extrairUrgencia(conversa), null);
});

test('detecta urgência imediata a partir da 4ª mensagem do lead', () => {
  const conversa = [
    { role: 'user', content: '(roteiro)' },
    { role: 'assistant', content: 'ack' },
    { role: 'user', content: 'oi' },
    { role: 'user', content: 'João' },
    { role: 'user', content: 'tenho um pet shop' },
    { role: 'user', content: 'tô perdendo cliente agora, preciso resolver urgente' },
  ];
  assert.strictEqual(extrairUrgencia(conversa), 'imediata');
});

// ─── extrairTipoNegocio / extrairDorLead: roteiro não pode vazar pro CRM ─────
// Bug real: no início da conversa, o roteiro (primeira mensagem com role user)
// entrava na varredura e o painel mostrava Segmento "duas opções disponíveis:
// sexta-feira, 3" e Dor "Você é o Lucas, do time de atendimento..."

const ROTEIRO_FAKE = 'Você é o Lucas, do time de atendimento da Clique e Fecha. Tenho duas opções disponíveis: sexta-feira, 3 de julho às 15h ou segunda às 10h. Isso está te gerando problema agora ou algo urgente?';

test('não extrai tipo de negócio do próprio roteiro no início da conversa', () => {
  const conversa = [
    { role: 'user', content: ROTEIRO_FAKE },
    { role: 'assistant', content: 'Entendido. Estou pronto.' },
    { role: 'user', content: 'Boa tarde' },
    { role: 'assistant', content: 'Boa tarde!|||Sou o Lucas.|||Posso te chamar de Adriano?' },
    { role: 'user', content: 'Pode sim' },
  ];
  assert.strictEqual(extrairTipoNegocio(conversa), null);
});

test('não extrai dor do próprio roteiro no início da conversa', () => {
  const conversa = [
    { role: 'user', content: ROTEIRO_FAKE },
    { role: 'assistant', content: 'Entendido. Estou pronto.' },
    { role: 'user', content: 'Boa tarde' },
    { role: 'assistant', content: 'Posso te chamar de Adriano?' },
    { role: 'user', content: 'Pode sim' },
  ];
  assert.strictEqual(extrairDorLead(conversa), null);
});

test('não detecta urgência com palavras do roteiro ("agora", "urgente")', () => {
  const conversa = [
    { role: 'user', content: ROTEIRO_FAKE },
    { role: 'assistant', content: 'Entendido.' },
    { role: 'user', content: 'oi' },
    { role: 'user', content: 'Adriano' },
    { role: 'user', content: 'tenho uma clínica' },
  ];
  assert.strictEqual(extrairUrgencia(conversa), null);
});

test('continua extraindo tipo de negócio de mensagem real do lead', () => {
  const conversa = [
    { role: 'user', content: ROTEIRO_FAKE },
    { role: 'assistant', content: 'Entendido.' },
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'O que você faz?' },
    { role: 'user', content: 'tenho um pet shop aqui no bairro' },
  ];
  assert.strictEqual(extrairTipoNegocio(conversa), 'um pet shop aqui no bairro');
});

// ─── extrairUrgencia: "hoje"/"agora" casuais não são urgência ────────────────
// Bug real: "hoje tem alguns anúncios no instagram..." marcou o lead como
// urgência imediata — mas "hoje" ali significa "atualmente", induzido pela
// própria pergunta do roteiro ("E hoje, como funciona o seu atendimento?")

test('não marca urgência por "hoje" casual descrevendo a operação', () => {
  const conversa = conversaCom(
    'oi', 'Adriano', 'tenho um escritório',
    'hoje tem alguns anuncios no instagram e traz lead no meu whats para eu atender',
    'as vezes consigo recuperar, mas as vezes ele para de responder'
  );
  assert.strictEqual(extrairUrgencia(conversa), null);
});

test('marca urgência imediata com intenção explícita', () => {
  const conversa = conversaCom(
    'oi', 'Adriano', 'tenho um petshop',
    'preciso resolver isso agora, é urgente'
  );
  assert.strictEqual(extrairUrgencia(conversa), 'imediata');
});

test('marca próximos dias com "essa semana"', () => {
  const conversa = conversaCom(
    'oi', 'Adriano', 'tenho um petshop',
    'queria deixar isso funcionando essa semana'
  );
  assert.strictEqual(extrairUrgencia(conversa), 'próximos dias');
});

// ─── extrairDorLead: só mensagens com sinal de dor ───────────────────────────
// Bug real: a descrição do negócio ("eu tenho um escritório de recuperação de
// crédito") aparecia como "Dor relatada" no CRM

test('descrição do negócio sem problema não vira dor', () => {
  const conversa = conversaCom('oi', 'eu tenho um escritório de recuperação de crédito');
  assert.strictEqual(extrairDorLead(conversa), null);
});

test('captura dor real e ignora a descrição do negócio', () => {
  const conversa = conversaCom(
    'eu tenho um escritório de recuperação de crédito',
    'quando estou em atendimento o lead demora a ser atendido',
    'as vezes ele para de responder'
  );
  const dor = extrairDorLead(conversa);
  assert.ok(dor.includes('demora'));
  assert.ok(dor.includes('para de responder'));
  assert.ok(!dor.includes('recuperação de crédito'));
});

test('dor longa é cortada em limite de palavra, não no meio', () => {
  const longa = 'o problema é que ' + 'os clientes reclamam da demora e vão embora sem resposta '.repeat(6);
  const conversa = conversaCom('oi', longa);
  const dor = extrairDorLead(conversa);
  assert.ok(dor.length <= 200);
  assert.ok(!dor.endsWith(' '));
  // não termina em palavra picotada: o último token deve ser palavra completa do texto
  const ultimaPalavra = dor.split(' ').pop();
  assert.ok(longa.includes(ultimaPalavra));
});

// ─── interpretarRespostaEmail ────────────────────────────────────────────────

test('confirmações simples de email', () => {
  assert.strictEqual(interpretarRespostaEmail('sim'), 'confirmou');
  assert.strictEqual(interpretarRespostaEmail('tá certinho!'), 'confirmou');
  assert.strictEqual(interpretarRespostaEmail('isso mesmo'), 'confirmou');
  assert.strictEqual(interpretarRespostaEmail('pode ser'), 'confirmou');
});

test('confirmações com "está" (bug real: não era reconhecido e nada era agendado)', () => {
  assert.strictEqual(interpretarRespostaEmail('está'), 'confirmou');
  assert.strictEqual(interpretarRespostaEmail('está certo'), 'confirmou');
  assert.strictEqual(interpretarRespostaEmail('está certinho!'), 'confirmou');
  assert.strictEqual(interpretarRespostaEmail('uhum'), 'confirmou');
  assert.strictEqual(interpretarRespostaEmail('exatamente'), 'confirmou');
});

test('negações de email', () => {
  assert.strictEqual(interpretarRespostaEmail('não, tá errado'), 'negou');
  assert.strictEqual(interpretarRespostaEmail('errei uma letra'), 'negou');
  assert.strictEqual(interpretarRespostaEmail('escrevi errado'), 'negou');
});

test('resposta ambígua não confirma nem nega', () => {
  assert.strictEqual(interpretarRespostaEmail('quanto custa a reunião?'), null);
  assert.strictEqual(interpretarRespostaEmail('vocês mandam convite?'), null);
  assert.strictEqual(interpretarRespostaEmail(''), null);
});

// ─── mesclarTurnosConsecutivos ───────────────────────────────────────────────

test('mescla assistants consecutivos preservando alternância', () => {
  const resultado = mesclarTurnosConsecutivos([
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'Fechado, tá marcado!' },
    { role: 'assistant', content: 'Qualquer dúvida é só chamar.' },
    { role: 'user', content: 'combinado' },
    { role: 'user', content: 'obrigado' },
  ]);
  assert.deepStrictEqual(resultado.map(m => m.role), ['user', 'assistant', 'user']);
  assert.strictEqual(resultado[1].content, 'Fechado, tá marcado!\nQualquer dúvida é só chamar.');
  assert.strictEqual(resultado[2].content, 'combinado\nobrigado');
});

test('não mescla conteúdo multimodal (array)', () => {
  const multimodal = [{ type: 'text', text: 'foto' }];
  const resultado = mesclarTurnosConsecutivos([
    { role: 'user', content: 'olha isso' },
    { role: 'user', content: multimodal },
  ]);
  assert.strictEqual(resultado.length, 2);
  assert.strictEqual(resultado[1].content, multimodal);
});

test('não muta as mensagens originais ao mesclar', () => {
  const original = [
    { role: 'assistant', content: 'a' },
    { role: 'assistant', content: 'b' },
  ];
  mesclarTurnosConsecutivos(original);
  assert.strictEqual(original[0].content, 'a');
});

// ─── querPararRemarcacao ─────────────────────────────────────────────────────
// Bug real: no modo remarcação o bot repetia as opções em loop; "ok parar" e afins
// não paravam nada.

test('querPararRemarcacao detecta desistência', () => {
  assert.ok(querPararRemarcacao('ok parar'))
  assert.ok(querPararRemarcacao('cancela'))
  assert.ok(querPararRemarcacao('esquece'))
  assert.ok(querPararRemarcacao('deixa pra lá'))
  assert.ok(querPararRemarcacao('não quero mais'))
})

test('querPararRemarcacao NÃO dispara em pedido de horário ou "nenhum"', () => {
  assert.ok(!querPararRemarcacao('dia 11'))
  assert.ok(!querPararRemarcacao('quinta de manhã'))
  assert.ok(!querPararRemarcacao('pode ser as 15h'))
  assert.ok(!querPararRemarcacao('nenhum')) // "nenhum" leva a pedir outro dia, não a cancelar
})

// ─── querAdiarRemarcacao ─────────────────────────────────────────────────────
// Bug real: "vou ver" contava como tentativa falha, o bot repetia a pergunta e
// estourava o teto escalando pra equipe, pra quem só pediu um tempo.

test('querAdiarRemarcacao detecta adiamento educado', () => {
  assert.ok(querAdiarRemarcacao('vou ver'))
  assert.ok(querAdiarRemarcacao('vou ver e te falo'))
  assert.ok(querAdiarRemarcacao('depois te aviso'))
  assert.ok(querAdiarRemarcacao('deixa eu ver aqui e te falo'))
  assert.ok(querAdiarRemarcacao('preciso ver com minha esposa'))
  assert.ok(querAdiarRemarcacao('qualquer coisa te chamo'))
})

test('querAdiarRemarcacao NÃO dispara em escolha nem desistência', () => {
  assert.ok(!querAdiarRemarcacao('quinta às 15h'))
  assert.ok(!querAdiarRemarcacao('pode ser o primeiro'))
  assert.ok(!querAdiarRemarcacao('deixa pra lá'))
  assert.ok(!querAdiarRemarcacao('dia 11'))
})

// ─── textoDoConteudo ─────────────────────────────────────────────────────────

test('extrai texto de conteúdo multimodal', () => {
  const conteudo = [
    { type: 'image', source: {} },
    { type: 'text', text: 'segue a foto do cardápio' },
  ];
  assert.strictEqual(textoDoConteudo(conteudo), 'segue a foto do cardápio');
});

test('devolve string intacta e vazio para conteúdo inválido', () => {
  assert.strictEqual(textoDoConteudo('oi'), 'oi');
  assert.strictEqual(textoDoConteudo(null), '');
});

// ─── interpretarDataTarefa: pedido de contato futuro ([TAREFA]) ──────────────

// Hoje fixo: sexta-feira, 10 de julho de 2026, 14h (relógio de Campo Grande)
const hojeTarefa = new Date(2026, 6, 10, 14, 0, 0);

test('entende "dia 15" no mês corrente', () => {
  const d = interpretarDataTarefa('dia 15', hojeTarefa);
  assert.strictEqual(d.getDate(), 15);
  assert.strictEqual(d.getMonth(), 6);
  assert.strictEqual(d.getHours(), 9);
});

test('entende "dia 15/07" com barra', () => {
  const d = interpretarDataTarefa('dia 15/07', hojeTarefa);
  assert.strictEqual(d.getDate(), 15);
  assert.strictEqual(d.getMonth(), 6);
});

test('dia já passado no mês rola para o mês seguinte', () => {
  const d = interpretarDataTarefa('dia 5', hojeTarefa);
  assert.strictEqual(d.getDate(), 5);
  assert.strictEqual(d.getMonth(), 7); // agosto
});

test('"depois do dia 15" vira dia 16', () => {
  const d = interpretarDataTarefa('depois do dia 15', hojeTarefa);
  assert.strictEqual(d.getDate(), 16);
});

test('data em fim de semana rola para segunda', () => {
  // 11/07/2026 é sábado → segunda 13/07
  const d = interpretarDataTarefa('dia 11', hojeTarefa);
  assert.strictEqual(d.getDate(), 13);
  assert.strictEqual(d.getDay(), 1);
});

test('entende "amanhã" (com acento, bug clássico do \b)', () => {
  // sexta 10 → amanhã é sábado 11 → rola pra segunda 13
  const d = interpretarDataTarefa('amanhã', hojeTarefa);
  assert.strictEqual(d.getDate(), 13);
});

test('entende "semana que vem" como próxima segunda', () => {
  const d = interpretarDataTarefa('semana que vem', hojeTarefa);
  assert.strictEqual(d.getDate(), 13);
  assert.strictEqual(d.getDay(), 1);
});

test('entende "mês que vem" como dia 1º do mês seguinte (útil)', () => {
  const d = interpretarDataTarefa('mês que vem', hojeTarefa);
  assert.strictEqual(d.getMonth(), 7); // 1º de agosto de 2026 é sábado → segunda 3
  assert.strictEqual(d.getDate(), 3);
});

test('entende "em setembro" como início do mês', () => {
  const d = interpretarDataTarefa('só em setembro', hojeTarefa);
  assert.strictEqual(d.getMonth(), 8);
  assert.strictEqual(d.getDate(), 1);
});

test('mês já passado rola para o ano seguinte', () => {
  const d = interpretarDataTarefa('em março', hojeTarefa);
  assert.strictEqual(d.getFullYear(), 2027);
  assert.strictEqual(d.getMonth(), 2);
});

test('respeita hora citada ("dia 15 às 15h")', () => {
  const d = interpretarDataTarefa('dia 15 às 15h', hojeTarefa);
  assert.strictEqual(d.getDate(), 15);
  assert.strictEqual(d.getHours(), 15);
});

test('devolve null para pedido vago (caller usa fallback)', () => {
  assert.strictEqual(interpretarDataTarefa('depois eu te falo', hojeTarefa), null);
  assert.strictEqual(interpretarDataTarefa('', hojeTarefa), null);
});
