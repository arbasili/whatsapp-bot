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

  for (const padrao of padroes) {
    // 'g' pra varrer TODAS as ocorrências, não só a 1ª: a primeira pode ser um
    // falso positivo ("tenho muitas dúvidas") e o negócio vir logo em seguida.
    const rx = new RegExp(padrao.source, 'gi');
    let m;
    while ((m = rx.exec(mensagensUsuario)) !== null) {
      const cand = (m[1] || '').trim();
      if (ehNegocio(cand)) return cand;
      if (m.index === rx.lastIndex) rx.lastIndex++; // guarda contra match vazio (loop infinito)
    }
  }

  const confirmacaoBot = respostasBot.match(/(?:^|\s)([\w\s]{3,30})\s+(?:é um negócio|é uma área|é um segmento)/i);
  if (confirmacaoBot && ehNegocio(confirmacaoBot[1].trim())) return confirmacaoBot[1].trim();

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
  // Lista generosa de propósito: "está" (fora da lista original) travou um agendamento
  // real em produção — o lead confirmou, o sistema não reconheceu e nada foi agendado.
  if (/^(sim( sim)?|isso|isso mesmo|isso aí|é isso|certinho|certo|cert[íi]ssimo|correto|exato|exatamente|t[áa] certo|t[áa] certinho|t[áa] sim|t[áa] [óo]timo|t[áa]|est[áa] certo|est[áa] certinho|est[áa] sim|est[áa] [óo]timo|est[áa]|pode ser|pode|confirmo|confirmado|perfeito|show|ok|okay|beleza|blz|uhum|aham|esse mesmo|é esse|é esse mesmo|👍)[\s!.,]*$/.test(t)) {
    return 'confirmou';
  }
  if (/^n[ãa]o\b/.test(t) || /\b(errad[oa]|errei|escrevi errado|corrig)/.test(t)) {
    return 'negou';
  }
  return null;
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

module.exports = {
  textoDoConteudo,
  temIntencaoDeCompra,
  pediuOptOut,
  escolherSlot,
  extrairTipoNegocio,
  extrairDorLead,
  extrairUrgencia,
  extrairNomeLead,
  interpretarRespostaEmail,
  mesclarTurnosConsecutivos,
  querPararRemarcacao,
  querAdiarRemarcacao,
  interpretarDataTarefa,
};
