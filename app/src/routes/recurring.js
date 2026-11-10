import { query } from '../db.js';

// 'Другое' ("Other") is the stored default value; the UI translates it for display
const body = {
  type: 'object',
  required: ['name', 'amount'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9 },
    period: { type: 'string', enum: ['week', 'month', 'quarter', 'year'], default: 'month' },
    kind: { type: 'string', enum: ['mandatory', 'subscription'], default: 'mandatory' },
    category: { type: 'string', maxLength: 100, default: 'Другое' },
    account: { type: 'string', maxLength: 100, default: 'Другое' },
    day: { type: ['integer', 'null'], minimum: 1, maximum: 31, default: null },
    active: { type: 'boolean', default: true },
  },
};
const idParam = { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };
const cols = 'id::text, name, amount, period, kind, category, account, day, active, created_at, updated_at';

export default async function recurring(app) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/recurring', async () => {
    const { rows } = await query(`SELECT ${cols} FROM recurring ORDER BY active DESC, amount DESC, id`);
    return rows;
  });

  app.post('/api/recurring', { schema: { body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO recurring (name, amount, period, kind, category, account, day, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${cols}`,
      [b.name.trim(), b.amount, b.period, b.kind, b.category, b.account, b.day, b.active],
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/recurring/:id', { schema: { params: idParam, body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `UPDATE recurring SET name=$1, amount=$2, period=$3, kind=$4, category=$5, account=$6, day=$7,
         active=$8, updated_at=now() WHERE id=$9 RETURNING ${cols}`,
      [b.name.trim(), b.amount, b.period, b.kind, b.category, b.account, b.day, b.active, req.params.id],
    );
    if (!rows.length) return reply.code(404).send({ error: 'not_found', message: req.t('recurring.not_found') });
    return rows[0];
  });

  // pause / resume
  app.patch('/api/recurring/:id', {
    schema: {
      params: idParam,
      body: { type: 'object', required: ['active'], additionalProperties: false, properties: { active: { type: 'boolean' } } },
    },
  }, async (req, reply) => {
    const { rows } = await query(
      `UPDATE recurring SET active=$1, updated_at=now() WHERE id=$2 RETURNING ${cols}`,
      [req.body.active, req.params.id],
    );
    if (!rows.length) return reply.code(404).send({ error: 'not_found', message: req.t('recurring.not_found') });
    return rows[0];
  });

  app.delete('/api/recurring/:id', { schema: { params: idParam } }, async (req, reply) => {
    const { rowCount } = await query('DELETE FROM recurring WHERE id=$1', [req.params.id]);
    if (!rowCount) return reply.code(404).send({ error: 'not_found', message: req.t('recurring.not_found') });
    return reply.code(204).send();
  });
}
