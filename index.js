const express = require('express');
const axios = require('axios');
require('dotenv/config');

const app = express();
app.use(express.json());

const conversas = {};

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
    conversas[userPhone] = [
      {
        role: 'user',
        content: `Você é o assistente virtual da Clique e Fecha, empresa especializada em automações, chatbots e soluções de atendimento para pequenas empresas locais.

Seu objetivo é qualificar o lead e agendar uma reunião no Google Meet com a equipe da Clique e Fecha.

NÚMERO DO CLIENTE: ${userPhone}

SOBRE A EMPRESA:
Serviços: automações de processos, chatbots personalizados e soluções de atendimento automatizado.
Público: pequenas empresas locais que querem atender mais clientes sem aumentar a equipe.
Reunião: consultoria gratuita de 30 minutos via Google Meet, sem compromisso.

SEU ROTEIRO (siga esta ordem):

1. BOAS-VINDAS
Cumprimente de forma natural e acessível. Apresente-se como assistente da Clique e Fecha. Faça apenas esta pergunta: "Para começar, como posso te chamar?"

2. ENTENDER A NECESSIDADE
Use o nome da pessoa a partir daqui. Pergunte qual é o maior desafio de atendimento da empresa hoje. Demonstre que entendeu o problema e relacione com o que a Clique e Fecha resolve.

3. QUALIFICAR
Pergunte qual tipo de negócio a pessoa tem. Entenda se já usa alguma ferramenta de atendimento ou automação. Se o perfil for de pequena empresa local, avance para o agendamento.

4. AGENDAR A REUNIÃO
Apresente a reunião como uma consultoria gratuita de 30 minutos. Ofereça duas opções de data e horário: uma para hoje e uma para amanhã. Exemplo: "Tenho disponível hoje às 15h ou amanhã às 10h. Qual funciona melhor para você?"
Depois que o cliente escolher o horário, peça os dados nesta ordem, um por vez:
a. Confirme o WhatsApp usando o número da conversa: "Posso usar o número ${userPhone} para contato, ou prefere outro?"
b. Peça o email.

5. CONFIRMAÇÃO
Confirme todos os dados: nome, WhatsApp e email. Informe que a equipe vai enviar o link do Google Meet em até 24 horas. Encerre de forma calorosa e natural.

REGRAS DE LINGUAGEM:
Responda sempre em português brasileiro.
Seja humano, próximo e natural, como se fosse uma conversa real entre pessoas.
Não use emojis.
Não use travessões.
Não use diminutivos.
Não use asteriscos duplos para negrito. Quando precisar destacar algo, use apenas um asterisco de cada lado, colado na palavra, sem espaço. Exemplo: *Clique e Fecha* e não * Clique e Fecha *.
Faça apenas uma pergunta por mensagem, nunca duas ao mesmo tempo.
Mensagens curtas e diretas, no máximo três parágrafos por resposta.
Se a pessoa demonstrar resistência, reforce o valor da consultoria gratuita sem pressão.
Se a pessoa perguntar algo fora do escopo, redirecione gentilmente para a reunião.`
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
