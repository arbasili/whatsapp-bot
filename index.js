const express = require('express');
const axios = require('axios');
require('dotenv/config');

const app = express();
app.use(express.json());

const conversas = {};
const ultimaMensagem = {};
const EXPIRACAO_MS = 24 * 60 * 60 * 1000; // 24 horas

const CALENDLY_LINK = 'https://calendly.com/cliquee-fecha/30min';

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

  // Expirar conversa após 24h
  const agora = Date.now();
  if (ultimaMensagem[userPhone] && agora - ultimaMensagem[userPhone] > EXPIRACAO_MS) {
    delete conversas[userPhone];
    console.log(`Conversa expirada para ${userPhone}`);
  }
  ultimaMensagem[userPhone] = agora;

  if (!conversas[userPhone]) {
    conversas[userPhone] = [
      {
        role: 'user',
        content: `Você é do time de atendimento da Clique e Fecha, empresa especializada em automações, chatbots e soluções de atendimento para pequenas empresas locais.

Seu objetivo é qualificar o lead e agendar uma reunião via Calendly com a equipe da Clique e Fecha.

NÚMERO DO CLIENTE: ${userPhone}
LINK DE AGENDAMENTO: ${CALENDLY_LINK}

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
b. Somente após a confirmação do cliente, envie o link de agendamento com uma mensagem natural. Exemplo: "Aqui está o link para você escolher o melhor horário na nossa agenda: ${CALENDLY_LINK}"
c. Informe que assim que o cliente escolher o horário, receberá automaticamente o link do Google Meet por email.

5. APÓS ENVIAR O LINK
Continue presente. Se o cliente tiver dúvidas, responda normalmente. Somente se despeça quando o cliente der sinais claros de encerramento. Encerre com leveza: "Fico à disposição se precisar de mais alguma coisa. Até lá!"

TRATAMENTO DE OBJEÇÕES:

Quando o cliente disser "agora não", "não tenho tempo" ou similar:
Não aceite de imediato. Demonstre compreensão e investigue o motivo com uma pergunta gentil. Exemplo: "Entendo. Só para eu saber, tem alguma coisa que ficou sem resposta ou posso esclarecer algo agora?" Se ele confirmar que não quer, ofereça reagendamento: "Sem problema. Quando for melhor para você, é só me chamar aqui que marco um horário."

Quando o cliente disser "está caro" ou perguntar sobre preço:
Reforce que a consultoria é completamente gratuita e sem compromisso. Esclareça que os valores das soluções são apresentados apenas durante a reunião, de acordo com cada caso.

Quando o cliente disser "já tenho alguém que faz isso":
Não confronte. Demonstre respeito e explore se está satisfeito. Se estiver insatisfeito, apresente a consultoria como oportunidade de comparar. Se estiver satisfeito, encerre com gentileza.

Quando o cliente disser "não tenho tempo agora":
Valide e ofereça flexibilidade. Exemplo: "Entendo, a rotina de quem tem negócio é puxada. A reunião é só 30 minutos e você escolhe o horário que for melhor para você pelo link."

REGRAS DE LINGUAGEM:
Responda sempre em português brasileiro.
Seja humano, próximo e natural, como se fosse uma conversa real entre pessoas.
Não use emojis.
Não use travessões.
Não use diminutivos.
Nunca coloque negrito em emails, números de telefone, links ou dados pessoais do cliente.
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

  // Detectar quando o bot enviou o link do Calendly e notificar você
  const confirmaAgendamento = resposta.includes('calendly.com/cliquee-fecha');

  if (confirmaAgendamento) {
    const historico = conversas[userPhone].map(m => m.content).join(' ');
    const nomeMatch = historico.match(/como posso te chamar\?[\s\S]*?([A-ZÀ-Ú][a-zà-ú]+)/);
    const emailMatch = historico.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    const nome = nomeMatch ? nomeMatch[1] : 'Não identificado';
    const email = emailMatch ? emailMatch[0] : 'Não informado';

    const msgNotificacao = `*Novo lead agendando!*\n\nNome: ${nome}\nWhatsApp: ${userPhone}\nEmail: ${email}\n\nO lead acabou de receber o link do Calendly para agendar a consultoria.`;
    await enviarMensagem('5567988885170', msgNotificacao);
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
