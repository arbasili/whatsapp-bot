// Heurísticas puras de interpretação de texto do lead.
// Extraídas do index.js para permitir testes unitários (npm test) sem subir o servidor.
// Nenhuma função aqui pode depender de banco, APIs externas ou estado global do bot.

function textoDoConteudo(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(c => c.type === 'text').map(c => c.text).join(' ');
  }
  return '';
}

const PERGUNTAS_NOME = ['qual o seu nome', 'como posso te chamar', 'como posso chamá-lo', 'como posso chamá-la', 'posso te chamar de'];
// Palavras que não são nomes (a pessoa responde com frase em vez do nome direto)
const PALAVRAS_NAO_NOME = new Set([
  'sou', 'eu', 'meu', 'minha', 'me', 'chamo', 'nome', 'é', 'o', 'a', 'da', 'do', 'de',
  'aqui', 'oi', 'ola', 'olá', 'bom', 'boa', 'dia', 'tarde', 'noite', 'tudo', 'bem',
  'proprietario', 'proprietaria', 'dono', 'dona', 'sócio', 'socio', 'gerente', 'responsavel',
  'pode', 'chamar', 'falar', 'com', 'senhor', 'senhora', 'sr', 'sra',
  'uso', 'use', 'usando', 'usar', 'utilizo', 'utilizando'
]);

// Identifica qual slot o lead escolheu, cruzando dia da semana, data (dia do mês) e hora.
// Retorna o slot escolhido ou null se não conseguir identificar.
function escolherSlot(texto, slots) {
  if (!texto || !slots || slots.length === 0) return null;
  const t = texto.toLowerCase();

  // Mapa de dias da semana (com e sem acento, formas curtas)
  const diasSemana = {
    'segunda': 'segunda', 'segunda-feira': 'segunda', 'segundafeira': 'segunda',
    'terça': 'terça', 'terca': 'terça', 'terça-feira': 'terça', 'terca-feira': 'terça',
    'quarta': 'quarta', 'quarta-feira': 'quarta', 'quartafeira': 'quarta',
    'quinta': 'quinta', 'quinta-feira': 'quinta', 'quintafeira': 'quinta',
    'sexta': 'sexta', 'sexta-feira': 'sexta', 'sextafeira': 'sexta',
  };

  // 1. Tentar por dia da semana mencionado no texto
  let diaMencionado = null;
  for (const [chave, valor] of Object.entries(diasSemana)) {
    if (t.includes(chave)) { diaMencionado = valor; break; }
  }
  if (diaMencionado) {
    const match = slots.find(s => s.label.toLowerCase().includes(diaMencionado));
    if (match) return match;
  }

  // 2. Tentar por dia do mês ("dia 18", "18 de junho", "no 18")
  const matchDia = t.match(/\bdia\s+(\d{1,2})\b/) || t.match(/\b(\d{1,2})\s+de\s+\w+/);
  if (matchDia) {
    const numDia = matchDia[1];
    const match = slots.find(s => {
      const labelDia = s.label.match(/(\d{1,2})\s+de\s+\w+/);
      return labelDia && labelDia[1] === numDia;
    });
    if (match) return match;
  }

  // 3. Tentar por hora ("9h", "às 14", "14 horas", "as 15") — label está em horário de Brasília
  const textoEhCurto = t.trim().split(/\s+/).length <= 4; // confirmação curta, ex: "pode as 15"
  // Evita que um número solto sem relação a horário (ex: "9 pessoas", "faz 3 anos")
  // seja lido como confirmação de horário só por aparecer numa mensagem curta.
  const temContextoDeQuantidade = /\b\d{1,2}\s*(pessoas?|reais?|anos?|meses?|dias?|vezes|clientes?|funcion[áa]rios?|km|%|porcento)\b/.test(t);
  for (const slot of slots) {
    const matchHora = slot.label.match(/às\s+(\d{1,2})h/);
    const hora = matchHora ? matchHora[1] : null;
    if (hora && (
      t.includes(hora + 'h') ||
      t.includes(hora + ' h') ||
      t.includes('às ' + hora) ||
      t.includes('as ' + hora) ||
      t.includes(hora + ' hora') ||
      (textoEhCurto && !temContextoDeQuantidade && new RegExp(`\\b${hora}\\b`).test(t))  // hora isolada só em texto curto e sem contexto de quantidade
    )) {
      return slot;
    }
  }

  // 4. Tentar por ordem — exige contexto explícito de ordinal para evitar falsos positivos:
  // "segunda não posso" não é escolha da opção 2, "primeiro preciso ver com meu sócio"
  // não é escolha da opção 1. Aceita: "opção 1/2", "a primeira", "o segundo",
  // "primeira opção", "segunda opção", a palavra sozinha ou o número sozinho.
  const escolheuPrimeiro = /\bop[çc][ãa]o\s*1\b|\b(a\s+)?primeir[ao]\s+(op[çc][ãa]o|hor[áa]rio)\b|\bo\s+primeiro\b|\ba\s+primeira\b|^\s*primeir[ao]\s*[!.]?\s*$|^\s*1\s*$/.test(t);
  const escolheuSegundo = /\bop[çc][ãa]o\s*2\b|\bsegund[ao]\s+(op[çc][ãa]o|hor[áa]rio)\b|\bo\s+segundo\b|\ba\s+segunda\b(?!\s*-?\s*feira)|^\s*segund[ao]\s*[!.]?\s*$|^\s*2\s*$/.test(t);
  if (escolheuPrimeiro && slots[0]) return slots[0];
  if (escolheuSegundo && slots[1]) return slots[1];

  return null;
}

// Extrai o tipo de negócio do lead a partir da conversa
function extrairTipoNegocio(historico) {
  if (!historico || historico.length < 3) return null;

  const mensagensUsuario = historico
    .filter(m => m.role === 'user')
    .slice(-5)
    .map(m => textoDoConteudo(m.content))
    .join(' ')
    .toLowerCase();

  const respostasBot = historico
    .filter(m => m.role === 'assistant')
    .slice(-5)
    .map(m => textoDoConteudo(m.content))
    .join(' ')
    .toLowerCase();

  const padroes = [
    /(?:tenho|trabalho com|sou dono de|tenho um[a]?)\s+([^.!?\n]{3,40})/i,
    /(?:meu negócio|minha empresa|meu estabelecimento)\s+(?:é|são)\s+([^.!?\n]{3,40})/i,
    /(?:trabalho|atuo)\s+(?:com|no|na|em)\s+([^.!?\n]{3,40})/i,
    /(?:tenho um[a]?|é um[a]?)\s+([^.!?\n]{3,40})(?:\s+aqui|\s+no bairro|\s+na cidade)?/i,
    /meu\s+(?:negócio|trabalho|ramo)\s+(?:é|são|é de)\s+([^.!?\n]{3,40})/i,
  ];

  for (const padrao of padroes) {
    const match = mensagensUsuario.match(padrao);
    if (match) return match[1].trim();
  }

  const confirmacaoBot = respostasBot.match(/(?:^|\s)([\w\s]{3,30})\s+(?:é um negócio|é uma área|é um segmento)/i);
  if (confirmacaoBot) return confirmacaoBot[1].trim();

  return null;
}

// Extrai a dor principal do lead a partir das mensagens do usuário
function extrairDorLead(historico) {
  if (!historico || historico.length < 4) return null;

  const mensagensUsuario = historico
    .filter(m => m.role === 'user')
    .slice(-8)
    .map(m => textoDoConteudo(m.content))
    .filter(m => m.length > 15)
    .join(' | ');

  if (mensagensUsuario.length < 20) return null;

  return mensagensUsuario.slice(0, 200);
}

// Detecta urgência com base nas palavras usadas pelo lead
function extrairUrgencia(historico) {
  if (!historico || historico.length < 4) return null;

  const mensagensUsuario = historico.filter(m => m.role === 'user');

  // Só detecta urgência a partir da 4ª mensagem do usuário
  // Antes disso qualquer "hoje", "agora" é contexto casual, não urgência real
  if (mensagensUsuario.length < 4) return null;

  const texto = mensagensUsuario
    .slice(3) // ignora as 3 primeiras mensagens (saudação, nome, tipo de negócio)
    .map(m => textoDoConteudo(m.content))
    .join(' ')
    .toLowerCase();

  if (/agora|urgente|hoje|essa semana|o mais rápido|quanto antes|imediato|imediata/.test(texto)) {
    return 'imediata';
  }
  if (/próxim[ao]s? (dias?|semanas?)|em breve|logo/.test(texto)) {
    return 'próximos dias';
  }
  if (/próxim[ao]s? (meses?)|futuramente|sem pressa|quando der/.test(texto)) {
    return 'próximos meses';
  }

  return null;
}

function extrairNomeLead(conversa) {
  if (!conversa) return '';

  // Palavras de confirmação — quando o lead responde isso após "posso te chamar de X",
  // significa que confirmou o nome X, não que seu nome é a palavra de confirmação
  const CONFIRMACOES = new Set(['sim', 'pode', 'claro', 'isso', 'correto', 'exato', 'isso mesmo',
    'pode sim', 'com certeza', 'ok', 'isso aí', 'perfeito', 'certo', 'é isso', 'é']);

  // Começa do índice 2: índice 0 é o prompt do sistema (contém exemplos com "qual o seu nome"
  // e "Sou o Lucas") e índice 1 é o "Entendido" do assistant. Nenhum deles tem o nome real
  // do lead, e varrê-los causava captura errada (ex: pegar "Lucas" da apresentação).
  for (let i = 2; i < conversa.length - 1; i++) {
    const conteudo = textoDoConteudo(conversa[i].content).toLowerCase().replace(/\|\|\|/g, ' ');
    const perguntouNome = PERGUNTAS_NOME.some(p => conteudo.includes(p));
    if (perguntouNome && conversa[i+1] && conversa[i+1].role === 'user') {
      const respostaLead = textoDoConteudo(conversa[i+1].content).trim();
      const respostaLower = respostaLead.toLowerCase();

      // Se a pergunta foi "posso te chamar de X?" e o lead confirmou,
      // extrai o nome X diretamente da pergunta do bot
      if (conteudo.includes('posso te chamar de')) {
        const ehConfirmacaoPura = CONFIRMACOES.has(respostaLower) ||
          (respostaLower.split(/\s+/).length <= 2 &&
           [...CONFIRMACOES].some(c => respostaLower.startsWith(c)) &&
           !respostaLower.match(/[a-záàãâéêíóôõúüç]{3,}/g)?.some(p => !CONFIRMACOES.has(p)));
        if (ehConfirmacaoPura) {
          // Lead confirmou o nome sugerido — extrai da pergunta do bot
          const matchNome = conteudo.match(/posso te chamar de ([a-záàãâéêíóôõúüç]+)/i);
          if (matchNome) {
            const nomeConfirmado = matchNome[1].trim();
            return nomeConfirmado.charAt(0).toUpperCase() + nomeConfirmado.slice(1).toLowerCase();
          }
        }
        // Se não foi confirmação pura, cai no fluxo normal abaixo (extrai da resposta do lead)
      }

      // Caso normal: extrai o nome da resposta do lead
      const palavras = respostaLead.split(/\s+/);
      for (const palavra of palavras) {
        const limpa = palavra.replace(/[.,!?;:]/g, '');
        const ehNome = limpa &&
          !limpa.includes('@') &&
          limpa.length > 1 && limpa.length < 30 &&
          !/\d/.test(limpa) &&
          !PALAVRAS_NAO_NOME.has(limpa.toLowerCase()) &&
          !CONFIRMACOES.has(limpa.toLowerCase());
        if (ehNome) {
          return limpa.charAt(0).toUpperCase() + limpa.slice(1).toLowerCase();
        }
      }
    }
  }
  return '';
}

// Interpreta a resposta do lead à confirmação de email ("Anotei aqui: X. Tá certinho?").
// Retorna 'confirmou', 'negou' ou null (resposta ambígua — deixa o fluxo normal responder).
// Correção com um novo email não passa por aqui: o fluxo detecta o endereço na mensagem
// antes de consultar esta função.
function interpretarRespostaEmail(texto) {
  const t = (texto || '').trim().toLowerCase();
  if (!t) return null;
  if (/^(sim|isso|isso mesmo|isso aí|certinho|certo|correto|exato|t[áa] certo|t[áa] certinho|t[áa] sim|t[áa]|pode ser|pode|confirmo|confirmado|perfeito|show|ok|okay|beleza|blz|esse mesmo|é esse|é esse mesmo|👍)[\s!.,]*$/.test(t)) {
    return 'confirmou';
  }
  if (/^n[ãa]o\b/.test(t) || /\b(errad[oa]|errei|escrevi errado|corrig)/.test(t)) {
    return 'negou';
  }
  return null;
}

module.exports = {
  textoDoConteudo,
  escolherSlot,
  extrairTipoNegocio,
  extrairDorLead,
  extrairUrgencia,
  extrairNomeLead,
  interpretarRespostaEmail,
};
