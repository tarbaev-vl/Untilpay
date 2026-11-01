import { query } from '../db.js';
import { periodQs, range } from '../period.js';

const body = {
  type: 'object',
  required: ['amount', 'date'],
  additionalProperties: false,
  properties: {
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9 },
    source: { type: 'string', minLength: 1, maxLength: 100, default: 'Другое' },
    date: { type: 'string', format: 'date' },
    note: { type: 'string', maxLength: 500, default: '' },
    account: { type: 'string', maxLength: 100, default: 'Другое' },
  },
};
const idParam = { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };
const cols = 'id::text, amount, source, received_on AS date, note, account, created_at, updated_at';

export default async function incomes(app) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/incomes', { schema: { querystring: periodQs } }, async (req) => {
    // original — описание из CSV-выписки, если доход импортирован
    const { rows } = await query(
      `SELECT i.id::text, i.amount, i.source, i.received_on AS date, i.note, i.account, i.created_at, i.updated_at,
         t.original
       FROM incomes i LEFT JOIN import_tx t ON t.income_id = i.id
       WHERE i.received_on >= $1::date AND i.received_on < $2::date
       ORDER BY i.received_on DESC, i.id DESC`,
      range(req.query),
    );
    return rows;
  });

  // Источники для подсказок: самые частые первыми
  app.get('/api/incomes/sources', async () => {
    const { rows } = await query('SELECT source FROM incomes GROUP BY source ORDER BY count(*) DESC, source LIMIT 50');
    return rows.map((r) => r.source);
  });

  app.post('/api/incomes', { schema: { body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO incomes (amount, source, received_on, note, account) VALUES ($1,$2,$3,$4,$5) RETURNING ${cols}`,
      [b.amount, b.source.trim() || 'Другое', b.date, b.note.trim(), b.account],
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/incomes/:id', { schema: { params: idParam, body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `UPDATE incomes SET amount=$1, source=$2, received_on=$3, note=$4, account=$5, updated_at=now()
       WHERE id=$6 RETURNING ${cols}`,
      [b.amount, b.source.trim() || 'Другое', b.date, b.note.trim(), b.account, req.params.id],
    );
    if (!rows.length) return reply.code(404).send({ error: 'not_found', message: 'Доход не найден' });
    return rows[0];
  });

  app.delete('/api/incomes/:id', { schema: { params: idParam } }, async (req, reply) => {
    const { rowCount } = await query('DELETE FROM incomes WHERE id=$1', [req.params.id]);
    if (!rowCount) return reply.code(404).send({ error: 'not_found', message: 'Доход не найден' });
    return reply.code(204).send();
  });
}
