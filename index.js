const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
require('dotenv/config');

const app = express();
app.use(express.json());

const conversas = {};
const ultimaMensagem = {};
const followUpStatus = {};
const agendamentos = {};
const leadsAgendados = new Set();
const leadsEncerrados = new Set();
const mensagensPendentes = {};
const debounceTimers = {};
const DEBOUNCE_MS = 4000;

const EXPIRACAO_MS = 24 * 60 * 60 * 1000;
const FOLLOWUP_1_MS = 2 * 60 * 60 * 1000;
const FOLLOWUP_2_MS = 24 * 60 * 60 * 1000;
const ENCERRAMENTO_MS = 24 * 60 * 60 * 1000;
const MEU_NUMERO = '5567988885170';
const CALENDAR_ID = 'comercial@cliqueefecha.com.br';

const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const auth = new google.auth.JWT({
  email: serviceAccountKey.client_email,
  key: serviceAccountKey.private_key,
  scopes: ['https://www.googleapis.com/auth/calendar'],
  subject: 'comercial@cliqueefecha.com.br',
});
const calendar = google.calendar({ version: 'v3', auth });

async function buscarSlotDisponivel(dia, periodos) {
  for (const hora of periodos) {
    const inicio = new Date(dia);
    inicio.setHours(hora, 0, 0, 0);
    const fim = new Date(inicio);
    fim.setMinutes(fim.getMinutes() + 30);
    try {
      const res = await calendar.freebusy.query({
        requestBody: {
          timeMin: inicio.toISOString(),
          timeMax: fim.toISOString(),
          timeZone: 'America/Campo_Grande',
          items: [{ id: CALENDAR_ID }],
        },
      });
      const ocupado = res.data.calendars[CALENDAR_ID].busy.length > 0;
      if (!ocupado) {
        const nomeDia = inicio.toLocaleDateString('pt-BR', {
          weekday: 'long', day: 'numeric', month: 'long',
          timeZone: 'America/Campo_Grande'
        });
        return { label: `${nomeDia} às ${hora}h`, inicio: inicio.toISOString(), fim: fim.toISOString() };
      }
    } catch (err) {
      console.error('Erro ao verificar agenda:', err.message);
    }
  }
  return null;
}

function proximoDiaUtil(data, offset = 1) {
  const d = new Date(data);
  d.setDate(d.getDate() + offset);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

async function buscarHorariosDisponiveis() {
  const agora = new Date();
  const horaCG = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Campo_Grande' }));
  const minAntes = new Date(horaCG.getTime() + 2 * 60 * 60 * 1000);

  const manha = [9, 10, 11];
  const tarde = [14, 15, 16, 17];

  // Slot 1: primeiro horario disponivel (hoje se possivel, senao proximo dia util)
  let slot1 = null;
  let diaSlot1 = null;

  const diaSemanaHoje = horaCG.getDay();
  if (diaSemanaHoje >= 1 && diaSemanaHoje <= 5) {
    const manhaFiltrada = manha.filter(h => { const t = new Date(horaCG); t.setHours(h, 0, 0, 0); return t > minAntes; });
    const tardeFiltrada = tarde.filter(h => { const t = new Date(horaCG); t.setHours(h, 0, 0, 0); return t > minAntes; });
    slot1 = await buscarSlotDisponivel(horaCG, manhaFiltrada) || await buscarSlotDisponivel(horaCG, tardeFiltrada);
    if (slot1) diaSlot1 = horaCG;
  }

  if (!slot1) {
    const proximoDia = proximoDiaUtil(horaCG);
    slot1 = await buscarSlotDisponivel(proximoDia, manha) || await buscarSlotDisponivel(proximoDia, tarde);
    if (slot1) diaSlot1 = proximoDia;
  }

  if (!slot1) return [];

  // Slot 2: obrigatoriamente no proximo dia util apos o dia do slot 1, periodo oposto
  const horaSlot1 = new Date(slot1.inicio).getHours();
  const slot1EhManha = horaSlot1 < 13;
  const diaSlot2 = proximoDiaUtil(diaSlot1);
  const periodoSlot2 = slot1EhManha ? tarde : manha;
  const slot2 = await buscarSlotDisponivel(diaSlot2, periodoSlot2)
             || await buscarSlotDisponivel(diaSlot2, slot1EhManha ? manha : tarde);

  return slot2 ? [slot1, slot2] : [slot1];
}

async function criarEvento(nome, email, telefone, slotInicio, slotFim, resumo = '') {
  try {
    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Consultoria Clique e Fecha - ${nome}`,
        description: `Nome: ${nome}\nWhatsApp: ${telefone}\nEmail: ${email}\n\n${resumo}`,
        start: { dateTime: slotInicio, timeZone: 'America/Campo_Grande' },
        end: { dateTime: slotFim, timeZone: 'America/Campo_Grande' },
        attendees: email ? [{ email }] : [],
        conferenceData: {
          createRequest: { requestId: `meet-${Date.now()}` }
        },
        reminders: {
          useDefault: false,
          overrides: [{ method: 'email', minutes: 60 }, { method: 'popup', minutes: 30 }]
        }
      },
    });
    const meetLink = res.data.conferenceData?.entryPoints?.[0]?.uri || null;
    console.log(`Evento criado para ${nome}. Meet: ${meetLink}`);
    return meetLink;
  } catch (err) {
    console.error('Erro ao criar evento:', err.message);
    return null;
  }
}

// Follow-up automático a cada 15 minutos
setInterval(async () => {
  const agora = Date.now();
  for (const phone of Object.keys(ultimaMensagem)) {
    if (leadsAgendados.has(phone)) continue;
    const status = followUpStatus[phone] || { tentativas: 0, ultimoFollowUp: 0 };
    const tempoSemResposta = agora - ultimaMensagem[phone];

    let nome = 'você';
    if (conversas[phone]) {
      const msgs = conversas[phone];
      const perguntasNome = ['qual o seu nome', 'como posso te chamar'];
      for (let i = 0; i < msgs.length - 1; i++) {
        const conteudo = msgs[i].content.toLowerCase().replace(/\|\|\|/g, ' ');
        if (perguntasNome.some(p => conteudo.includes(p)) && msgs[i+1]?.role === 'user') {
          const candidato = msgs[i+1].content.trim().split(/\s+/)[0];
          if (candidato && !candidato.includes('@') && candidato.length > 1 && candidato.length < 30 && !/\d/.test(candidato)) {
            nome = candidato.charAt(0).toUpperCase() + candidato.slice(1).toLowerCase();
            break;
          }
        }
      }
    }

    if (status.tentativas === 0 && tempoSemResposta > FOLLOWUP_1_MS) {
      await enviarMensagem(phone, `Oi ${nome}, tudo bem? Ficou alguma dúvida sobre nossa conversa? Estou por aqui.`);
      followUpStatus[phone] = { tentativas: 1, ultimoFollowUp: agora };
    } else if (status.tentativas === 1 && agora - status.ultimoFollowUp > FOLLOWUP_2_MS) {
      await enviarMensagem(phone, `Olá ${nome}, queria retomar nossa conversa. Quando tiver um momento, é só me chamar.`);
      followUpStatus[phone] = { tentativas: 2, ultimoFollowUp: agora };
    } else if (status.tentativas === 2 && agora - status.ultimoFollowUp > ENCERRAMENTO_MS) {
      await enviarMensagem(phone, `Olá ${nome}, como não tivemos retorno, vou encerrar nosso atendimento por aqui. Se precisar de algo futuramente, é só me chamar. Será um prazer!`);
      await enviarMensagem(MEU_NUMERO, `*Lead encerrado*\n\nNome: ${nome}\nWhatsApp: ${phone}\n\nNão respondeu após 2 tentativas de follow-up.`);
      delete conversas[phone];
      delete ultimaMensagem[phone];
      delete followUpStatus[phone];
      delete agendamentos[phone];
    }
  }
}, 15 * 60 * 1000);

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  const changes = req.body?.entry?.[0]?.changes?.[0]?.value;
  const message = changes?.messages?.[0];
  if (!message || message.type !== 'text') return res.sendStatus(200);

  const userPhone = message.from;
  const userText = message.text.body;

  const agora = Date.now();
  if (ultimaMensagem[userPhone] && agora - ultimaMensagem[userPhone] > EXPIRACAO_MS) {
    delete conversas[userPhone];
    delete agendamentos[userPhone];
    delete mensagensPendentes[userPhone];
  }
  ultimaMensagem[userPhone] = agora;
  if (followUpStatus[userPhone]) {
    followUpStatus[userPhone] = { tentativas: 0, ultimoFollowUp: 0 };
  }

  // Acumular mensagens e aguardar debounce antes de processar
  if (!mensagensPendentes[userPhone]) mensagensPendentes[userPhone] = [];
  mensagensPendentes[userPhone].push(userText);

  if (debounceTimers[userPhone]) clearTimeout(debounceTimers[userPhone]);

  debounceTimers[userPhone] = setTimeout(() => {
    const textoAcumulado = mensagensPendentes[userPhone].join(' ');
    delete mensagensPendentes[userPhone];
    delete debounceTimers[userPhone];
    processarMensagem(userPhone, textoAcumulado);
  }, DEBOUNCE_MS);

  return res.sendStatus(200);
});

async function processarMensagem(userPhone, userText) {

  if (!conversas[userPhone]) {
    let opcoesHorario = 'amanhã às 10h ou amanhã às 14h';
    let slotsDisponiveis = [];

    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 8000)
      );
      slotsDisponiveis = await Promise.race([buscarHorariosDisponiveis(), timeoutPromise]);
      if (slotsDisponiveis.length >= 2) {
        opcoesHorario = `${slotsDisponiveis[0].label} ou ${slotsDisponiveis[1].label}`;
      } else if (slotsDisponiveis.length === 1) {
        opcoesHorario = slotsDisponiveis[0].label;
      }
    } catch (err) {
      console.error('Erro ou timeout ao buscar horários:', err.message);
    }

    agendamentos[userPhone] = { slots: slotsDisponiveis };

    conversas[userPhone] = [
      {
        role: 'user',
        content: `Você é do time de atendimento da Clique e Fecha, empresa especializada em automações, chatbots e soluções de atendimento para pequenas empresas locais.

Seu objetivo é qualificar o lead e agendar uma conversa gratuita com um especialista da Clique e Fecha.

NÚMERO DO CLIENTE: ${userPhone}
HORÁRIOS DISPONÍVEIS NA AGENDA: ${opcoesHorario}

SOBRE A EMPRESA:
Serviços: automações de processos, chatbots personalizados e soluções de atendimento automatizado.
Público: pequenas empresas locais que querem atender mais clientes sem aumentar a equipe.
Reunião: conversa gratuita de 30 minutos via Google Meet, sem compromisso.

SEU ROTEIRO (siga esta ordem):

1. BOAS-VINDAS
Na primeira mensagem do lead, responda em EXATAMENTE 3 partes separadas pelo marcador "|||". Siga este formato obrigatório:
[resposta à saudação do lead, natural e breve]|||Sou do time de atendimento da *Clique e Fecha*, especializada em automações e chatbots para pequenos negócios.|||Qual o seu nome?

Exemplos:
- Lead diz "oi": Olá!|||Sou do time de atendimento da *Clique e Fecha*, especializada em automações e chatbots para pequenos negócios.|||Qual o seu nome?
- Lead diz "bom dia": Bom dia!|||Sou do time de atendimento da *Clique e Fecha*, especializada em automações e chatbots para pequenos negócios.|||Qual o seu nome?
- Lead diz "boa tarde, tudo bem?": Boa tarde! Tudo bem, obrigado.|||Sou do time de atendimento da *Clique e Fecha*, especializada em automações e chatbots para pequenos negócios.|||Qual o seu nome?

A partir da segunda mensagem do lead, responda normalmente sem o marcador "|||"."

2. ENTENDER A NECESSIDADE
Use o nome da pessoa a partir daqui. Vá direto para a pergunta, sem frases de transição como "Prazer" ou "Que bom falar com você". Pergunte qual é o maior desafio de atendimento da empresa hoje. Demonstre que entendeu o problema com empatia e siga em frente. Não mencione a Clique e Fecha ou o que ela resolve neste momento — isso fica para a reunião.

2b. APROFUNDAR A DOR
Após entender a dor principal, aprofunde com uma pergunta contextual — conectada exatamente ao que o lead disse, não com opções genéricas. Exemplos:
- Lead falou "qualidade": "Quando você fala em qualidade, é mais a falta de padronização nas respostas, a demora no atendimento ou os atendentes não terem as informações certas na hora?"
- Lead falou "volume": "Esse volume chega mais pelo WhatsApp, telefone ou outros canais?"
- Lead falou "demora": "Essa demora acontece mais no primeiro contato ou no acompanhamento depois?"
- Lead falou "organização": "Vocês perdem mais leads por falta de acompanhamento ou por demora na primeira resposta?"
Adapte a pergunta ao contexto real. Nunca use opções pré-definidas que não se conectem ao que o lead disse.

3. QUALIFICAR
Pergunte qual tipo de negócio a pessoa tem. Entenda se já usa alguma ferramenta de atendimento ou automação.

3b. URGÊNCIA
Após entender o negócio, pergunte: "Isso está te gerando problema agora ou é algo que você quer resolver nos próximos meses?"

4. AGENDAR A REUNIÃO
Após a resposta sobre urgência, responda em EXATAMENTE 2 partes separadas pelo marcador "|||":
[validação curta e natural sobre a urgência — se for urgente, algo como "Faz sentido resolver isso logo então."; se for futuro, algo como "Faz sentido se preparar com antecedência então."]|||Faria sentido a gente marcar uma conversa rápida de 30 minutos com um especialista da Clique e Fecha para te ajudar a estruturar isso?

A partir daqui, siga esta sequência obrigatória, uma mensagem por vez:
b. Somente após a confirmação, ofereça os dois horários com um de manhã e outro de tarde: "Tenho duas opções disponíveis: ${opcoesHorario}. Qual funciona melhor para você?"
c. Após a escolha do horário, confirme o WhatsApp: "Posso usar o número ${userPhone} para contato, ou prefere outro?"
d. Após confirmar o WhatsApp, peça o email com esta mensagem exata: "E qual é o seu email para eu registrar o agendamento?"

5. CONFIRMAÇÃO
Após receber o email, não envie nenhuma mensagem. Não mencione link, Meet, confirmação, agendamento ou qualquer coisa relacionada. O sistema cuidará disso automaticamente. Somente retome a conversa se o cliente enviar uma nova mensagem.

6. ENCERRAMENTO
Quando o lead der sinais claros de encerramento (disse "blz", "tá bom", "até", "combinado", "ok", "entendi", "tchau", "obrigado", "valeu", "certo" ou similares) e já foi convidado a agendar ou já agendou, responda com UMA última mensagem curta e natural de despedida e inclua obrigatoriamente o marcador exato: [ENCERRAR]

Exemplo: "Até mais, Thamiris! Quando quiser agendar é só chamar. [ENCERRAR]"
Exemplo: "Combinado! Até lá. [ENCERRAR]" 

TRATAMENTO DE OBJEÇÕES:

"Agora não" / "Não tenho tempo": Investigue o motivo antes de aceitar. "Entendo. Só para eu saber, tem alguma coisa que ficou sem resposta ou posso esclarecer algo agora?"

"Está caro": A conversa é gratuita e sem compromisso. Valores são apresentados na reunião conforme cada caso.

"Já tenho alguém": Respeite e explore se está satisfeito. Se insatisfeito, apresente a conversa como oportunidade de comparar.

"Não tenho tempo": "A conversa é só 30 minutos e pode ser no horário que for melhor para você."

REGRAS DE LINGUAGEM:
Responda sempre em português brasileiro.
Seja humano, próximo e natural. Evite frases genéricas como "Que bom te ter aqui".
Não use emojis.
Não use travessões.
Não use diminutivos.
Nunca coloque negrito em emails, números ou dados pessoais.
Use asterisco simples para negrito: *palavra* e nunca **palavra**.
Faça apenas uma pergunta por mensagem. Esta regra é absoluta.
Mensagens curtas. No máximo dois parágrafos, preferencialmente um. Seja direto e objetivo.
Nunca escreva instruções internas, meta-comentários ou textos entre parênteses como resposta ao cliente.`
      },
      {
        role: 'assistant',
        content: 'Entendido. Estou pronto para atender os clientes da Clique e Fecha seguindo o roteiro.'
      }
    ];
  }

  conversas[userPhone].push({ role: 'user', content: userText });

  // Verificar email ANTES de chamar o Claude — se for agendamento, Claude não fala
  const emailNaMensagem = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(userText);
  const confirmaAgendamento = emailNaMensagem && agendamentos[userPhone]?.slots?.length > 0 && !leadsAgendados.has(userPhone);

  if (confirmaAgendamento) {
    const slots = agendamentos[userPhone].slots;
    const historicoMsgsUsuario = conversas[userPhone]
      .filter(m => m.role === 'user')
      .map(m => m.content)
      .join(' ')
      .toLowerCase();
    let slotEscolhido = slots[0];
    if (slots[1]) {
      const horaSlot1 = slots[0].label.split(' às ')[1]?.replace('h', '').trim();
      const horaSlot2 = slots[1].label.split(' às ')[1]?.replace('h', '').trim();
      // Verifica se o usuário mencionou a hora do slot 2 mas não do slot 1
      const mencionouSlot2 = horaSlot2 && historicoMsgsUsuario.includes(horaSlot2 + 'h');
      const mencionouSlot1 = horaSlot1 && historicoMsgsUsuario.includes(horaSlot1 + 'h');
      if (mencionouSlot2 && !mencionouSlot1) slotEscolhido = slots[1];
    }

    const emailMatch = historico.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
    const emailLead = emailMatch ? emailMatch.find(e => !e.includes('cliqueefecha')) || emailMatch[0] : '';

    // Extrair nome direto do histórico
    // Estrutura: [0]=prompt(user) [1]=ack(assistant) [2]=msg1lead(user) [3]=resposta3partes(assistant) [4]=nome(user)
    let nome = '';
    const msgs = conversas[userPhone];
    const perguntasNome = ['qual o seu nome', 'como posso te chamar', 'como posso chamá-lo', 'como posso chamá-la'];
    for (let i = 0; i < msgs.length - 1; i++) {
      const conteudo = msgs[i].content.toLowerCase().replace(/\|\|\|/g, ' ');
      const perguntouNome = perguntasNome.some(p => conteudo.includes(p));
      // Aceitar tanto role assistant quanto user (prompt inicial tem role user)
      if (perguntouNome && msgs[i+1] && msgs[i+1].role === 'user') {
        const candidato = msgs[i+1].content.trim().split(/\s+/)[0];
        if (candidato && !candidato.includes('@') && candidato.length > 1 && candidato.length < 30 && !/\d/.test(candidato)) {
          nome = candidato.charAt(0).toUpperCase() + candidato.slice(1).toLowerCase();
          break;
        }
      }
    }
    if (!nome) nome = '';

    // Gerar resumo com Claude
    let resumoConversa = 'Resumo não disponível';
    try {
      const historicoParaResumo = conversas[userPhone].slice(0, -1);
      const resumoResp = await axios.post(
        'https://api.anthropic.com/v1/messages',
        {
          model: 'claude-sonnet-4-6',
          max_tokens: 300,
          messages: [
            ...historicoParaResumo,
            { role: 'user', content: 'Com base nessa conversa, escreva um resumo para o vendedor em 3 a 5 linhas. Inclua: tipo de negócio, principal dor relatada, se o problema é volume ou acompanhamento de leads, se a urgência é imediata ou futura, e o perfil geral do lead. Não inclua nome, email ou telefone no texto. Seja direto, como uma anotação rápida antes da reunião.' }
          ]
        },
        { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' } }
      );
      resumoConversa = resumoResp.data.content[0].text;
    } catch (err) {
      console.error('Erro ao gerar resumo:', err.message);
    }

    // Avisar que está gerando antes de processar
    await enviarMensagem(userPhone, 'Um segundo, deixa eu confirmar aqui.');

    const meetLink = await criarEvento(nome, emailLead, userPhone, slotEscolhido.inicio, slotEscolhido.fim, resumoConversa);

    leadsAgendados.add(userPhone);
    delete followUpStatus[userPhone];

    await new Promise(r => setTimeout(r, 10000));

    const saudacao = nome ? `Agendamento confirmado, ${nome}!` : `Agendamento confirmado!`;
    const despedida = nome ? `O especialista entrará em contato antes da reunião para confirmar os detalhes. Até lá, ${nome}!` : `O especialista entrará em contato antes da reunião para confirmar os detalhes. Até lá!`;
    const nomeExibicao = nome || 'Não informado';

    if (meetLink) {
      await enviarMensagem(userPhone,
        `${saudacao}\n\n` +
        `Nome: ${nomeExibicao}\n` +
        `WhatsApp: ${userPhone}\n` +
        `Email: ${emailLead}\n` +
        `Horário: ${slotEscolhido.label}\n` +
        `Link do Google Meet: ${meetLink}`
      );
      await new Promise(r => setTimeout(r, 10000));
      await enviarMensagem(userPhone, despedida);
      await enviarMensagem(MEU_NUMERO, `*Novo agendamento confirmado!*\n\nNome: ${nomeExibicao}\nWhatsApp: ${userPhone}\nEmail: ${emailLead}\nHorário: ${slotEscolhido.label}\nMeet: ${meetLink}`);
    } else {
      await enviarMensagem(userPhone,
        `${saudacao}\n\n` +
        `Nome: ${nomeExibicao}\n` +
        `WhatsApp: ${userPhone}\n` +
        `Email: ${emailLead}\n` +
        `Horário: ${slotEscolhido.label}\n\n` +
        `Atenção: o link do Google Meet não foi gerado automaticamente. Nossa equipe entrará em contato para enviar o link.`
      );
      await new Promise(r => setTimeout(r, 10000));
      await enviarMensagem(userPhone, despedida);
      await enviarMensagem(MEU_NUMERO, `*Novo agendamento confirmado!*\n\nNome: ${nomeExibicao}\nWhatsApp: ${userPhone}\nEmail: ${emailLead}\nHorário: ${slotEscolhido.label}\n\nAtenção: link do Meet não foi gerado automaticamente.`);
    }
  } else {
    // Ignorar se conversa já encerrada
    if (leadsEncerrados.has(userPhone)) return;

    const resposta = await chamarClaude(conversas[userPhone]);
    conversas[userPhone].push({ role: 'assistant', content: resposta });

    // Detectar abertura em 3 partes (primeira mensagem do lead)
    const partes = resposta.split('|||').map(p => p.trim()).filter(Boolean);
    if (partes.length === 3) {
      await enviarMensagem(userPhone, partes[0]);
      await new Promise(r => setTimeout(r, 1500));
      await enviarMensagem(userPhone, partes[1]);
      await new Promise(r => setTimeout(r, 3000));
      await enviarMensagem(userPhone, partes[2]);
    } else if (partes.length === 2) {
      // Validação da urgência + proposta de conversa
      await enviarMensagem(userPhone, partes[0]);
      await new Promise(r => setTimeout(r, 10000));
      await enviarMensagem(userPhone, partes[1]);
    } else {
      // Detectar encerramento
      const deveEncerrar = resposta.includes('[ENCERRAR]');
      const respostaLimpa = resposta.replace('[ENCERRAR]', '').trim();
      await enviarMensagem(userPhone, respostaLimpa);
      if (deveEncerrar) {
        leadsEncerrados.add(userPhone);
        delete conversas[userPhone];
        delete agendamentos[userPhone];
        delete ultimaMensagem[userPhone];
        delete followUpStatus[userPhone];
        delete mensagensPendentes[userPhone];
        if (debounceTimers[userPhone]) {
          clearTimeout(debounceTimers[userPhone]);
          delete debounceTimers[userPhone];
        }
      }
    }
  }

}

async function chamarClaude(historico) {
  try {
    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      { model: 'claude-sonnet-4-6', max_tokens: 500, messages: historico },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );
    return response.data.content[0].text;
  } catch (err) {
    console.error('Erro Claude:', err.response?.data || err.message);
    return 'Desculpe, tive um problema técnico. Pode tentar novamente em instantes?';
  }
}

async function enviarMensagem(para, texto) {
  try {
    await axios.post(
      `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        to: para,
        type: 'text',
        text: { body: texto }
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error('Erro WhatsApp:', err.response?.data || err.message);
  }
}

app.listen(process.env.PORT || 3000, () => console.log('Bot rodando!'));
