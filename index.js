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
  const slots = [];

  const manha = [9, 10, 11];
  const tarde = [14, 15, 16, 17];

  // Tentar hoje: um slot de manhã e um de tarde
  const diaSemanaHoje = horaCG.getDay();
  if (diaSemanaHoje >= 1 && diaSemanaHoje <= 5) {
    const manhãFiltrada = manha.filter(h => { const t = new Date(horaCG); t.setHours(h,0,0,0); return t > minAntes; });
    const tardeFiltrada = tarde.filter(h => { const t = new Date(horaCG); t.setHours(h,0,0,0); return t > minAntes; });

    const slotManha = await buscarSlotDisponivel(horaCG, manhãFiltrada);
    const slotTarde = await buscarSlotDisponivel(horaCG, tardeFiltrada);

    if (slotManha && slotTarde) {
      return [slotManha, slotTarde];
    }
  }

  // Se não tiver 2 slots hoje, usar próximo dia útil
  const proximoDia = proximoDiaUtil(horaCG);
  const slotManhaNP = await buscarSlotDisponivel(proximoDia, manha);
  const slotTardeNP = await buscarSlotDisponivel(proximoDia, tarde);

  if (slotManhaNP) slots.push(slotManhaNP);
  if (slotTardeNP) slots.push(slotTardeNP);

  // Se ainda não tiver 2, tenta o dia seguinte
  if (slots.length < 2) {
    const outroDia = proximoDiaUtil(proximoDia);
    const s = await buscarSlotDisponivel(outroDia, [...manha, ...tarde]);
    if (s) slots.push(s);
  }

  return slots.slice(0, 2);
}

async function criarEvento(nome, email, telefone, slotInicio, slotFim) {
  try {
    const res = await calendar.events.insert({
      calendarId: CALENDAR_ID,
      conferenceDataVersion: 1,
      requestBody: {
        summary: `Consultoria Clique e Fecha - ${nome}`,
        description: `Lead: ${nome}\nWhatsApp: ${telefone}\nEmail: ${email}`,
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
    const status = followUpStatus[phone] || { tentativas: 0, ultimoFollowUp: 0 };
    const tempoSemResposta = agora - ultimaMensagem[phone];

    let nome = 'você';
    if (conversas[phone]) {
      const historico = conversas[phone].map(m => m.content).join(' ');
      const nomeMatch = historico.match(/Para começar[^?]+\?[\s\S]{0,200}?([A-ZÀ-Ú][a-zà-ú]+)/);
      if (nomeMatch) nome = nomeMatch[1];
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
  }
  ultimaMensagem[userPhone] = agora;
  if (followUpStatus[userPhone]) {
    followUpStatus[userPhone] = { tentativas: 0, ultimoFollowUp: 0 };
  }

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

Seu objetivo é qualificar o lead e agendar uma reunião no Google Meet com a equipe da Clique e Fecha.

NÚMERO DO CLIENTE: ${userPhone}
HORÁRIOS DISPONÍVEIS NA AGENDA: ${opcoesHorario}

SOBRE A EMPRESA:
Serviços: automações de processos, chatbots personalizados e soluções de atendimento automatizado.
Público: pequenas empresas locais que querem atender mais clientes sem aumentar a equipe.
Reunião: consultoria gratuita de 30 minutos via Google Meet, sem compromisso.

SEU ROTEIRO (siga esta ordem):

1. BOAS-VINDAS
Sempre comece se apresentando: "Olá! Sou do time de atendimento da Clique e Fecha, empresa especializada em automações e chatbots para pequenos negócios." Depois faça apenas esta pergunta: "Para começar, como posso te chamar?"

2. ENTENDER A NECESSIDADE
Use o nome da pessoa a partir daqui. Pergunte qual é o maior desafio de atendimento da empresa hoje. Demonstre que entendeu o problema e relacione com o que a Clique e Fecha resolve.

3. QUALIFICAR
Pergunte qual tipo de negócio a pessoa tem. Entenda se já usa alguma ferramenta de atendimento ou automação. Se o perfil for de pequena empresa local, avance para o agendamento.

4. AGENDAR A REUNIÃO
Siga esta sequência obrigatória, uma mensagem por vez:
a. Primeiro pergunte se faz sentido agendar uma conversa rápida com a equipe.
b. Somente após a confirmação, ofereça os dois horários com um de manhã e outro de tarde: "Tenho duas opções disponíveis: ${opcoesHorario}. Qual funciona melhor para você?"
c. Após a escolha do horário, confirme o WhatsApp: "Posso usar o número ${userPhone} para contato, ou prefere outro?"
d. Após confirmar o WhatsApp, peça o email.

5. CONFIRMAÇÃO
Confirme todos os dados: nome, WhatsApp, email e horário. Informe que o link do Google Meet será enviado em seguida.

6. APÓS O AGENDAMENTO
Continue presente e disponível. Responda perguntas naturalmente. Somente se despeça quando o cliente der sinais claros de encerramento. Encerre com leveza: "Fico à disposição se precisar de mais alguma coisa. Até lá!"

TRATAMENTO DE OBJEÇÕES:

"Agora não" / "Não tenho tempo": Investigue o motivo antes de aceitar. "Entendo. Só para eu saber, tem alguma coisa que ficou sem resposta ou posso esclarecer algo agora?"

"Está caro": A consultoria é gratuita e sem compromisso. Valores são apresentados na reunião conforme cada caso.

"Já tenho alguém": Respeite e explore se está satisfeito. Se insatisfeito, apresente a consultoria como oportunidade de comparar.

"Não tenho tempo": "A reunião é só 30 minutos e pode ser no horário que for melhor para você."

REGRAS DE LINGUAGEM:
Responda sempre em português brasileiro.
Seja humano, próximo e natural.
Não use emojis.
Não use travessões.
Não use diminutivos.
Nunca coloque negrito em emails, números ou dados pessoais.
Use asterisco simples para negrito: *palavra* e nunca **palavra**.
Faça apenas uma pergunta por mensagem. Esta regra é absoluta.
Mensagens curtas, no máximo três parágrafos.`
      },
      {
        role: 'assistant',
        content: 'Entendido. Estou pronto para atender os clientes da Clique e Fecha seguindo o roteiro.'
      }
    ];
  }

  conversas[userPhone].push({ role: 'user', content: userText });
  const resposta = await chamarClaude(conversas[userPhone]);
  conversas[userPhone].push({ role: 'assistant', content: resposta });

  // Detectar confirmação de agendamento e criar evento
  const confirmaAgendamento = resposta.toLowerCase().includes('link do google meet será enviado');

  if (confirmaAgendamento && agendamentos[userPhone]?.slots?.length > 0) {
    const slots = agendamentos[userPhone].slots;
    const historico = conversas[userPhone].map(m => m.content).join(' ').toLowerCase();
    let slotEscolhido = slots[0];
    if (slots[1] && historico.includes(slots[1].label.split(' às ')[1]?.replace('h', ''))) {
      slotEscolhido = slots[1];
    }

    const emailMatch = historico.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi);
    const emailLead = emailMatch ? emailMatch.find(e => !e.includes('cliqueefecha')) || emailMatch[0] : '';
    const nomeMatch = historico.match(/posso te chamar\?[\s\S]{0,100}?([a-záéíóúâêîôûãõç]+)/i);
    const nome = nomeMatch ? nomeMatch[1] : 'Lead';

    const meetLink = await criarEvento(nome, emailLead, userPhone, slotEscolhido.inicio, slotEscolhido.fim);

    if (meetLink) {
      await enviarMensagem(userPhone, `Aqui está o link da sua consultoria no Google Meet: ${meetLink}\n\nAté lá!`);
      await enviarMensagem(MEU_NUMERO, `*Novo agendamento confirmado!*\n\nNome: ${nome}\nWhatsApp: ${userPhone}\nEmail: ${emailLead}\nHorário: ${slotEscolhido.label}\nMeet: ${meetLink}`);
    } else {
      await enviarMensagem(MEU_NUMERO, `*Novo agendamento confirmado!*\n\nNome: ${nome}\nWhatsApp: ${userPhone}\nEmail: ${emailLead}\nHorário: ${slotEscolhido.label}\n\nAtenção: link do Meet não foi gerado automaticamente.`);
    }
  }

  await enviarMensagem(userPhone, resposta);
  res.sendStatus(200);
});

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
