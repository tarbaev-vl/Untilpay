import { query } from '../db.js';

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
  },
};
const idParam = { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };
const monthQs = {
  type: 'object',
  required: ['month'],
  properties: { month: { type: 'string', pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' } },
};
const cols = 'id::text, amount, category, spent_on AS date, note, account, created_at, updated_at';
const range = (m) => [`${m}-01`, `${m}-01`]; // $1 = начало, конец = +1 месяц в SQL

const csvCell = (v) => {
  const s = String(v ?? '');
  // защита от формул в Excel + экранирование кавычек
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export default async function expenses(app) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/expenses', { schema: { querystring: monthQs } }, async (req) => {
    const { rows } = await query(
      `SELECT ${cols} FROM expenses
       WHERE spent_on >= $1::date AND spent_on < ($2::date + interval '1 month')
       ORDER BY spent_on DESC, id DESC`,
      range(req.query.month),
    );
    return rows;
  });

  // Выгрузка месяца в CSV (открывается в Excel / Numbers / Google Sheets)
  app.get('/api/expenses.csv', { schema: { querystring: monthQs } }, async (req, reply) => {
    const { rows } = await query(
      `SELECT spent_on AS date, amount, category, note, account FROM expenses
       WHERE spent_on >= $1::date AND spent_on < ($2::date + interval '1 month')
       ORDER BY spent_on, id`,
      range(req.query.month),
    );
    const lines = [['Дата', 'Сумма', 'Категория', 'Комментарий', 'Счёт'].join(';')];
    for (const r of rows) lines.push([r.date, r.amount.toFixed(2).replace('.', ','), r.category, r.note, r.account].map(csvCell).join(';'));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="expenses-${req.query.month}.csv"`);
    return '﻿' + lines.join('\r\n') + '\r\n';
  });

  app.post('/api/expenses', { schema: { body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO expenses (amount, category, spent_on, note, account) VALUES ($1,$2,$3,$4,$5) RETURNING ${cols}`,
      [b.amount, b.category, b.date, b.note.trim(), b.account],
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/expenses/:id', { schema: { params: idParam, body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `UPDATE expenses SET amount=$1, category=$2, spent_on=$3, note=$4, account=$5, updated_at=now()
       WHERE id=$6 RETURNING ${cols}`,
      [b.amount, b.category, b.date, b.note.trim(), b.account, req.params.id],
    );
    if (!rows.length) return reply.code(404).send({ error: 'not_found', message: 'Расход не найден' });
    return rows[0];
  });

  app.delete('/api/expenses/:id', { schema: { params: idParam } }, async (req, reply) => {
    const { rowCount } = await query('DELETE FROM expenses WHERE id=$1', [req.params.id]);
    if (!rowCount) return reply.code(404).send({ error: 'not_found', message: 'Расход не найден' });
    return reply.code(204).send();
  });
}
