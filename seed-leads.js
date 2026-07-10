// seed-leads.js — Rodar no Railway Console do BOT
// Uso: node seed-leads.js
// Requer: DATABASE_URL e CLIENT_ID já configurados como variáveis de ambiente

const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const CLIENT_ID = process.env.CLIENT_ID;

// ─── Dados realistas brasileiros ───

const NOMES = [
  'Ana Silva', 'Bruno Costa', 'Carla Oliveira', 'Diego Santos', 'Elena Ferreira',
  'Felipe Almeida', 'Gabriela Lima', 'Henrique Souza', 'Isabela Rodrigues', 'João Pereira',
  'Karina Martins', 'Lucas Araújo', 'Mariana Barbosa', 'Nicolas Gomes', 'Patrícia Ribeiro',
  'Rafael Carvalho', 'Sofia Nascimento', 'Thiago Fernandes', 'Vanessa Rocha', 'Wagner Monteiro',
  'Amanda Teixeira', 'Bernardo Dias', 'Camila Moura', 'Daniel Correia', 'Eduarda Lopes',
  'Fernando Vieira', 'Giovanna Cardoso', 'Hugo Mendes', 'Juliana Pinto', 'Leonardo Nunes',
  'Marcela Duarte', 'Nathan Castro', 'Olivia Ramos', 'Paulo Freitas', 'Renata Melo',
  'Samuel Moreira', 'Tatiana Campos', 'Victor Azevedo', 'Yasmin Borges', 'André Fonseca',
  'Bianca Cruz', 'Caio Machado', 'Débora Cunha', 'Eduardo Reis', 'Fernanda Andrade',
  'Guilherme Medeiros', 'Helena Batista', 'Igor Tavares', 'Larissa Nogueira', 'Matheus Guimarães',
  'Natália Sampaio', 'Otávio Braga', 'Priscila Vasconcelos', 'Ricardo Queiroz', 'Simone Teles',
  'Tomás Xavier', 'Úrsula Barreto', 'Vinícius Paiva', 'Xuxa Alencar', 'Zélia Miranda',
  'Adriana Lacerda', 'Breno Siqueira', 'Cíntia Rezende', 'Davi Pacheco', 'Elisa Farias',
  'Flávio Damasceno', 'Gisele Cabral', 'Humberto Coelho', 'Irene Valente', 'José Pimentel',
  'Karen Aguiar', 'Luan Bittencourt', 'Monica Amorim', 'Neto Figueredo', 'Olga Barros',
  'Pedro Leal', 'Queila Magalhães', 'Rogério Carneiro', 'Sílvia Prado', 'Tales Dantas',
  'Uriel Souto', 'Vera Mota', 'Wesley Rangel', 'Ximena Porto', 'Yago Leão',
  'Zilda Marques', 'Alex Bonfim', 'Betina Assis', 'Cléber Toledo', 'Denise Sena',
  'Elton Viana', 'Fabiana Rios', 'Geovana Coutinho', 'Heitor Galvão', 'Ingrid Simões',
  'Joaquim Serra', 'Lara Felício', 'Miguel Trindade', 'Noemi Lira', 'Oscar Brandão',
];

const SEGMENTOS = [
  'Pet shop', 'Clínica estética', 'Barbearia', 'Restaurante', 'Loja de roupas',
  'Academia', 'Clínica odontológica', 'Oficina mecânica', 'Salão de beleza', 'Imobiliária',
  'Escritório de advocacia', 'Consultório médico', 'Escola de idiomas', 'Estúdio de pilates',
  'Loja de materiais', 'Padaria', 'Ótica', 'Farmácia', 'Clínica veterinária', 'Agência de marketing',
  'Contabilidade', 'Loja de celulares', 'Floricultura', 'Estúdio de tatuagem', 'Autoescola',
];

const DORES = [
  'Demora no atendimento por falta de equipe, causando perda de clientes',
  'Não consegue responder todos os clientes no WhatsApp a tempo',
  'Perde muitos leads porque não tem quem atenda fora do horário comercial',
  'Os atendentes não seguem o script e perdem vendas',
  'Recebe muitas mensagens no Instagram mas não converte em vendas',
  'Gasta muito tempo respondendo perguntas repetitivas dos clientes',
  'Não tem controle de quantos leads entram por mês e quantos convertem',
  'Clientes reclamam da demora e vão para o concorrente',
  'Precisa de alguém para qualificar os leads antes de passar pro comercial',
  'Tem muitos seguidores mas poucos viram clientes',
  'O time comercial não faz follow-up dos leads antigos',
  'Perde oportunidades porque não tem agenda organizada',
  'Quer automatizar o primeiro contato para filtrar curiosos de compradores',
  'Tem dificuldade em agendar reuniões com os leads qualificados',
  'Precisa de um sistema para acompanhar o funil de vendas',
];

const ORIGENS = ['WhatsApp direto', 'Instagram', 'Site', 'Indicação', 'Anúncio'];

const URGENCIAS = ['imediata', 'próximos dias', 'próximo mês', 'sem urgência'];

const STATUS_DIST = [
  // status, peso (quanto maior, mais leads nessa etapa)
  { status: 'Em conversa',          siglas: '[EM]',                         peso: 25 },
  { status: 'Qualificando',         siglas: '[EM][QA]',                     peso: 18 },
  { status: 'Pronto para agendar',  siglas: '[EM][QA][PA]',                 peso: 15 },
  { status: 'Reativação 3 dias',    siglas: '[EM][QA][PA][R3]',             peso: 8 },
  { status: 'Reativação 7 dias',    siglas: '[EM][QA][PA][R3][R7]',         peso: 5 },
  { status: 'Perdido sem resposta', siglas: '[EM][QA][PA][R3][R7][PS]',     peso: 6 },
  { status: 'Reunião agendada',     siglas: '[EM][QA][PA][RA]',             peso: 20 },
  { status: 'Reunião realizada',    siglas: '[EM][QA][PA][RA][RR]',         peso: 15 },
  { status: 'Proposta',             siglas: '[EM][QA][PA][RA][RR][PR]',     peso: 10 },
  { status: 'Negociação',           siglas: '[EM][QA][PA][RA][RR][PR][NG]', peso: 8 },
  { status: 'Fechado e Venda',      siglas: '[EM][QA][PA][RA][RR][PR][NG][FV]', peso: 12 },
  { status: 'Fechado e Perdido',    siglas: '[EM][QA][PA][RA][RR][FP]',     peso: 8 },
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function randomPhone() {
  const ddd = pick(['11','21','31','41','51','61','67','62','71','81','85','27','48','47']);
  return `55${ddd}9${rand(1000,9999)}${rand(1000,9999)}`;
}

function randomDate(daysBack) {
  const d = new Date();
  d.setDate(d.getDate() - rand(0, daysBack));
  d.setHours(rand(7, 22), rand(0, 59), 0, 0);
  // "0 dias atrás" com hora sorteada à frente do relógio caía no FUTURO e o
  // painel mostrava "-393min" no card
  if (d > new Date()) d.setDate(d.getDate() - 1);
  return d.toISOString();
}

function randomScheduledAt() {
  const d = new Date();
  d.setDate(d.getDate() + rand(-3, 7)); // passado recente ou futuro próximo
  d.setHours(rand(8, 18), pick([0, 30]), 0, 0);
  return d.toISOString();
}

function pickWeighted() {
  const totalPeso = STATUS_DIST.reduce((s, x) => s + x.peso, 0);
  let r = Math.random() * totalPeso;
  for (const item of STATUS_DIST) {
    r -= item.peso;
    if (r <= 0) return item;
  }
  return STATUS_DIST[0];
}

function gerarInsights(segmento, dor, urgencia, temp) {
  const insights = [];
  if (temp === 'quente') insights.push('Demonstrou alto interesse');
  if (urgencia === 'imediata') insights.push('Urgência declarada');
  insights.push(rand(0,1) ? 'Respondeu rapidamente' : 'Fez perguntas sobre o serviço');
  if (rand(0,1)) insights.push('Aceitou reunião sem objeções');

  const objecoes = [
    'Preço ainda não discutido',
    'Quer consultar o sócio antes',
    'Comparando com outro fornecedor',
    'Precisa ver ROI antes de decidir',
    null, null, // sem objeção
  ];

  const recs = [];
  recs.push(pick(['Mostrar casos de sucesso do segmento', 'Apresentar ROI esperado', 'Enviar proposta personalizada']));
  if (rand(0,1)) recs.push(pick(['Fazer follow-up em 24h', 'Agendar demonstração', 'Enviar depoimentos de clientes']));

  return {
    insights,
    objecao_principal: pick(objecoes),
    recomendacoes: recs,
    tempo_followup_ideal_h: pick([12, 24, 48]),
  };
}

function gerarBullets(segmento, dor) {
  return {
    summary_bullets: [
      { label: 'Segmento', valor: segmento },
      { label: 'Atendimento', valor: pick(['Manual no WhatsApp', 'Time pequeno', 'Sem automação', 'Usa planilha']) },
      { label: 'Principal dor', valor: dor.split(',')[0] },
      { label: 'Interesse', valor: pick(['Muito alto', 'Alto', 'Moderado']) },
    ]
  };
}

async function seed() {
  console.log(`🌱 Gerando 150 leads para client_id=${CLIENT_ID}...\n`);

  const contagem = {};
  let inseridos = 0;

  for (let i = 0; i < 150; i++) {
    const nome = NOMES[i % NOMES.length];
    const segmento = pick(SEGMENTOS);
    const dor = pick(DORES);
    const origem = pick(ORIGENS);
    const urgencia = pick(URGENCIAS);
    const statusItem = pickWeighted();

    const temp = urgencia === 'imediata' ? 'quente'
      : urgencia === 'próximos dias' ? (rand(0,1) ? 'quente' : 'morno')
      : urgencia === 'próximo mês' ? 'morno'
      : (rand(0,2) === 0 ? 'morno' : 'frio');

    const score = temp === 'quente' ? rand(70, 98)
      : temp === 'morno' ? rand(40, 75)
      : rand(10, 45);

    const closeProb = Math.min(98, score + rand(-10, 10));

    // Só ações HUMANAS do vendedor — 'Enviar lembrete' saiu porque o bot já
    // envia lembretes sozinho (mesma regra do prompt real, bot v1.10.10)
    const nextActions = ['Realizar consultoria', 'Enviar proposta', 'Fazer follow-up', 'Agendar reunião', 'Preparar demonstração', 'Ligar para o lead'];
    const nextAction = pick(nextActions);

    const created = randomDate(30);
    const updated = randomDate(5);

    const insights = gerarInsights(segmento, dor, urgencia, temp);
    const bullets = gerarBullets(segmento, dor);

    // Só gera scheduled_at para status que passaram pelo agendamento
    const temAgendamento = ['Reunião agendada', 'Reunião realizada', 'Proposta', 'Negociação', 'Fechado e Venda', 'Fechado e Perdido'].includes(statusItem.status);
    const scheduledAt = temAgendamento ? randomScheduledAt() : null;

    const meetLink = temAgendamento && rand(0, 1) ? `https://meet.google.com/${rand(100,999)}-${rand(100,999)}-${rand(100,999)}` : null;

    const summary = `${nome.split(' ')[0]} possui ${segmento.toLowerCase()} e ${dor.toLowerCase()}. ${
      temp === 'quente' ? 'Demonstrou interesse imediato em solução automatizada.' :
      temp === 'morno' ? 'Mostrou interesse mas quer avaliar antes.' :
      'Está pesquisando opções no mercado.'
    }`;

    const email = `${nome.toLowerCase().replace(/ /g, '.').normalize('NFD').replace(/[\u0300-\u036f]/g, '')}@gmail.com`;
    const phone = randomPhone();

    // Valor estimado da oportunidade (mensalidade t\u00edpica de automa\u00e7\u00e3o de
    // atendimento). ~20% ficam sem valor: nem todo lead foi qualificado a ponto
    // de ter estimativa, e o painel precisa lidar bem com o campo vazio.
    const dealValue = rand(0, 4) === 0 ? null : pick([297, 397, 497, 597, 797, 997, 1297, 1497]);

    try {
      await pool.query(
        `INSERT INTO leads (
          name, phone, email, business_type, pain, urgency, status, temperature,
          score, close_probability, next_action, next_action_at,
          ai_insights, summary, summary_bullets,
          origin, meet_link, scheduled_at, funnel_stages,
          created_at, updated_at, client_id, deal_value
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12,
          $13, $14, $15,
          $16, $17, $18, $19,
          $20, $21, $22, $23
        )`,
        [
          nome, phone, email, segmento, dor, urgencia, statusItem.status, temp,
          score, closeProb, nextAction, scheduledAt,
          JSON.stringify(insights), summary, JSON.stringify(bullets),
          origem, meetLink, scheduledAt, statusItem.siglas,
          created, updated, CLIENT_ID, dealValue,
        ]
      );
      inseridos++;
      contagem[statusItem.status] = (contagem[statusItem.status] || 0) + 1;
    } catch (err) {
      console.error(`Erro inserindo ${nome}:`, err.message);
    }
  }

  console.log(`✅ ${inseridos} leads inseridos!\n`);
  console.log('Distribuição por etapa:');
  for (const [status, qtd] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${status}: ${qtd}`);
  }

  // Registrar atividade da IA para o feed
  const atividades = [
    'Qualificou', 'Agendou reunião', 'Detectou urgência',
    'Criou reunião', 'Enviou lembrete', 'Reativou',
  ];

  try {
    for (let i = 0; i < 15; i++) {
      const nome = pick(NOMES);
      const acao = pick(atividades);
      const quando = randomDate(2);
      await pool.query(
        `INSERT INTO ai_activity (acao, lead_name, created_at, client_id) VALUES ($1, $2, $3, $4)`,
        [acao, nome.split(' ')[0], quando, CLIENT_ID]
      );
    }
    console.log('\n✅ 15 registros de atividade da IA inseridos!');
  } catch (err) {
    console.log('\n⚠️  Tabela ai_activity não encontrada (ok, o feed fica vazio):', err.message);
  }

  await pool.end();
  console.log('\n🎉 Seed completo! Abre o painel e vê o resultado.');
}

seed().catch(err => { console.error('Erro fatal:', err); process.exit(1); });
