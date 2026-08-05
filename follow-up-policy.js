const HORA = 60 * 60 * 1000;

const LIMITES_FOLLOW_UP = [1 * HORA, 6 * HORA, 20 * HORA];
const INTERVALOS_MINIMOS = [0, 3 * HORA, 8 * HORA];

function proximaTentativaFollowUp({ tentativas = 0, ultimoFollowUp = 0, ultimaMensagem, agora }) {
  if (!ultimaMensagem || tentativas < 0 || tentativas >= LIMITES_FOLLOW_UP.length) return null;
  const indice = tentativas;
  if (agora - ultimaMensagem < LIMITES_FOLLOW_UP[indice]) return null;
  if (indice > 0 && ultimoFollowUp && agora - ultimoFollowUp < INTERVALOS_MINIMOS[indice]) return null;
  return indice + 1;
}

function horaEstaNoSilencio(hora, inicio = 21, fim = 6) {
  return hora >= inicio || hora < fim;
}

// Plano B do follow-up: usado SOMENTE quando a geração por IA falhou ou veio
// cortada (nunca como caminho padrão — v1.31.0 fez isso e soltou em produção
// mensagens em minúscula, sem saudação e com a mesma pergunta repetida).
// Regras da copy: começa com maiúscula mesmo sem nome, cumprimenta no toque 1,
// e cada toque termina com uma pergunta DIFERENTE do anterior.
function followUpSeguro(nome, tentativa, tipoNegocio = '', dor = '') {
  const primeiroNome = nome && nome !== 'você' ? String(nome).trim().split(/\s+/)[0] : '';
  const oi = primeiroNome ? `Oi ${primeiroNome}! ` : 'Oi! ';
  if (tentativa === 1) {
    if (tipoNegocio || dor) return `${oi}Posso continuar daqui e te mostrar como isso funcionaria no seu cenário. Quer seguir?`;
    return `${oi}Posso te explicar direitinho como isso funcionaria no seu caso. Me conta: qual é o seu negócio?`;
  }
  if (tentativa === 2) {
    if (tipoNegocio || dor) return `Uma vantagem que costuma pesar: o atendimento responde e organiza os contatos mesmo fora do horário comercial. Quer que eu continue?`;
    return `Uma vantagem que costuma pesar: o atendimento responde e organiza os contatos mesmo fora do horário comercial. Quer ver como ficaria no seu caso?`;
  }
  return `Tudo bem se agora não for o momento. Fico por aqui, e quando fizer sentido é só me chamar.`;
}

function followUpPareceCortado(texto) {
  const limpo = String(texto || '').trim();
  if (!limpo || limpo.length < 25 || !/[.!?]$/.test(limpo)) return true;
  return /\b(?:a|ao|aos|as|com|da|das|de|do|dos|e|em|entre|fora do|na|nas|no|nos|o|os|para|por|pra|que|se|sem|um|uma)$/i.test(limpo);
}

module.exports = { LIMITES_FOLLOW_UP, INTERVALOS_MINIMOS, proximaTentativaFollowUp, horaEstaNoSilencio, followUpSeguro, followUpPareceCortado };
