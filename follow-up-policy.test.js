const test = require('node:test');
const assert = require('node:assert/strict');
const { proximaTentativaFollowUp, horaEstaNoSilencio, followUpSeguro, followUpPareceCortado } = require('./follow-up-policy');

const HORA = 60 * 60 * 1000;
const inicio = Date.UTC(2026, 7, 2, 12);

test('libera as tentativas em 1h, 6h e 20h', () => {
  assert.equal(proximaTentativaFollowUp({ tentativas: 0, ultimaMensagem: inicio, agora: inicio + HORA }), 1);
  assert.equal(proximaTentativaFollowUp({ tentativas: 1, ultimoFollowUp: inicio + HORA, ultimaMensagem: inicio, agora: inicio + 6 * HORA }), 2);
  assert.equal(proximaTentativaFollowUp({ tentativas: 2, ultimoFollowUp: inicio + 6 * HORA, ultimaMensagem: inicio, agora: inicio + 20 * HORA }), 3);
});

test('não libera antes do limite de cada tentativa', () => {
  assert.equal(proximaTentativaFollowUp({ tentativas: 0, ultimaMensagem: inicio, agora: inicio + HORA - 1 }), null);
  assert.equal(proximaTentativaFollowUp({ tentativas: 1, ultimoFollowUp: inicio + HORA, ultimaMensagem: inicio, agora: inicio + 6 * HORA - 1 }), null);
  assert.equal(proximaTentativaFollowUp({ tentativas: 2, ultimoFollowUp: inicio + 6 * HORA, ultimaMensagem: inicio, agora: inicio + 20 * HORA - 1 }), null);
});

test('impede disparos acumulados depois do horário de silêncio', () => {
  const retomada = inicio + 12 * HORA;
  assert.equal(proximaTentativaFollowUp({ tentativas: 1, ultimoFollowUp: retomada, ultimaMensagem: inicio, agora: retomada + 15 * 60 * 1000 }), null);
  assert.equal(proximaTentativaFollowUp({ tentativas: 1, ultimoFollowUp: retomada, ultimaMensagem: inicio, agora: retomada + 3 * HORA }), 2);
  assert.equal(proximaTentativaFollowUp({ tentativas: 2, ultimoFollowUp: retomada, ultimaMensagem: inicio, agora: retomada + 7 * HORA }), null);
});

test('encerra a cadência após três tentativas', () => {
  assert.equal(proximaTentativaFollowUp({ tentativas: 3, ultimoFollowUp: inicio + 20 * HORA, ultimaMensagem: inicio, agora: inicio + 23 * HORA }), null);
});

test('permite follow-up todos os dias entre 6h e 21h', () => {
  assert.equal(horaEstaNoSilencio(5), true);
  assert.equal(horaEstaNoSilencio(6), false);
  assert.equal(horaEstaNoSilencio(20), false);
  assert.equal(horaEstaNoSilencio(21), true);
});

test('sem contexto confirmado, follow-up não inventa dor do lead', () => {
  const mensagem = followUpSeguro('José', 1);
  assert.equal(mensagem, 'Oi José! Posso te explicar direitinho como isso funcionaria no seu caso. Me conta: qual é o seu negócio?');
  assert.doesNotMatch(mensagem, /perder cliente|demora|problema/i);
});

test('follow-up seguro sem nome ainda começa com saudação em maiúscula', () => {
  assert.match(followUpSeguro('', 1), /^Oi! /);
  assert.match(followUpSeguro('você', 1), /^Oi! /);
});

test('toques 1 e 2 do follow-up seguro nunca repetem a mesma pergunta', () => {
  const pergunta = (t) => String(followUpSeguro('', t)).split(/(?<=[.!])\s+/).pop();
  assert.notEqual(pergunta(1), pergunta(2));
});

test('detecta follow-up cortado antes de ser enviado', () => {
  assert.equal(followUpPareceCortado('José, outra vantagem é que ele fica de olho 24 horas, então mesmo fora do'), true);
  assert.equal(followUpPareceCortado('José, posso continuar e te mostrar como isso funciona no seu cenário?'), false);
});
