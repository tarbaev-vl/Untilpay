import { query } from '../db.js';
import { createProvider, providerStatus, LlmError } from '../llm/index.js';
import { langOf, LANGUAGE_NAMES, DEFAULT_LANG } from '../i18n.js';

const date = { type: 'string', format: 'date' };
const rangeQs = { type: 'object', required: ['from', 'to'], properties: { from: date, to: date } };
const runBody = {
  type: 'object',
  required: ['periods'],
  additionalProperties: false,
  properties: {
    // the first one is the current reporting month, then up to 3 previous ones for comparison
    periods: {
      type: 'array', minItems: 1, maxItems: 4,
      items: {
        type: 'object', required: ['label', 'from', 'to'], additionalProperties: false,
        properties: { label: { type: 'string', maxLength: 40 }, from: date, to: date },
      },
    },
  },
};

// Shape of the model reply (structured outputs)
const str = { type: 'string' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'savings_potential', 'recommendations', 'positives', 'warnings'],
  properties: {
    summary: { ...str, description: '2–3 sentences: how the month went compared with the previous ones' },
    savings_potential: { type: 'number', description: 'How many euros per month can realistically be saved if all recommendations are followed' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'category', 'detail', 'saving_per_month', 'priority'],
        properties: {
          title: { ...str, description: 'A short action, for example "Cancel the unused streaming subscription"' },
          category: { ...str, description: 'The expense category the advice belongs to, copied exactly as it appears in the data' },
          detail: { ...str, description: 'Why and how: grounded in the figures from the data, 1–3 sentences' },
          saving_per_month: { type: 'number', description: 'Saving in euros per month' },
          priority: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    positives: { type: 'array', items: str, description: 'What is already good about the budget' },
    warnings: { type: 'array', items: str, description: 'What to watch out for: growing categories, large one-off expenses, risks' },
  },
};

/** System prompt; the advice itself is written in the language selected in the UI */
const systemPrompt = (lang) => `You are a calm, practical personal finance advisor. All amounts are in euros.
You receive a budget summary as JSON: the current reporting month and up to three previous months for comparison, recurring payments and subscriptions, income, the largest spending items, and a breakdown by account.

Give recommendations on how to plan the budget and what to cut in order to save money:
- Rely only on the figures provided. Compare with previous months and name specific amounts.
- If the current month is still in progress (days_passed < days_total), take that into account and do not compare an incomplete month directly with full ones.
- Estimate savings realistically: what can be reduced without hurting quality of life. Do not suggest cutting essentials such as housing, utilities, health and education. Look for reserves elsewhere: subscriptions that are rarely used or duplicate each other, growing categories, frequent small purchases, delivery, eating out, impulse buys.
- Several payments against the same recurring payment in one month (for example, a utilities top-up) are normal; do not treat them as an error.
- Give 3 to 7 recommendations, most valuable first. Keep the tone short and friendly, without lecturing.
- Category, account and payment names may be in another language: copy them exactly as they appear in the data.
- Write all text values in ${LANGUAGE_NAMES[lang] || LANGUAGE_NAMES[DEFAULT_LANG]}.`;

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const DAY = 864e5;

/** Summary for the model: only amounts and expense names, no account numbers or full statement descriptions. */
async function buildSummary(periods) {
  const [cur] = periods;
  const history = await Promise.all(periods.map(async (p) => {
    const [cats, inc] = await Promise.all([
      query(`SELECT category, count(*)::int AS n, sum(amount) AS total FROM expenses
             WHERE spent_on >= $1 AND spent_on < $2 GROUP BY category ORDER BY total DESC`, [p.from, p.to]),
      query('SELECT coalesce(sum(amount), 0) AS total FROM incomes WHERE received_on >= $1 AND received_on < $2', [p.from, p.to]),
    ]);
    return {
      month: p.label, from: p.from, to: p.to,
      expenses_total: r2(cats.rows.reduce((s, c) => s + c.total, 0)),
      expenses_count: cats.rows.reduce((s, c) => s + c.n, 0),
      income_actual: r2(inc.rows[0].total),
      by_category: cats.rows.map((c) => ({ category: c.category, total: r2(c.total), count: c.n })),
    };
  }));

  const [top, accounts, recurring, sources, settings] = await Promise.all([
    query(`SELECT left(note, 60) AS name, category, count(*)::int AS n, sum(amount) AS total FROM expenses
           WHERE spent_on >= $1 AND spent_on < $2 AND note <> '' GROUP BY 1, 2 ORDER BY total DESC LIMIT 20`, [cur.from, cur.to]),
    query(`SELECT account, count(*)::int AS n, sum(amount) AS total FROM expenses
           WHERE spent_on >= $1 AND spent_on < $2 GROUP BY account ORDER BY total DESC`, [cur.from, cur.to]),
    query(`SELECT r.name, r.amount, r.period, r.kind, r.category, r.active, r.day, coalesce(sum(e.amount), 0) AS paid
           FROM recurring r LEFT JOIN expenses e ON e.recurring_id = r.id AND e.spent_on >= $1 AND e.spent_on < $2
           GROUP BY r.id ORDER BY r.kind, r.amount DESC`, [cur.from, cur.to]),
    query(`SELECT source, sum(amount) AS total FROM incomes
           WHERE received_on >= $1 AND received_on < $2 GROUP BY source ORDER BY total DESC`, [cur.from, cur.to]),
    query(`SELECT value FROM settings WHERE key='main'`),
  ]);

  const start = Date.parse(`${cur.from}T00:00:00Z`), end = Date.parse(`${cur.to}T00:00:00Z`);
  const daysTotal = Math.round((end - start) / DAY);
  const daysPassed = Math.min(daysTotal, Math.max(0, Math.ceil((Date.now() - start) / DAY)));
  return {
    current_month: { ...history[0], days_total: daysTotal, days_passed: daysPassed },
    previous_months: history.slice(1),
    top_expenses: top.rows.map((t) => ({ name: t.name, category: t.category, count: t.n, total: r2(t.total) })),
    by_account: accounts.rows.map((a) => ({ account: a.account, count: a.n, total: r2(a.total) })),
    recurring_payments: recurring.rows.map((r) => ({
      name: r.name, amount: r2(r.amount), period: r.period, kind: r.kind === 'subscription' ? 'subscription' : 'mandatory',
      category: r.category, active: r.active, charge_day: r.day, paid_this_month: r2(r.paid),
    })),
    income: {
      planned_per_month: r2(settings.rows[0]?.value?.income),
      actual_by_source: sources.rows.map((s) => ({ source: s.source, total: r2(s.total) })),
    },
  };
}

// Coerce the model reply to the expected shape: providers without a strict schema may answer loosely
const PRIORITIES = ['high', 'medium', 'low'];
const asStr = (v) => (v == null ? '' : String(v));
const asNum = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? r2(n) : 0; };
const asList = (v) => (Array.isArray(v) ? v.map(asStr).filter(Boolean) : []);
function normalizeInsights(d) {
  return {
    summary: asStr(d?.summary),
    savings_potential: asNum(d?.savings_potential),
    recommendations: (Array.isArray(d?.recommendations) ? d.recommendations : []).map((x) => ({
      title: asStr(x?.title), category: asStr(x?.category), detail: asStr(x?.detail),
      saving_per_month: asNum(x?.saving_per_month),
      priority: PRIORITIES.includes(x?.priority) ? x.priority : 'low',
    })).filter((x) => x.title),
    positives: asList(d?.positives),
    warnings: asList(d?.warnings),
  };
}

const ERR_STATUS = { rate: 429 }; // everything else is 502

/** User-facing text of an AI error in the UI language */
function aiMessage(req, code, params = {}) {
  const p = { ...params, detail: params.detail ? `: ${params.detail}` : '' };
  if (code === 'api') p.status = p.status ?? req.t('ai.no_response');
  return req.t(`ai.${code}`, p);
}
/** providerStatus() with the configuration error as text */
function status(req) {
  const st = providerStatus();
  return { ...st, error: st.error ? aiMessage(req, st.error.code, st.error.params) : null };
}

export default async function insights(app) {
  app.addHook('preHandler', app.requireAuth);

  // Saved advice for the period (no new request to the model) + which provider is configured
  app.get('/api/insights', { schema: { querystring: rangeQs } }, async (req) => {
    const { rows } = await query(
      'SELECT result, model, created_at FROM ai_insights WHERE period_from = $1 AND period_to = $2',
      [req.query.from, req.query.to],
    );
    return { ...status(req), saved: rows[0] || null };
  });

  app.post('/api/insights', {
    config: { rateLimit: { max: 10, timeWindow: '1 hour' } },
    schema: { body: runBody },
  }, async (req, reply) => {
    const provider = createProvider();
    if (!provider?.configured) {
      return reply.code(503).send({ error: 'ai_off', message: status(req).error || req.t('ai.off') });
    }
    const [cur] = req.body.periods;
    const summary = await buildSummary(req.body.periods);

    let out;
    try {
      out = await provider.generateJson({
        system: systemPrompt(langOf(req)),
        prompt: `Budget summary:\n${JSON.stringify(summary)}`,
        schema: SCHEMA,
        name: 'budget_insights',
      });
    } catch (err) {
      if (!(err instanceof LlmError)) throw err;
      req.log.warn({ provider: provider.id, code: err.code, status: err.status, msg: err.message }, 'llm error');
      return reply.code(ERR_STATUS[err.code] || 502).send({ error: `ai_${err.code}`, message: aiMessage(req, err.code, err.params) });
    }

    const result = normalizeInsights(out.data);
    const model = `${provider.label} · ${out.model}`;
    req.log.info({ provider: provider.id, model: out.model, ...out.usage }, 'insights generated');
    const { rows } = await query(
      `INSERT INTO ai_insights (period_from, period_to, model, result, usage) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (period_from, period_to) DO UPDATE
         SET model = EXCLUDED.model, result = EXCLUDED.result, usage = EXCLUDED.usage, created_at = now()
       RETURNING result, model, created_at`,
      [cur.from, cur.to, model, JSON.stringify(result), JSON.stringify(out.usage)],
    );
    return { ...status(req), saved: rows[0] };
  });
}

export { buildSummary, normalizeInsights, systemPrompt }; // for checks without a request to the model
