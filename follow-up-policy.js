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

module.exports = { LIMITES_FOLLOW_UP, INTERVALOS_MINIMOS, proximaTentativaFollowUp };
