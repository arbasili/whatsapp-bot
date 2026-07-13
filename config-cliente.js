// ============================================================================
// CONFIG DO CLIENTE — o "cérebro" configurável do bot (um por deploy).
// ============================================================================
// Onboarding de um novo cliente = copiar este arquivo e preencher os campos.
// Nada de identidade, oferta ou agenda fica mais chumbado no index.js.
// A mecânica (lógica de agendamento, heurísticas, jobs) continua compartilhada.
//
// Fase 1 (agora): você edita este arquivo. Fase 2 (depois): uma tela no painel
// escreve neste mesmo formato, sem tocar em código.

module.exports = {
  // ── Identidade do atendente e da empresa ──────────────────────────────────
  persona: {
    atendente: 'Lucas',            // nome que o bot usa e assina
    empresa: 'Clique e Fecha',     // nome da empresa
    // Frase de posicionamento — o "o que a gente faz" numa linha:
    pitch: 'A gente ajuda empresas a venderem mais sem perder tempo no atendimento.',
  },

  // ── O que a empresa vende / contexto de negócio ───────────────────────────
  negocio: {
    // Descrição curta usada na apresentação ("empresa especializada em ...")
    descricao: 'automações, chatbots e soluções de atendimento para pequenas empresas locais',
    servicos: 'automações de processos, chatbots personalizados e soluções de atendimento automatizado',
    publico: 'pequenas empresas que querem atender mais clientes sem aumentar a equipe',
    atuacao: 'atende empresas em todo o Brasil (atendimento e reuniões são online)',
    // A dor central que o bot busca e ancora (ex: "perder cliente por demora")
    dorFoco: 'perder cliente por demora no atendimento do WhatsApp',
  },

  // ── A oferta / próximo passo (o que o bot agenda) ─────────────────────────
  oferta: {
    // Descrição do próximo passo oferecido ao lead
    proximoPasso: 'conversa gratuita de 30 minutos via Google Meet, sem compromisso',
    quemConduz: 'especialista',    // quem conduz a reunião ("um especialista da ...")
    duracaoMin: 30,
    canal: 'Google Meet',
  },

  // ── Agenda ─────────────────────────────────────────────────────────────────
  agenda: {
    // Antes estava hardcoded no index.js — agora é por cliente.
    calendarId: process.env.CALENDAR_ID || 'comercial@cliqueefecha.com.br',
    // Email do Google Workspace que a conta de serviço PERSONIFICA pra acessar a
    // agenda (normalmente o mesmo do calendarId). Sem isto certo, o agendamento
    // no Google Calendar quebra num cliente novo — a conta de serviço tentaria
    // personificar o email da outra empresa e a autenticação falharia.
    googleSubject: process.env.GOOGLE_SUBJECT || 'comercial@cliqueefecha.com.br',
  },

  // ── Domínio próprio da empresa ────────────────────────────────────────────
  // Parte identificável do email/domínio da empresa. Usado pra NÃO confundir o
  // email da própria empresa com o do lead ao extrair endereços da conversa.
  empresa: {
    dominio: 'cliqueefecha',
  },

  // ── Plano contratado — quais módulos este cliente tem ─────────────────────
  // Referência única do que o cliente comprou. "Só o bot" = crm/raiox false.
  plano: {
    crm: true,     // painel CRM (Home, Kanban, Dashboard, tarefas, Analista IA)
    raiox: true,   // Raio-X do time (serviço agente-reunioes)
  },
}
