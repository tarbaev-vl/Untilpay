import pg from 'pg';

// NUMERIC -> number, DATE -> 'YYYY-MM-DD' (без сдвигов часового пояса)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const query = (text, params) => pool.query(text, params);

/** Выполняет fn(client) в одной транзакции: COMMIT при успехе, ROLLBACK при ошибке. */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await fn(client);
    await client.query('COMMIT');
    return res;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
