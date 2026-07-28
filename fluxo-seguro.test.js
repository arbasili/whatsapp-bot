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
  assert.match(trecho, /name = NULL, email = NULL, business_type = NULL/);
  assert.match(trecho, /score = NULL, close_probability = NULL, next_action = NULL/);
  assert.match(trecho, /scheduled_at = NULL, scheduled_at_ts = NULL/);
});

test('abertura usa nome do perfil sem pedir confirmação e não fica sem pergunta', () => {
  assert.match(source, /Considere o nome do perfil válido/);
  assert.match(source, /NÃO pergunte "posso te chamar de \$\{nomeDoWebhook\}\?"/);
  assert.match(source, /iniciandoNovaConversa && !resposta\.includes\('\?'\)/);
  assert.match(source, /Me conta sobre a sua operação, o que você faz\?/);
});

test('texto que menciona anúncio recebe a abertura especial mesmo sem referral da Meta', () => {
  assert.match(source, /\$\{origemLead === 'Anúncio' \?/);
});
