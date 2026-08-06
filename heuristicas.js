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

// Converte a hora mencionada pelo lead para a grade interna de Campo Grande.
// Por padrão, os horários oferecidos pelo bot são de Brasília. Quando o próprio
// lead explicita MS/MT ou uma cidade nesses fusos, a hora já é local e não deve
// sofrer a subtração de 1h.
function horaCampoGrandeDoPedido(texto, horaInformada) {
  const t = (texto || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const fusoCampoGrande =
    /\b(ms|mt|mato grosso do sul|mato grosso)\b/.test(t) ||
    /\b(campo grande|cuiaba)\b/.test(t);
  const fusoBrasilia =
    /\b(brasilia|df|distrito federal)\b/.test(t) ||
    /\bhorario de brasilia\b/.test(t);

  if (fusoCampoGrande) return horaInformada;
  if (fusoBrasilia) return horaInformada - 1;
  return horaInformada - 1;
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

  // Ignora o cabeçalho (índice 0 = roteiro com role user, índice 1 = ack do assistant).
  // Sem isso, no início da conversa os padrões abaixo casavam com o texto do PRÓPRIO
  // roteiro (ex: "Tenho duas opções disponíveis: sexta-feira...") e o campo Segmento
  // do CRM nascia poluído com pedaço do prompt.
  const conversa = historico.slice(2);

  const mensagensUsuario = conversa
    .filter(m => m.role === 'user')
    .slice(-5)
    .map(m => textoDoConteudo(m.content))
    .join(' ')
    .toLowerCase();

  const respostasBot = conversa
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

  // Trechos que casam "tenho X" mas NÃO são um ramo de negócio (viravam Segmento
  // no CRM em produção, ex.: "tenho muitas dúvidas"). Se o trecho capturado contém
  // um desses, não é negócio: pula e continua procurando — a próxima ocorrência
  // costuma ser o negócio real (ex.: logo depois o lead diz "tenho uma seguradora").
  const NAO_EH_NEGOCIO = /\b(d[úu]vidas?|perguntas?|interesse|pressa|medo|receio|certeza|vontade|ideias?|problemas?|dificuldades?|muita|muitas|muito|muitos|v[áa]ri[oa]s?|alguns?|algumas?|nenhum[a]?|tempo)\b/i;
  const ehNegocio = txt => txt.length >= 3 && !NAO_EH_NEGOCIO.test(txt);

  // O trecho capturado vem em minúsculas e ainda traz o artigo colado: em
  // "tenho uma empresa de tecnologia", "tenho" casa antes de "tenho uma" na
  // alternância, então a captura é "uma empresa de tecnologia". O CRM gravava
  // isso literal e o card do Kanban mostrava "uma empresa de tecn…".
  // Corrigir a ordem dos padrões mexeria em todos eles; normalizar a saída
  // resolve num lugar só, e no MESMO formato que a IA de resumo produz
  // ("Empresa de tecnologia", "Clínica odontológica").
  const normalizarSegmento = txt => {
    const limpo = txt.replace(/^(?:uma?|uns|umas|os?|as?|meu|minha|meus|minhas)\s+/i, '').trim();
    return limpo ? limpo.charAt(0).toUpperCase() + limpo.slice(1) : limpo;
  };

  for (const padrao of padroes) {
    // 'g' pra varrer TODAS as ocorrências, não só a 1ª: a primeira pode ser um
    // falso positivo ("tenho muitas dúvidas") e o negócio vir logo em seguida.
    const rx = new RegExp(padrao.source, 'gi');
    let m;
    while ((m = rx.exec(mensagensUsuario)) !== null) {
      // normaliza ANTES de validar: tirar o artigo pode encurtar o candidato
      const cand = normalizarSegmento((m[1] || '').trim());
      if (ehNegocio(cand)) return cand;
      if (m.index === rx.lastIndex) rx.lastIndex++; // guarda contra match vazio (loop infinito)
    }
  }

  const confirmacaoBot = respostasBot.match(/(?:^|\s)([\w\s]{3,30})\s+(?:é um negócio|é uma área|é um segmento)/i);
  if (confirmacaoBot) {
    const cand = normalizarSegmento(confirmacaoBot[1].trim());
    if (ehNegocio(cand)) return cand;
  }

  return null;
}

// Extrai a dor principal do lead a partir das mensagens do usuário.
// Só considera mensagens com sinal explícito de problema — descrição do negócio
// ("tenho um petshop") não é dor. O campo fica VAZIO no CRM até o lead relatar
// um problema de verdade; a IA de resumo refina no agendamento.
const SINAIS_DOR = /demora|demorad|perd[eoi]|perco|\bsome\b|\bsomem\b|sumiu|para(m)? de responder|parou de responder|n[ãa]o consigo|n[ãa]o dou conta|bagun[çc]|atras[oa]|reclam|sem resposta|fica(m)? sem|vai embora|v[ãa]o embora|foi embora|escap|deixo de|dificuldade|dif[íi]cil|problema|travad|acumul|esfria/i;

function extrairDorLead(historico) {
  if (!historico || historico.length < 4) return null;

  // slice(2): pula o roteiro (role user) e o ack — senão a "dor" do lead vira o
  // início do próprio prompt no CRM quando a conversa ainda tem poucas mensagens
  const mensagensDor = historico.slice(2)
    .filter(m => m.role === 'user')
    .map(m => textoDoConteudo(m.content))
    .filter(t => t.length > 15 && SINAIS_DOR.test(t))
    .slice(-4);

  if (!mensagensDor.length) return null;

  let dor = mensagensDor.join(' | ');
  if (dor.length > 200) {
    // Corta em limite de palavra para não gravar frase picotada no CRM
    dor = dor.slice(0, 200);
    const ultimoEspaco = dor.lastIndexOf(' ');
    if (ultimoEspaco > 150) dor = dor.slice(0, ultimoEspaco);
  }
  return dor;
}

// Detecta urgência com base nas palavras usadas pelo lead
function extrairUrgencia(historico) {
  if (!historico || historico.length < 4) return null;

  // slice(2): pula o roteiro (role user) e o ack — o roteiro contém palavras como
  // "agora"/"hoje" que inflavam a detecção, além de contar como mensagem do lead
  const mensagensUsuario = historico.slice(2).filter(m => m.role === 'user');

  // Só detecta urgência a partir da 4ª mensagem do usuário
  // Antes disso qualquer "hoje", "agora" é contexto casual, não urgência real
  if (mensagensUsuario.length < 4) return null;

  const texto = mensagensUsuario
    .slice(3) // ignora as 3 primeiras mensagens (saudação, nome, tipo de negócio)
    .map(m => textoDoConteudo(m.content))
    .join(' ')
    .toLowerCase();

  // Exige expressão de INTENÇÃO de urgência. Palavras soltas de tempo ("hoje",
  // "agora") não contam: em papo de negócio significam "atualmente" — e a própria
  // pergunta do roteiro ("E hoje, como funciona...") induz o lead a usá-las.
  // Falso positivo real em produção: "hoje tem alguns anúncios..." virou urgência.
  if (/\burgente\b|\burg[êe]ncia\b|o mais r[áa]pido|quanto antes|\bimediat[ao]\b|pra ontem|n[ãa]o (posso|d[áa] pra) esperar|preciso resolver (isso )?(j[áa]|logo|agora)|resolver agora mesmo|come[çc]ar (j[áa]|logo|agora)/.test(texto)) {
    return 'imediata';
  }
  if (/próxim[ao]s? (dias?|semanas?)|essa semana|em breve|semana que vem/.test(texto)) {
    return 'próximos dias';
  }
  if (/próxim[ao]s? (meses?)|futuramente|sem pressa|quando der|mais pra frente|m[êe]s que vem/.test(texto)) {
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
  // Negação tem prioridade: "sim, mas o email está errado" não pode concluir
  // o agendamento apenas porque a frase começou com "sim".
  if (/^n[ãa]o\b/.test(t) || /\b(errad[oa]|incorret[oa]|errei|escrevi errado|corrig)/.test(t)) {
    return 'negou';
  }
  // Lista generosa de propósito: "está" (fora da lista original) travou um agendamento
  // real em produção — o lead confirmou, o sistema não reconheceu e nada foi agendado.
  if (/^(sim( sim)?|isso|isso mesmo|isso aí|é isso|certinho|certo|cert[íi]ssimo|correto|exato|exatamente|t[áa] certo|t[áa] certinho|t[áa] sim|t[áa] [óo]timo|t[áa]|est[áa] certo|est[áa] certinho|est[áa] sim|est[áa] [óo]timo|est[áa]|pode ser|pode|confirmo|confirmado|perfeito|show|ok|okay|beleza|blz|uhum|aham|esse mesmo|é esse|é esse mesmo|👍)[\s!.,]*$/.test(t)) {
    return 'confirmou';
  }
  // Confirmações naturais completas, comuns em conversa real.
  if (/^(sim[\s,!.:-]*)?(esse|este|o)?\s*(e-?mail)?\s*(est[áa]|t[áa]|[ée])\s*(correto|certo|certinho|exato|perfeito)[\s!.,]*$/.test(t)) {
    return 'confirmou';
  }
  return null;
}

// A IA recebe a regra de fazer uma pergunta por mensagem, mas uma resposta
// eventualmente pode escapar. Estas funções permitem tentar uma reescrita e,
// como última proteção, cortar somente a parte que trouxe perguntas extras.
function temParteComMultiplasPerguntas(texto) {
  return String(texto || '').split('|||').some(parte => (parte.match(/\?/g) || []).length > 1);
}

function limitarPerguntasPorMensagem(texto) {
  return String(texto || '').split('|||').map(parte => {
    const primeira = parte.indexOf('?');
    if (primeira < 0 || parte.indexOf('?', primeira + 1) < 0) return parte.trim();
    return parte.slice(0, primeira + 1).trim();
  }).join('|||');
}

// Confirmação curta só é usada quando existe UMA única opção pendente.
// Nesse contexto, "sim, esse funciona" é inequívoco; fora dele continua sem
// escolher horário para não transformar um "sim" vago numa reserva errada.
function confirmouOpcaoUnica(texto) {
  const t = String(texto || '').trim().toLowerCase();
  if (!t) return false;
  if (/\b(n[ãa]o|mas n[ãa]o|n[ãa]o funciona|outro|outra|errad[oa])\b/.test(t)) return false;
  return /^(sim\b|isso\b|esse\b|essa\b|pode\b|confirmo\b|confirmado\b|fechado\b|perfeito\b|combinado\b|funciona\b|serve\b|t[áa] (bom|certo|[óo]timo)\b)/.test(t);
}

// A IA enriquece o CRM, mas estados objetivos não podem ficar incoerentes.
// Uma reunião confirmada implica lead qualificado e a próxima ação humana é
// preparar a reunião — nunca voltar etapas e perguntar dados já conhecidos.
function normalizarInteligenciaLead(dados, { agendou, tipoNegocio } = {}) {
  const normalizados = { ...(dados || {}) };
  const numeroEntre = (valor, minimo, maximo) => {
    const numero = Number(valor);
    return Number.isFinite(numero) ? Math.min(maximo, Math.max(minimo, Math.round(numero))) : minimo;
  };

  normalizados.score = numeroEntre(normalizados.score, agendou ? 70 : 0, 100);
  normalizados.close_probability = numeroEntre(normalizados.close_probability, agendou ? 35 : 0, 100);

  if (agendou) {
    const segmento = String(tipoNegocio || '').trim();
    normalizados.next_action = segmento
      ? `Preparar a reunião e revisar o diagnóstico de ${segmento}`
      : 'Preparar a reunião e revisar o diagnóstico do lead';
    normalizados.next_action_at_horas = null;
  }

  return normalizados;
}

// Mescla turnos consecutivos do mesmo role num único turno (separados por quebra de
// linha). A API da Anthropic exige alternância user/assistant; como o histórico
// registra também as mensagens automáticas do sistema (confirmações, lembretes,
// follow-ups), turnos assistant consecutivos são comuns — sem a mescla, a chamada
// retornaria 400. Conteúdo multimodal (array) não é mesclado, vira turno próprio.
function mesclarTurnosConsecutivos(mensagens) {
  const mescladas = [];
  for (const m of mensagens) {
    const anterior = mescladas[mescladas.length - 1];
    if (anterior && anterior.role === m.role && typeof anterior.content === 'string' && typeof m.content === 'string') {
      anterior.content += '\n' + m.content;
    } else {
      mescladas.push({ role: m.role, content: m.content });
    }
  }
  return mescladas;
}

// Detecta que o lead quer PARAR/desistir da remarcação (não escolher horário agora).
// Usado para não prendê-lo num loop de "escolha um dos horários". "nenhum" de
// propósito NÃO conta aqui: significa "esses não servem", e deve levar a pedir
// outro dia, não a cancelar.
function querPararRemarcacao(texto) {
  const t = (texto || '').trim().toLowerCase();
  if (!t) return false;
  // Sem \b no fim: em JS \b não casa após letra acentuada ("lá"), o que fazia
  // "deixa pra lá" escapar. O \b inicial já evita casar no meio de outra palavra.
  return /\b(parar|para de|cancela(r)?|esque[çc]e|deixa (pra l[áa]|quieto|assim|isso)|desisto|desisti|n[ãa]o quero (mais|remarcar)|nunca mais)/.test(t);
}

// Detecta que o lead quer ADIAR a escolha do novo horário ("vou ver", "depois
// te falo") — diferente de parar (desistir) e de não ter entendido. Sem isso,
// "vou ver" contava como tentativa falha, o bot repetia a pergunta e estourava
// o teto escalando pra equipe, pra quem só pediu um tempo (visto em produção).
function querAdiarRemarcacao(texto) {
  const t = (texto || '').trim().toLowerCase();
  if (!t) return false;
  return /\b(vou ver|vou olhar|vou verificar|vou conferir|deixa eu ver|preciso ver|vejo (e te falo|quando)|depois (eu )?(te )?(falo|aviso|vejo|confirmo)|te (falo|aviso|confirmo) (depois|mais tarde|amanh[ãa])|qualquer coisa (eu )?(te )?chamo|assim que (eu )?souber)\b/.test(t);
}

// Interpreta a data de um pedido de contato futuro do lead ("dia 15", "depois
// do dia 20", "semana que vem", "em agosto") para o marcador [TAREFA].
// Recebe "hoje" como Date no relógio de Campo Grande e devolve um Date no mesmo
// relógio (a conversão pra timestamptz é do chamador), ou null se não entender
// — o chamador aplica o fallback. Regras: hora padrão 9h (ou a hora citada),
// datas que caírem em fim de semana rolam pra segunda, e datas já passadas
// avançam pro próximo ciclo (mês/ano seguinte).
function interpretarDataTarefa(texto, hojeCG) {
  const t = (texto || '').trim().toLowerCase();
  if (!t) return null;
  const hoje = new Date(hojeCG);
  hoje.setHours(0, 0, 0, 0);

  // Hora citada ("às 15h", "as 15", "15 horas", "15h") — senão 9h.
  // "às/as" precisa ser palavra inteira: sem isso o "a" final de "dia 15"
  // casava e a hora virava 15.
  const mHora = t.match(/(?:^|\s)[àa]s?\s+(\d{1,2})(?:\s*(?:h|horas?|:\d{2}))?(?:\s|$|[,.!?])/) ||
    t.match(/(\d{1,2})\s*h(?:oras?)?\b/);
  let hora = 9;
  if (mHora) {
    const h = parseInt(mHora[1], 10);
    if (h >= 6 && h <= 21) hora = h;
  }

  const resultado = (d) => {
    const r = new Date(d);
    // fim de semana → segunda
    while (r.getDay() === 0 || r.getDay() === 6) r.setDate(r.getDate() + 1);
    r.setHours(hora, 0, 0, 0);
    return r;
  };

  // Sem \b no fim depois de acento (não casa em JS) — mesmo bug do "amanhã"
  if (/depois\s+de\s+amanh[ãa]/.test(t)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 2); return resultado(d);
  }
  if (/\bamanh[ãa]/.test(t)) {
    const d = new Date(hoje); d.setDate(d.getDate() + 1); return resultado(d);
  }
  if (/semana\s+que\s+vem|pr[óo]xima\s+semana/.test(t)) {
    const d = new Date(hoje);
    const ateSegunda = ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + ateSegunda);
    return resultado(d);
  }
  if (/m[êe]s\s+que\s+vem|pr[óo]ximo\s+m[êe]s/.test(t)) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 1);
    return resultado(d);
  }

  const MESES = { janeiro: 0, fevereiro: 1, 'março': 2, marco: 2, abril: 3, maio: 4, junho: 5,
    julho: 6, agosto: 7, setembro: 8, outubro: 9, novembro: 10, dezembro: 11 };

  // "dia 15/07", "15/07", "dia 15 de julho", "depois do dia 20"
  const depoisDo = /depois\s+d[oe]\s+dia/.test(t) || /a\s+partir\s+d[oe]\s+dia/.test(t);
  let dia = null, mes = null;
  const mBarra = t.match(/(?:dia\s+)?(\d{1,2})\s*\/\s*(\d{1,2})/);
  const mExtenso = t.match(/dia\s+(\d{1,2})\s+de\s+([a-zç]+)/);
  const mDia = t.match(/dia\s+(\d{1,2})/);
  if (mBarra) {
    dia = parseInt(mBarra[1], 10);
    mes = parseInt(mBarra[2], 10) - 1;
  } else if (mExtenso && MESES[mExtenso[2]] !== undefined) {
    dia = parseInt(mExtenso[1], 10);
    mes = MESES[mExtenso[2]];
  } else if (mDia) {
    dia = parseInt(mDia[1], 10);
  }

  if (dia !== null && dia >= 1 && dia <= 31) {
    if (depoisDo) dia += 1;
    let d;
    if (mes !== null && mes >= 0 && mes <= 11) {
      d = new Date(hoje.getFullYear(), mes, dia);
      if (d < hoje) d = new Date(hoje.getFullYear() + 1, mes, dia);
    } else {
      d = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
      if (d < hoje) d = new Date(hoje.getFullYear(), hoje.getMonth() + 1, dia);
    }
    return resultado(d);
  }

  // "em agosto", "só em setembro" (mês sem dia → dia 1º)
  for (const [nome, num] of Object.entries(MESES)) {
    if (new RegExp(`\\bem\\s+${nome}|\\bs[óo]\\s+em\\s+${nome}`).test(t)) {
      let d = new Date(hoje.getFullYear(), num, 1);
      if (d < hoje) d = new Date(hoje.getFullYear() + 1, num, 1);
      return resultado(d);
    }
  }

  return null;
}

// Intenção EXPLÍCITA de compra/contratação (Melhoria 8): sinais fortes de que o
// lead quer avançar agora — dispara alerta imediato pro vendedor. Conservador de
// propósito: só pega frases inequívocas, pra não gerar alarme falso a cada "quero
// saber mais". "quanto custa/preço" NÃO entra aqui (é dúvida, não intenção de fechar).
function temIntencaoDeCompra(texto) {
  const t = (texto || '').toLowerCase();
  if (!t) return false;
  return /\bquero (contratar|fechar|assinar|comprar|come[çc]ar)\b|\bvamos fechar\b|\bpode (fechar|contratar)\b|(manda|me manda|envia|me envia|quero) (a |uma )?proposta\b|como (eu )?(fa[çz]o pra |fa[çz]o para )?(contrat|começ|assin|comprar)|como (que )?(funciona pra|fa[çz]o pra) (contratar|assinar|come[çc]ar)|\bfechar (neg[óo]cio|contrato)\b|onde (eu )?assino|bora fechar|t[ôo] dentro|fechado, vamos/.test(t);
}

// Pedido pra PARAR de receber mensagens (opt-out, Melhoria 6). Persistido: o
// lead não recebe mais follow-ups/lembretes proativos até pedir pra voltar.
// Cuidado pra não pegar "para amanhã" (preposição) nem "não quero esse horário".
function pediuOptOut(texto) {
  const t = (texto || '').toLowerCase().trim();
  if (!t) return false;
  return /\bn[ãa]o (me )?(mande|manda|envie|envia|chame|chama|perturbe|perturba|encha)\b|\bpar(e|a) de (me )?(mandar|enviar|chamar|perturbar|encher)\b|me (tir[ae]|remov[ae]|descadastr[ae])|\b(descadastr|desinscrev)|sair da lista|n[ãa]o quero (mais )?(receber|mensagen|ser chamad|que me mand)|me deixa? em paz|n[ãa]o me procur|perde(u)? meu (n[úu]mero|contato)|bloquea/.test(t);
}

// A ponte comercial deve chegar em três balões curtos. O modelo normalmente
// obedece ao marcador "|||", mas pode ocasionalmente devolver tudo num parágrafo.
// Esta proteção reconhece a estrutura sem alterar respostas comuns.
function separarPonteComercial(texto) {
  const original = String(texto || '').trim();
  if (!original || original.includes('|||')) return original;
  if (!/quer que eu veja um hor[áa]rio\?/i.test(original)) return original;
  if (!/(atendimento autom[áa]tico|automatizar|google meet|especialista)/i.test(original)) return original;

  // Marcadores de início de cada balão da ponte, na ordem em que aparecem no
  // texto. Cobrem a redação antiga ("isso dá pra resolver...", "pra te ajudar")
  // e a nova da v1.35.0 (prova ao vivo, "acho que vale", "é online").
  // A versão anterior desta função só conhecia a redação antiga: quando o
  // roteiro mudou, ela parou de dividir e a ponte inteira ia num balão só.
  // Visto em produção.
  // Dois cuidados nestes padrões: \b NÃO funciona antes de letra acentuada em
  // JS (É não é \w, então \bÉ nunca casa), e [ée] casaria também com a
  // conjunção "e" ("gratuita e online"). Por isso os marcadores acentuados
  // usam lookbehind de início de frase em vez de \b.
  const MARCADORES_PONTE = [
    /\b(?:isso|essa situa[çc][ãa]o|esse problema|esse tipo de (?:coisa|situa[çc][ãa]o))\s+(?:d[áa]|pode)(?=\s)|(?<=[.!?]\s{1,3})(?:[ée]|foi)\s+esse tempo de resposta/i,
    /\b(?:acho que vale|ia te sugerir|vou te sugerir|pra te ajudar|para te ajudar|por isso|se fizer sentido|a gente oferece)\b/i,
    /(?<=[.!?]\s{1,3})[ée]\s+(?:online|gratuita|gr[áa]tis)\b/i,
  ];

  const cortes = [];
  let deslocamento = 0;
  for (const marcador of MARCADORES_PONTE) {
    const relativo = original.slice(deslocamento).search(marcador);
    if (relativo <= 0) continue;
    const absoluto = deslocamento + relativo;
    cortes.push(absoluto);
    deslocamento = absoluto + 1; // o próximo marcador tem que vir depois deste
  }
  if (!cortes.length) return original;

  const partes = [];
  let anterior = 0;
  for (const corte of cortes) {
    partes.push(original.slice(anterior, corte).trim());
    anterior = corte;
  }
  partes.push(original.slice(anterior).trim());
  return partes.filter(Boolean).join('|||');
}

// Balão que chegou cortado no meio da frase. Visto em produção: a ponte
// terminou em "É online, gratuita e sem", perdendo "compromisso" e, junto,
// a pergunta que fecha a etapa. O lead ficou 5 minutos sem entender e teve
// que perguntar "como funciona?" sozinho.
// Não basta checar "não termina com pontuação": balão curto sem ponto final
// é comum e legítimo ("Boa noite, Adriano! 😊", "Show", "Perfeito"). O sinal
// confiável é terminar numa palavra de LIGAÇÃO, que nunca encerra uma frase.
function balaoCortadoNoMeio(texto) {
  const limpo = String(texto || '').trim();
  if (!limpo) return true;
  if (/[.!?…:;)\]"'»]$/.test(limpo)) return false;
  // (?:^|\s) em vez de \b: em JS o \b casa entre "ã" e "o", então "\bo$"
  // acusaria "então", "não", "informação" e toda palavra terminada em "ão".
  // Mesma armadilha de acento já encontrada em separarPonteComercial.
  return /(?:^|\s)(?:a|ao|aos|as|at[ée]|com|como|da|das|de|do|dos|e|em|entre|mas|na|nas|nem|no|nos|o|os|ou|para|pela|pelo|por|pra|pro|que|se|sem|sobre|um|uma|uns|umas)$/i.test(limpo);
}

// Detecta se a resposta está propondo a reunião (etapa da ponte do roteiro).
// Alimenta o PORTÃO DE QUALIFICAÇÃO: propor reunião sem saber o segmento e a
// dor gera proposta genérica, que o próprio roteiro proíbe e que não converte.
// Deliberadamente conservador: só acusa quando o texto tem a assinatura clara
// da proposta, para nunca bloquear uma menção solta a "especialista".
function propoeReuniao(texto) {
  const t = String(texto || '').toLowerCase();
  if (/quer que eu (veja|reserve|marque|separe) (um |o )?hor[áa]rio/.test(t)) return true;
  if (/(conversa|reuni[ãa]o) (gratuita|sem compromisso)/.test(t) && /especialista/.test(t)) return true;
  return false;
}

module.exports = {
  propoeReuniao,
  balaoCortadoNoMeio,
  textoDoConteudo,
  horaCampoGrandeDoPedido,
  temIntencaoDeCompra,
  pediuOptOut,
  separarPonteComercial,
  escolherSlot,
  extrairTipoNegocio,
  extrairDorLead,
  extrairUrgencia,
  extrairNomeLead,
  interpretarRespostaEmail,
  temParteComMultiplasPerguntas,
  limitarPerguntasPorMensagem,
  confirmouOpcaoUnica,
  normalizarInteligenciaLead,
  mesclarTurnosConsecutivos,
  querPararRemarcacao,
  querAdiarRemarcacao,
  interpretarDataTarefa,
};
