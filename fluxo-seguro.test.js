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
