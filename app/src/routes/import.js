import { createHash } from 'node:crypto';
import { query, tx } from '../db.js';

const DEFAULT_CAT = 'Другое';

const row = {
  date: { type: 'string', format: 'date' },
  datetime: { type: 'string', maxLength: 40, default: '' },
  amount: { type: 'number', exclusiveMinimum: 0, maximum: 1e9 },
  original: { type: 'string', minLength: 1, maxLength: 500 },
  kind: { type: 'string', enum: ['expense', 'income'], default: 'expense' }, // поступления становятся доходами
};
const account = { type: 'string', minLength: 1, maxLength: 100 };

const previewBody = {
  type: 'object',
  required: ['account', 'rows'],
  additionalProperties: false,
  properties: {
    account,
    rows: {
      type: 'array', maxItems: 5000,
      items: { type: 'object', required: ['date', 'amount', 'original'], additionalProperties: false, properties: row },
    },
  },
};
const commitBody = {
  type: 'object',
  required: ['account', 'items'],
  additionalProperties: false,
  properties: {
    account,
    items: {
      type: 'array', maxItems: 5000,
      items: {
        type: 'object',
        required: ['date', 'amount', 'original', 'n', 'action'],
        additionalProperties: false,
        properties: {
          ...row,
          n: { type: 'integer', minimum: 0, maximum: 10000 },
          action: { type: 'string', enum: ['import', 'skip'] },
          note: { type: 'string', maxLength: 500, default: '' },
          category: { type: 'string', minLength: 1, maxLength: 100, default: DEFAULT_CAT },
          recurring_id: { type: ['string', 'null'], pattern: '^[0-9]+$', default: null },
        },
      },
    },
  },
};

const round2 = (v) => Math.round(v * 100) / 100;
// Ключ одинаковых строк выписки (без порядкового номера). У доходов свой префикс, ключи расходов прежние
const baseKey = (acc, r) => [...(r.kind === 'income' ? ['income'] : []), acc, r.datetime || r.date, round2(r.amount).toFixed(2), r.original.trim()].join('|');
const fingerprint = (acc, r, n) => createHash('sha256').update(`${baseKey(acc, r)}|${n}`).digest('hex');

/** «CARD 4421 ALPHAMEGA LIMASSOL» -> «card alphamega limassol»: без номеров карт и ссылок на платёж. */
export function rulePattern(original) {
  const s = original.toLowerCase().trim();
  return s.split(/\s+/).filter((w) => !/\d/.test(w)).join(' ') || s.replace(/\s+/g, ' ');
}

/** Активный регулярный платёж с той же суммой и словом из названия в описании: «Netflix» 15,99 ↔ «NETFLIX.COM 4421». */
function matchRecurring(recurring, r) {
  const text = r.original.toLowerCase();
  return recurring.find((p) => Math.abs(p.amount - r.amount) < 0.005
    && p.name.toLowerCase().split(/[^\p{L}\p{N}]+/u).some((w) => w.length >= 3 && text.includes(w)));
}

export default async function importRoutes(app) {
  app.addHook('preHandler', app.requireAuth);

  // Какие строки выписки новые, а какие уже импортированы или отклонены + подсказки из правил
  app.post('/api/import/preview', { bodyLimit: 2 * 1024 * 1024, schema: { body: previewBody } }, async (req) => {
    const acc = req.body.account;
    const seen = new Map();
    const rows = req.body.rows.map((r) => {
      const k = baseKey(acc, r);
      const n = seen.get(k) || 0; // одинаковые покупки в один день — разные транзакции
      seen.set(k, n + 1);
      return { ...r, original: r.original.trim(), amount: round2(r.amount), n, fp: fingerprint(acc, r, n), pattern: rulePattern(r.original) };
    });

    const [known, rules, recurring] = await Promise.all([
      query('SELECT fingerprint, status FROM import_tx WHERE fingerprint = ANY($1)', [rows.map((r) => r.fp)]),
      query('SELECT kind, pattern, note, category, recurring_id::text FROM import_rules WHERE pattern = ANY($1)', [[...new Set(rows.map((r) => r.pattern))]]),
      query('SELECT id::text, name, amount, category FROM recurring WHERE active ORDER BY id'),
    ]);
    const status = new Map(known.rows.map((r) => [r.fingerprint, r.status]));
    const rule = new Map(rules.rows.map((r) => [`${r.kind}|${r.pattern}`, r]));

    return rows.map(({ fp, pattern, ...r }) => {
      const ru = rule.get(`${r.kind}|${pattern}`);
      if (ru) return { ...r, status: status.get(fp) || 'new', note: ru.note, category: ru.category, recurring_id: ru.recurring_id };
      const p = r.kind === 'income' ? null : matchRecurring(recurring.rows, r);
      return {
        ...r,
        status: status.get(fp) || 'new',
        note: p ? p.name : r.original,
        category: p ? p.category : DEFAULT_CAT,
        recurring_id: p ? p.id : null,
      };
    });
  });

  // Импорт отмеченных строк и запоминание отклонённых, одной транзакцией
  app.post('/api/import/commit', { bodyLimit: 2 * 1024 * 1024, schema: { body: commitBody } }, async (req) => {
    const acc = req.body.account;
    return tx(async (c) => {
      let imported = 0, incomes = 0, skipped = 0;
      for (const it of req.body.items) {
        const original = it.original.trim();
        const amount = round2(it.amount);
        const fp = fingerprint(acc, it, it.n);

        if (it.action === 'skip') {
          const { rowCount } = await c.query(
            `INSERT INTO import_tx (fingerprint, status, account, tx_date, amount, original)
             VALUES ($1, 'skipped', $2, $3, $4, $5) ON CONFLICT (fingerprint) DO NOTHING`,
            [fp, acc, it.date, amount, original],
          );
          skipped += rowCount;
          continue;
        }

        // Атомарно занимаем отпечаток: новая строка или ранее отклонённая; уже импортированную пропускаем
        const { rowCount } = await c.query(
          `INSERT INTO import_tx (fingerprint, status, account, tx_date, amount, original)
           VALUES ($1, 'imported', $2, $3, $4, $5)
           ON CONFLICT (fingerprint) DO UPDATE SET status = 'imported' WHERE import_tx.status = 'skipped'`,
          [fp, acc, it.date, amount, original],
        );
        if (!rowCount) continue;

        const note = it.note.trim() || original;
        const recId = it.kind === 'income' ? null : it.recurring_id;
        if (it.kind === 'income') {
          // у дохода в category приходит источник
          const { rows: [i] } = await c.query(
            `INSERT INTO incomes (amount, source, received_on, note, account) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
            [amount, it.category, it.date, note, acc],
          );
          await c.query('UPDATE import_tx SET income_id = $1 WHERE fingerprint = $2', [i.id, fp]);
          incomes += 1;
        } else {
          const { rows: [e] } = await c.query(
            `INSERT INTO expenses (amount, category, spent_on, note, account, recurring_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [amount, it.category, it.date, note, acc, recId],
          );
          await c.query('UPDATE import_tx SET expense_id = $1 WHERE fingerprint = $2', [e.id, fp]);
        }
        imported += 1;

        // Запоминаем переименование, категорию/источник и связь с регулярным платежом, чтобы в следующий раз подставить их сами
        const pattern = rulePattern(original);
        if (note !== original || it.category !== DEFAULT_CAT || recId) {
          await c.query(
            `INSERT INTO import_rules (kind, pattern, note, category, recurring_id) VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (kind, pattern) DO UPDATE SET note = EXCLUDED.note, category = EXCLUDED.category,
               recurring_id = EXCLUDED.recurring_id, updated_at = now()`,
            [it.kind, pattern, note, it.category, recId],
          );
        } else {
          await c.query('DELETE FROM import_rules WHERE kind = $1 AND pattern = $2', [it.kind, pattern]);
        }
      }
      return { imported, incomes, skipped };
    });
  });
}
