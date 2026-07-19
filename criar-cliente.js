// criar-cliente.js — Onboarding de um cliente novo (ou vínculo de usuário novo)
//
// Uso:
//   node criar-cliente.js --nome "Empresa X" --usuario dono@empresax.com
//   node criar-cliente.js --nome "Empresa X" --usuario dono@empresax.com --convidar
//   node criar-cliente.js --client-id <UUID> --usuario segundo@empresax.com
//
// O que faz:
//   1. Resolve o usuário no Supabase Auth PRIMEIRO (com --convidar, envia o
//      convite por email). Se não der pra resolver, o script para antes de
//      criar qualquer coisa no banco (nada de cliente órfão; re-rodar funciona).
//   2. Numa transação: cria (ou reaproveita) a linha em clients e vincula o
//      usuário em user_clients (role 'admin'). Ou os dois existem, ou nenhum.
//   3. Imprime o CLIENT_ID e o checklist do que continua manual (Railway,
//      Meta, Calendar...).
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
  --email-empresa  Email comercial do cliente (opcional; padrão usa um placeholder por UUID)
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
// pagina a lista, ok pro volume de um SaaS começando)
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
  // ── 1. Usuário PRIMEIRO ──────────────────────────────────────────────────
  // Resolver o usuário antes de tocar no banco garante que uma falha aqui (o
  // caso comum: usuário ainda não existe e faltou --convidar) não deixe um
  // cliente órfão. Assim, corrigir e re-rodar simplesmente funciona.
  let usuario = await buscarUsuario(USUARIO);
  if (!usuario && CONVIDAR) {
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(USUARIO);
    if (error) throw new Error(`Convite falhou: ${error.message}`);
    usuario = data.user;
    console.log(`Convite enviado para ${USUARIO}. A pessoa define a senha pelo link do email.`);
  }
  if (!usuario) {
    console.error(`
Usuário ${USUARIO} não existe no Supabase Auth. Nada foi criado no banco.
Rode de novo com --convidar (envia convite por email), ou crie o usuário no
dashboard do Supabase (Authentication > Users > Add user) e rode de novo.`);
    process.exit(1);
  }

  // ── 2. Cliente + vínculo numa TRANSAÇÃO ──────────────────────────────────
  // Atômico: ou o cliente e o vínculo existem juntos, ou nada é gravado.
  const db = await pool.connect();
  let clientId = CLIENT_ID_ARG;
  try {
    await db.query('BEGIN');

    if (clientId) {
      const { rows } = await db.query('SELECT id, name FROM clients WHERE id = $1', [clientId]);
      if (rows.length === 0) throw new Error(`Cliente ${clientId} não existe. Pra criar um novo, use --nome em vez de --client-id.`);
      console.log(`Cliente existente: ${rows[0].name} (${clientId})`);
    } else {
      clientId = crypto.randomUUID();
      // Email da empresa: usa --email-empresa se veio; senão um placeholder ÚNICO
      // por UUID (mesma convenção do auto-registro do bot). Nunca o email de login
      // do usuário, que colidiria no UNIQUE(email) se o mesmo admin tiver 2 clientes.
      const emailCliente = EMAIL_EMPRESA || `${clientId}@cliqueefecha.com.br`;
      await db.query(
        `INSERT INTO clients (id, name, email) VALUES ($1, $2, $3)`,
        [clientId, NOME, emailCliente]
      );
      console.log(`Cliente criado: ${NOME}`);
      console.log(`CLIENT_ID: ${clientId}  (guarde: vai nas variáveis do deploy novo)`);
    }

    const vinculo = await db.query(
      `INSERT INTO user_clients (user_id, client_id, role) VALUES ($1, $2, 'admin')
       ON CONFLICT (user_id, client_id) DO NOTHING`,
      [usuario.id, clientId]
    );

    await db.query('COMMIT');
    console.log(vinculo.rowCount === 1
      ? `Vínculo criado: ${USUARIO} para o cliente ${clientId} (role admin)`
      : `Vínculo já existia: ${USUARIO} no cliente ${clientId}`);
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e; // sobe pro main().catch: nada ficou gravado pela metade
  } finally {
    db.release();
  }

  // ── 3. O que continua manual ─────────────────────────────────────────────
  console.log(`
──────────────────────────────────────────────────────
Checklist do que falta pro cliente entrar no ar:

[ ] Railway: novo serviço do bot (fork deste repo/deploy) com as variáveis
    do .env.example. Em especial:
      CLIENT_ID=${clientId}
      CLIENT_NAME=${NOME || '(nome do cliente)'}
      CLIENT_EMAIL=${EMAIL_EMPRESA || '(email comercial do cliente)'}
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
