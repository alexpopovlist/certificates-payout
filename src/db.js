const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is not set. Copy .env.example to .env and set the PostgreSQL connection string.');
}

const pool = new Pool({ connectionString });

async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  withTransaction
};
