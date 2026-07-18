// criar-cliente.js — Onboarding de um cliente novo (ou vínculo de usuário novo)
//
// Uso:
//   node criar-cliente.js --nome "Empresa X" --usuario dono@empresax.com
//   node criar-cliente.js --nome "Empresa X" --usuario dono@empresax.com --convidar
//   node criar-cliente.js --client-id <UUID> --usuario segundo@empresax.com
//
// O que faz:
//   1. Cria (ou reaproveita) a linha em clients — gera o CLIENT_ID do deploy novo
//   2. Localiza o usuário no Supabase Auth pelo email; com --convidar, envia o
//      convite por email pra pessoa definir a própria senha
//   3. Vincula usuário ↔ cliente em user_clients (role 'admin') — o passo que
//      hoje é INSERT manual (BOT-004)
//   4. Imprime o checklist do que continua manual (Railway, Meta, Calendar...)
//
// Requer no .env desta pasta (gitignored): DATABASE_URL, SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY. Rode da sua máquina ou do console do Railway.

try { require('dotenv').config(); } catch {}

const { Pool } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

// ─── Argumentos ───
function arg(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : null;
}
const NOME = arg('nome');
const USUARIO = (arg('usuario') || '').toLowerCase().trim();
const CLIENT_ID_ARG = arg('client-id');
const EMAIL_EMPRESA = (arg('email-empresa') || '').toLowerCase().trim();
const CONVIDAR = process.argv.includes('--convidar');

if (!USUARIO || (!NOME && !CLIENT_ID_ARG)) {
  console.log(`
Uso:
  node criar-cliente.js --nome "Empresa X" --usuario dono@empresax.com [--email-empresa contato@empresax.com] [--convidar]
  node criar-cliente.js --client-id <UUID existente> --usuario segundo@empresax.com

  --nome           Nome do cliente novo (cria a linha em clients e gera o CLIENT_ID)
  --client-id      UUID de um cliente que JÁ existe (só vincula mais um usuário)
  --usuario        Email de login no painel (Supabase Auth)
  --email-empresa  Email comercial do cliente (opcional; padrão usa o do usuário)
  --convidar       Se o usuário não existir no Supabase, envia convite por email
`);
  process.exit(1);
}

for (const env of ['DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!process.env[env]) { console.error(`Falta ${env} no .env`); process.exit(1); }
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Busca o usuário no Supabase Auth pelo email (a admin API não tem getUserByEmail;
// pagina a lista — ok pro volume de um SaaS começando)
async function buscarUsuario(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new Error(`Supabase listUsers: ${error.message}`);
    const achou = data.users.find(u => (u.email || '').toLowerCase() === email);
    if (achou) return achou;
    if (data.users.length < 100) return null; // última página
  }
  return null;
}

async function main() {
  // ── 1. Cliente ──
  let clientId = CLIENT_ID_ARG;
  if (clientId) {
    const { rows } = await pool.query('SELECT id, name FROM clients WHERE id = $1', [clientId]);
    if (rows.length === 0) {
      console.error(`Cliente ${clientId} não existe. Pra criar um novo, use --nome.`);
      process.exit(1);
    }
    console.log(`Cliente existente: ${rows[0].name} (${clientId})`);
  } else {
    clientId = crypto.randomUUID();
    await pool.query(
      `INSERT INTO clients (id, name, email) VALUES ($1, $2, $3)`,
      [clientId, NOME, EMAIL_EMPRESA || USUARIO]
    );
    console.log(`Cliente criado: ${NOME}`);
    console.log(`CLIENT_ID: ${clientId}  ← guarde, vai nas variáveis do deploy novo`);
  }

  // ── 2. Usuário no Supabase Auth ──
  let usuario = await buscarUsuario(USUARIO);
  if (!usuario && CONVIDAR) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(USUARIO);
    if (error) throw new Error(`Convite falhou: ${error.message}`);
    usuario = data.user;
    console.log(`Convite enviado para ${USUARIO} — a pessoa define a senha pelo link do email.`);
  }
  if (!usuario) {
    console.error(`
Usuário ${USUARIO} não existe no Supabase Auth.
Opções: rode de novo com --convidar (envia convite por email), ou crie o usuário
no dashboard do Supabase (Authentication > Users > Add user) e rode de novo.
O cliente ${clientId} já ficou criado — use --client-id ${clientId} na próxima.`);
    process.exit(1);
  }

  // ── 3. Vínculo user_clients ──
  const vinculo = await pool.query(
    `INSERT INTO user_clients (user_id, client_id, role) VALUES ($1, $2, 'admin')
     ON CONFLICT (user_id, client_id) DO NOTHING`,
    [usuario.id, clientId]
  );
  console.log(vinculo.rowCount === 1
    ? `Vínculo criado: ${USUARIO} → cliente ${clientId} (role admin)`
    : `Vínculo já existia: ${USUARIO} → cliente ${clientId}`);

  // ── 4. O que continua manual ──
  console.log(`
──────────────────────────────────────────────────────
Checklist do que falta pro cliente entrar no ar:

[ ] Railway: novo serviço do bot (fork deste repo/deploy) com as variáveis
    do .env.example — em especial:
      CLIENT_ID=${clientId}
      CLIENT_NAME=${NOME || '(nome do cliente)'}
      CLIENT_EMAIL=${EMAIL_EMPRESA || USUARIO}
      PHONE_NUMBER_ID / WHATSAPP_TOKEN / META_APP_SECRET / VERIFY_TOKEN (Meta do cliente)
      CALENDAR_ID + GOOGLE_SUBJECT (agenda do cliente)
      CORS_ORIGINS (URL do painel do cliente)
      MEU_NUMERO / NUMERO_VENDEDOR
[ ] config-cliente.js do deploy novo: persona, negócio, oferta, plano
[ ] Meta: número WhatsApp Business verificado + webhook apontando pro deploy novo
[ ] Google: agenda do cliente compartilhada com a service account
[ ] Painel: login com ${USUARIO} e conferir que os leads aparecem
──────────────────────────────────────────────────────`);
}

main()
  .catch(err => { console.error('Erro:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
