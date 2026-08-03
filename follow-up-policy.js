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

function followUpSeguro(nome, tentativa, tipoNegocio = '', dor = '') {
  const primeiroNome = nome && nome !== 'você' ? String(nome).trim().split(/\s+/)[0] : '';
  const chamada = primeiroNome ? `${primeiroNome}, ` : '';
  if (tentativa === 1) {
    if (tipoNegocio || dor) return `${chamada}consigo continuar daqui e te mostrar como isso funcionaria no seu cenário. Quer seguir?`;
    return `${chamada}consigo te explicar isso de forma bem direta no seu cenário. Que tipo de negócio você tem?`;
  }
  if (tentativa === 2) {
    if (tipoNegocio || dor) return `${chamada}uma vantagem é responder e organizar os contatos mesmo fora do horário comercial. Quer que eu continue?`;
    return `${chamada}o atendimento automático pode responder e organizar os contatos mesmo fora do horário comercial. Que tipo de negócio você tem?`;
  }
  return `${chamada}tudo bem se não for o momento certo agora, fico por aqui e quando fizer sentido é só me chamar.`;
}

function followUpPareceCortado(texto) {
  const limpo = String(texto || '').trim();
  if (!limpo || limpo.length < 25 || !/[.!?]$/.test(limpo)) return true;
  return /\b(?:a|ao|aos|as|com|da|das|de|do|dos|e|em|entre|fora do|na|nas|no|nos|o|os|para|por|pra|que|se|sem|um|uma)$/i.test(limpo);
}

module.exports = { LIMITES_FOLLOW_UP, INTERVALOS_MINIMOS, proximaTentativaFollowUp, horaEstaNoSilencio, followUpSeguro, followUpPareceCortado };
