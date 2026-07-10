// Limpa os dados de TESTE deste CLIENT_ID no banco do CRM — rodar UMA vez
// antes de ir ao ar com leads reais, para as métricas não nascerem poluídas
// pelos ~150 leads do seed-leads.js.
//
// Apaga (só do CLIENT_ID configurado no ambiente):
//   - leads            (conversations cai junto, FK ON DELETE CASCADE)
//   - ai_activity      (feed "Atividade da IA")
//   - bot_state        (memória de conversas do bot)
//   - meeting_analyses (análises de reunião; disc/roda/plano caem em cascata)
// Mantém: clients, user_clients, vendedores.
//
// Com --tudo, apaga TAMBÉM user_clients e o próprio registro em clients.
// É seguro: o bot re-registra o CLIENT_ID no próximo boot (auto-registro do
// initDb) e o usuário do painel se re-vincula no primeiro login (bootstrap
// do verificarToken).
//
// Uso (Railway Console do serviço whatsapp-bot, igual ao seed-leads.js):
//   node limpar-leads-teste.js --confirmo           (mantém clients/user_clients)
//   node limpar-leads-teste.js --confirmo --tudo    (zera 100%, todas as tabelas)
//
// Sem o --confirmo o script só mostra as contagens (dry-run).

require('dotenv/config');
const { Pool } = require('pg');

const CLIENT_ID = process.env.CLIENT_ID;
if (!CLIENT_ID) {
  console.error('CLIENT_ID não configurado no ambiente. Abortando.');
  process.exit(1);
}

// Mesma regra de SSL do index.js
function resolverSslPostgres() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway.internal')) return false;
  if (process.env.DB_CA_CERT) return { ca: process.env.DB_CA_CERT, rejectUnauthorized: true };
  return { rejectUnauthorized: false };
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: resolverSslPostgres() });

const confirmado = process.argv.includes('--confirmo');
const limparTudo = process.argv.includes('--tudo');

async function contar(tabela) {
  try {
    const r = await pool.query(`SELECT COUNT(*) AS n FROM ${tabela} WHERE client_id = $1`, [CLIENT_ID]);
    return Number(r.rows[0].n);
  } catch {
    return null; // tabela pode não existir (ex.: meeting_analyses antes do agente rodar)
  }
}

async function main() {
  console.log(`Banco: ${(process.env.DATABASE_URL || '').replace(/:[^:@/]+@/, ':***@')}`);
  console.log(`CLIENT_ID: ${CLIENT_ID}\n`);

  const antes = {
    leads: await contar('leads'),
    conversations: await contar('conversations'),
    ai_activity: await contar('ai_activity'),
    bot_state: await contar('bot_state'),
    meeting_analyses: await contar('meeting_analyses'),
    tasks: await contar('tasks'),
  };
  if (limparTudo) {
    antes.user_clients = await contar('user_clients');
    try {
      const r = await pool.query('SELECT COUNT(*) AS n FROM clients WHERE id = $1', [CLIENT_ID]);
      antes.clients = Number(r.rows[0].n);
    } catch {
      antes.clients = null;
    }
  }
  console.log('Registros deste client_id:');
  for (const [tabela, n] of Object.entries(antes)) {
    console.log(`  ${tabela.padEnd(18)} ${n === null ? '(tabela não existe)' : n}`);
  }

  if (!confirmado) {
    console.log('\nDry-run: nada foi apagado. Para apagar de verdade:');
    console.log('  node limpar-leads-teste.js --confirmo');
    return;
  }

  console.log('\nApagando...');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // meeting_analyses primeiro (referencia leads); disc/roda/plano caem em cascata
    if (antes.meeting_analyses !== null) {
      await client.query('DELETE FROM meeting_analyses WHERE client_id = $1', [CLIENT_ID]);
    }
    // conversations cai em cascata com leads, mas apagar explícito não custa
    if (antes.conversations !== null) {
      await client.query('DELETE FROM conversations WHERE client_id = $1', [CLIENT_ID]);
    }
    // tasks antes de leads: lead_id é SET NULL no delete do lead, então
    // limpar depois deixaria tarefas órfãs (sem lead) sobrando no banco
    if (antes.tasks !== null) {
      await client.query('DELETE FROM tasks WHERE client_id = $1', [CLIENT_ID]);
    }
    await client.query('DELETE FROM leads WHERE client_id = $1', [CLIENT_ID]);
    await client.query('DELETE FROM ai_activity WHERE client_id = $1', [CLIENT_ID]);
    await client.query('DELETE FROM bot_state WHERE client_id = $1', [CLIENT_ID]);
    if (limparTudo) {
      await client.query('DELETE FROM user_clients WHERE client_id = $1', [CLIENT_ID]);
      // Por último: clients é referenciado pelas outras (ON DELETE CASCADE cobriria,
      // mas os deletes explícitos acima deixam as contagens claras)
      await client.query('DELETE FROM clients WHERE id = $1', [CLIENT_ID]);
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  console.log('Feito. Contagens após a limpeza:');
  for (const tabela of Object.keys(antes)) {
    if (antes[tabela] === null || tabela === 'clients') continue;
    console.log(`  ${tabela.padEnd(18)} ${await contar(tabela)}`);
  }
  console.log('\nIMPORTANTE: reinicie o serviço do bot (Railway → Restart) para limpar');
  console.log('o estado em memória (conversas, agendamentos, lembretes pendentes).');
  if (limparTudo) {
    console.log('Como --tudo apagou clients/user_clients: o restart re-registra o cliente');
    console.log('automaticamente, e o primeiro login no painel re-vincula o seu usuário.');
  }
}

main()
  .catch(err => { console.error('Erro:', err.message); process.exitCode = 1; })
  .finally(() => pool.end());
