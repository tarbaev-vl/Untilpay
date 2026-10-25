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
    // оплата регулярного платежа: такой расход закрывает платёж, а не входит в «Расходы»
    recurring_id: { type: ['string', 'null'], pattern: '^[0-9]+$', default: null },
  },
};
const idParam = { type: 'object', properties: { id: { type: 'string', pattern: '^[0-9]+$' } } };
// Календарный месяц (?month=2026-10) или произвольный период (?from=2026-10-25&to=2026-11-25, to не входит)
const periodQs = {
  type: 'object',
  properties: {
    month: { type: 'string', pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' },
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
  },
  anyOf: [{ required: ['month'] }, { required: ['from', 'to'] }],
};
const cols = 'id::text, amount, category, spent_on AS date, note, account, recurring_id::text, created_at, updated_at';
const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
/** [начало, конец (не входит)] */
const range = (q) => {
  if (q.from && q.to) return [q.from, q.to];
  const [y, m] = q.month.split('-').map(Number);
  return [`${q.month}-01`, isoDay(new Date(Date.UTC(y, m, 1)))];
};
const prevDay = (s) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return isoDay(d); };

const csvCell = (v) => {
  const s = String(v ?? '');
  // защита от формул в Excel + экранирование кавычек
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export default async function expenses(app) {
  app.addHook('preHandler', app.requireAuth);

  app.get('/api/expenses', { schema: { querystring: periodQs } }, async (req) => {
    // original — описание из CSV-выписки, если расход импортирован
    const { rows } = await query(
      `SELECT e.id::text, e.amount, e.category, e.spent_on AS date, e.note, e.account, e.recurring_id::text, e.created_at, e.updated_at,
         t.original
       FROM expenses e LEFT JOIN import_tx t ON t.expense_id = e.id
       WHERE e.spent_on >= $1::date AND e.spent_on < $2::date
       ORDER BY e.spent_on DESC, e.id DESC`,
      range(req.query),
    );
    return rows;
  });

  // Выгрузка месяца в CSV (открывается в Excel / Numbers / Google Sheets)
  app.get('/api/expenses.csv', { schema: { querystring: periodQs } }, async (req, reply) => {
    const { rows } = await query(
      `SELECT spent_on AS date, amount, category, note, account FROM expenses
       WHERE spent_on >= $1::date AND spent_on < $2::date
       ORDER BY spent_on, id`,
      range(req.query),
    );
    const [from, to] = range(req.query);
    const name = req.query.from ? `${from}_${prevDay(to)}` : req.query.month;
    const lines = [['Дата', 'Сумма', 'Категория', 'Комментарий', 'Счёт'].join(';')];
    for (const r of rows) lines.push([r.date, r.amount.toFixed(2).replace('.', ','), r.category, r.note, r.account].map(csvCell).join(';'));
    reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="expenses-${name}.csv"`);
    return '﻿' + lines.join('\r\n') + '\r\n';
  });

  app.post('/api/expenses', { schema: { body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `INSERT INTO expenses (amount, category, spent_on, note, account, recurring_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING ${cols}`,
      [b.amount, b.category, b.date, b.note.trim(), b.account, b.recurring_id],
    );
    return reply.code(201).send(rows[0]);
  });

  app.put('/api/expenses/:id', { schema: { params: idParam, body } }, async (req, reply) => {
    const b = req.body;
    const { rows } = await query(
      `UPDATE expenses SET amount=$1, category=$2, spent_on=$3, note=$4, account=$5, recurring_id=$6, updated_at=now()
       WHERE id=$7 RETURNING ${cols}`,
      [b.amount, b.category, b.date, b.note.trim(), b.account, b.recurring_id, req.params.id],
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
