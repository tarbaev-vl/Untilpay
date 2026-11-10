import { query } from '../db.js';
import { periodQs, range, prevDay } from '../period.js';

// 'Другое' ("Other") is the stored default value; the UI translates it for display
const body = {
  type: 'object',
  required: ['amount', 'date'],
  additionalProperties: false,
  properties: {
    amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9 },
    category: { type: 'string', maxLength: 100, default: 'Другое' },
    date: { type: 'string', format: 'date' },
    note: { type: 'string', maxLength: 500, default: '' },
    account: { type: 'string', maxLength: 100, default: 'Другое' },
    // a payment of a recurring payment: such an expense settles the payment instead of counting towards "Expenses"
    recurring_id: { type: ['string', 'null'], pattern: '^[0-9]+$', default: null },
    // which calendar month this recurring payment is for; null — derive from the date
    for_month: { type: ['string', 'null'], pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$', default: null },
  },
};
const idParam = { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };
// linked=1: also return recurring payments made within ±62 days — they may have been paid early or late
const listQs = { ...periodQs, properties: { ...periodQs.properties, linked: { type: 'string', enum: ['0', '1'] } } };
const cols = 'id::text, amount, category, spent_on AS date, note, account, recurring_id::text, for_month, created_at, updated_at';

const csvCell = (v) => {
  const s = String(v ?? '');
  // guard against Excel formulas + quote escaping
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export default async function expenses(app) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/expenses', { schema: { querystring: listQs } }, async (req) => {
    // original — the description from the CSV statement if the expense was imported
    const { rows } = await query(
      `SELECT e.id::text, e.amount, e.category, e.spent_on AS date, e.note, e.account, e.recurring_id::text, e.for_month, e.created_at, e.updated_at,
         t.original
       FROM expenses e LEFT JOIN import_tx t ON t.expense_id = e.id
       WHERE (e.spent_on >= $1::date AND e.spent_on < $2::date)
          OR ($3 AND e.recurring_id IS NOT NULL AND e.spent_on >= $1::date - 62 AND e.spent_on < $2::date + 62)
       ORDER BY e.spent_on DESC, e.id DESC`,
      [...range(req.query), req.query.linked === '1'],
    );
    return rows;
  });

  // Month export to CSV (opens in Excel / Numbers / Google Sheets)
  app.get('/api/expenses.csv', { schema: { querystring: periodQs } }, async (req, reply) => {
    const { rows } = await query(
      `SELECT spent_on AS date, amount, category, note, account FROM expenses
       WHERE spent_on >= $1::date AND spent_on < $2::date
       ORDER BY spent_on, id`,
      range(req.query),
    );
    const [from, to] = range(req.query);
    const name = req.query.from ? `${from}_${prevDay(to)}` : req.query.month;
    const lines = [req.t('csv.header').join(';')];
    for (const r of rows) lines.push([r.date, r.amount.toFixed(2).replace('.', ','), r.category, r.note, r.account].map(csvCell).join(';'));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="expenses-${name}.csv"`);
    return '﻿' + lines.join('\r\n') + '\r\n';
  });

  app.post('/api/expenses', { schema: { body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO expenses (amount, category, spent_on, note, account, recurring_id, for_month)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING ${cols}`,
      [b.amount, b.category, b.date, b.note.trim(), b.account, b.recurring_id, b.recurring_id ? b.for_month : null],
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/expenses/:id', { schema: { params: idParam, body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `UPDATE expenses SET amount=$1, category=$2, spent_on=$3, note=$4, account=$5, recurring_id=$6, for_month=$7,
         updated_at=now() WHERE id=$8 RETURNING ${cols}`,
      [b.amount, b.category, b.date, b.note.trim(), b.account, b.recurring_id, b.recurring_id ? b.for_month : null, req.params.id],
    );
    if (!rows.length) return reply.code(404).send({ error: 'not_found', message: req.t('expense.not_found') });
    return rows[0];
  });

  app.delete('/api/expenses/:id', { schema: { params: idParam } }, async (req, reply) => {
    const { rowCount } = await query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    if (!rowCount) return reply.code(404).send({ error: 'not_found', message: req.t('expense.not_found') });
    return reply.code(204).send();
  });
}
