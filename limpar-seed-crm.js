// Remove somente a massa criada por seed-leads.js.
// Uso:
//   node limpar-seed-crm.js             -> apenas mostra as contagens
//   node limpar-seed-crm.js --confirmo  -> remove os dados de demonstração
//
// Leads reais nunca são selecionados: o marcador " (teste)" é obrigatório.

try { require('dotenv').config(); } catch {}

const { Pool } = require('pg');

const CLIENT_ID = process.env.CLIENT_ID;
const confirmado = process.argv.includes('--confirmo');

if (!process.env.DATABASE_URL || !CLIENT_ID) {
  console.error('DATABASE_URL e CLIENT_ID são obrigatórios.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const encontrados = await pool.query(
    `SELECT COUNT(*)::int AS total
       FROM leads
      WHERE client_id = $1
        AND name LIKE '% (teste)'`,
    [CLIENT_ID]
  );
  const total = encontrados.rows[0].total;

  console.log(`${total} leads de teste encontrados.`);
  if (!confirmado) {
    console.log('Nada foi apagado. Use --confirmo para remover somente a massa de teste.');
    return;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM tasks
        WHERE client_id = $1
          AND criado_por = 'seed-crm'`,
      [CLIENT_ID]
    );
    await client.query(
      `DELETE FROM ai_activity
        WHERE client_id = $1
          AND lead_name LIKE '% (teste)'`,
      [CLIENT_ID]
    );
    const removidos = await client.query(
      `DELETE FROM leads
        WHERE client_id = $1
          AND name LIKE '% (teste)'
      RETURNING id`,
      [CLIENT_ID]
    );
    await client.query('COMMIT');
    console.log(`${removidos.rowCount} leads de teste removidos. Leads reais preservados.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

main()
  .catch(err => {
    console.error('Erro:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
