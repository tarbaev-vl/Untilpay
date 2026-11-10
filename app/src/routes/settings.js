import { query } from '../db.js';

export default async function settings(app) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/settings', async () => {
    const { rows } = await query(`SELECT value FROM settings WHERE key='main'`);
    return { income: 0, periodStart: 1, ...(rows[0]?.value || {}) };
  });

  app.put('/api/settings', {
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          income: { type: 'number', minimum: 0, maximum: 1e9 },
          periodStart: { type: 'integer', minimum: 1, maximum: 31 }, // the budget month starts on this day
        },
      },
    },
  }, async (req) => {
    const { rows } = await query(
      `INSERT INTO settings (key, value) VALUES ('main', $1::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = settings.value || EXCLUDED.value, updated_at = now()
       RETURNING value`,
      [JSON.stringify(req.body)],
    );
    return { income: 0, periodStart: 1, ...rows[0].value };
  });
}
