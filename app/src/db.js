import pg from 'pg';

// NUMERIC -> number, DATE -> 'YYYY-MM-DD' (без сдвигов часового пояса)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export const query = (text, params) => pool.query(text, params);
