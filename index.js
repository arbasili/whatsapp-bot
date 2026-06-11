const express = require('express');
const axios = require('axios');
const { google } = require('googleapis');
require('dotenv/config');

const app = express();
app.use(express.json());

const conversas = {};
const agendamentos = {};

// Credenciais do Google Calendar via variável de ambiente
const serviceAccountKey = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
const CALENDAR_ID = 'cliquee.fecha@gmail.com';

const auth = new google.auth.GoogleAuth({
  credentials: serviceAccountKey,
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

const calendar = google.calendar({ version: 'v3', auth });

// Busca horários disponíveis nos próximos 2 dias úteis
async function buscarHorariosDisponiveis() {
  const agora = new Date();
  const horaCG = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Campo_Grande' }));
  
  const slots = [];
  let diasVerificados = 0;
  let diaAtual = new Date(horaCG);

  while (slots.length < 2 && diasVerificados < 5) {
    const diaSemana = diaAtual.getDay();
    
    // Pular fins de semana
    if (diaSemana === 0 || diaSemana === 6) {
      diaAtual.setDate(diaAtual.getDate() + 1);
      diasVerificados++;
      continue;
    }

    // Horários candidatos: 9h, 10h, 11h, 14h, 15h, 16h, 17h
    const horariosCandiatos = [9, 10, 11, 14, 15, 16, 17];

    for (const hora of horariosCandiatos) {
      if (slots.length >= 2) break;

      const inicio = new Date(diaAtual);
      inicio.setHours(hora, 0, 0, 0);
      const fim = new Date(inicio);
      fim.setMinutes(fim.getMinutes() + 30);

      // Ignorar horários no passado ou com menos de 2h de antecedência
      const minAntes = new Date(horaCG.getTime() + 2 * 60 * 60 * 1000);
      if (inicio <= minAntes) continue;

      // Verificar se o horário está livre na agenda
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
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            timeZone: 'America/Campo_Grande'
          });
          slots.push({
            label: `${nomeDia} às ${hora}h`,
            inicio: inicio.toISOString(),
            fim: fim.toISOString(),
          });
        }
      } catch (err) {
        console.error('Erro ao verificar agenda:', err.message);
      }
    }

    diaAtual.setDate(diaAtual.getDate() + 1);
    diasVerificados++;
  }

  return slots;
}

// Cria evento no Google Calendar
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

  if (!conversas[userPhone]) {
    // Buscar horários com timeout de 5 segundos
    let opcoesHorario = 'amanhã às 10h ou amanhã às 14h';
    let slotsDisponiveis = [];

    try {
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000));
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
Cumprimente de forma natural e acessível. Diga que é do time de atendimento da Clique e Fecha. Faça apenas esta pergunta: "Para começar, como posso te chamar?"

2. ENTENDER A NECESSIDADE
Use o nome da pessoa a partir daqui. Pergunte qual é o maior desafio de atendimento da empresa hoje. Demonstre que entendeu o problema e relacione com o que a Clique e Fecha resolve.

3. QUALIFICAR
Pergunte qual tipo de negócio a pessoa tem. Entenda se já usa alguma ferramenta de atendimento ou automação. Se o perfil for de pequena empresa local, avance para o agendamento.

4. AGENDAR A REUNIÃO
Siga esta sequência obrigatória, uma mensagem por vez:
a. Primeiro pergunte se faz sentido agendar uma conversa rápida com a equipe. Exemplo: "Faz sentido marcarmos uma conversa rápida para entender melhor o seu caso?"
b. Somente após a confirmação do cliente, ofereça os horários disponíveis: "Tenho disponível ${opcoesHorario}. Qual funciona melhor para você?"
c. Após a escolha do horário, confirme o WhatsApp: "Posso usar o número ${userPhone} para contato, ou prefere outro?"
d. Após confirmar o WhatsApp, peça o email.

5. CONFIRMAÇÃO
Confirme todos os dados: nome, WhatsApp, email e horário escolhido. Informe que o link do Google Meet será enviado em até 24 horas.

6. APÓS O AGENDAMENTO
Continue presente e disponível. Responda qualquer pergunta de forma natural e completa, sem pressa de encerrar. Somente se despeça quando o cliente der sinais claros de encerramento como "obrigado", "até logo" ou "combinado". Nesse caso, encerre com leveza: "Fico à disposição se precisar de mais alguma coisa. Até lá!"

TRATAMENTO DE OBJEÇÕES:

Quando o cliente disser "agora não", "não tenho tempo" ou similar:
Não aceite de imediato. Demonstre compreensão e investigue o motivo com uma pergunta gentil. Exemplo: "Entendo. Só para eu saber, tem alguma coisa que ficou sem resposta ou posso esclarecer algo agora?" Se ele confirmar que não quer, ofereça reagendamento: "Sem problema. Quando for melhor para você, é só me chamar aqui que marco um horário."

Quando o cliente disser "está caro" ou perguntar sobre preço:
Reforce que a consultoria é completamente gratuita e sem compromisso. Esclareça que os valores das soluções são apresentados apenas durante a reunião, de acordo com cada caso.

Quando o cliente disser "já tenho alguém que faz isso":
Não confronte. Demonstre respeito e explore se está satisfeito. Se estiver insatisfeito, apresente a consultoria como oportunidade de comparar. Se estiver satisfeito, encerre com gentileza.

Quando o cliente disser "não tenho tempo agora":
Valide e ofereça flexibilidade. Exemplo: "Entendo, a rotina de quem tem negócio é puxada. A reunião é só 30 minutos e pode ser no horário que for melhor para você. Tem algum dia da semana que costuma ser mais tranquilo?"

REGRAS DE LINGUAGEM:
Responda sempre em português brasileiro.
Seja humano, próximo e natural, como se fosse uma conversa real entre pessoas.
Não use emojis.
Não use travessões.
Não use diminutivos.
Nunca coloque negrito em emails, números de telefone ou dados pessoais do cliente.
Quando precisar destacar algo, use apenas um asterisco de cada lado, colado na palavra, sem espaço. Exemplo: *Clique e Fecha*.
Faça apenas uma pergunta por mensagem, nunca duas ao mesmo tempo. Esta regra é absoluta.
Mensagens curtas e diretas, no máximo três parágrafos por resposta.`
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
  const confirmaAgendamento = resposta.toLowerCase().includes('link do google meet') &&
    resposta.toLowerCase().includes('24 horas');

  if (confirmaAgendamento && agendamentos[userPhone]?.slots?.length > 0) {
    const slots = agendamentos[userPhone].slots;
    const historico = conversas[userPhone].map(m => m.content).join(' ').toLowerCase();
    let slotEscolhido = slots[0];
    if (slots[1] && historico.includes(slots[1].label.split(' às ')[1]?.replace('h', ''))) {
      slotEscolhido = slots[1];
    }

    const nomeMatch = historico.match(/me chamo ([a-záéíóúâêîôûãõç ]+)/i) ||
                      historico.match(/meu nome é ([a-záéíóúâêîôûãõç ]+)/i);
    const emailMatch = historico.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    const nome = nomeMatch ? nomeMatch[1].trim() : 'Lead';
    const email = emailMatch ? emailMatch[0] : '';

    const meetLink = await criarEvento(nome, email, userPhone, slotEscolhido.inicio, slotEscolhido.fim);
    if (meetLink) {
      await enviarMensagem(userPhone, `Aqui está o link da sua consultoria no Google Meet: ${meetLink}`);
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
