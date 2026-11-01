// Общие для расходов и доходов: выбор периода в querystring и его границы

// Календарный месяц (?month=2026-10) или произвольный период (?from=2026-10-25&to=2026-11-25, to не входит)
export const periodQs = {
  type: 'object',
  properties: {
    month: { type: 'string', pattern: '^[0-9]{4}-(0[1-9]|1[0-2])$' },
    from: { type: 'string', format: 'date' },
    to: { type: 'string', format: 'date' },
  },
  anyOf: [{ required: ['month'] }, { required: ['from', 'to'] }],
};

const pad = (n) => String(n).padStart(2, '0');
const isoDay = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** [начало, конец (не входит)] */
export const range = (q) => {
  if (q.from && q.to) return [q.from, q.to];
  const [y, m] = q.month.split('-').map(Number);
  return [`${q.month}-01`, isoDay(new Date(Date.UTC(y, m, 1)))];
};

export const prevDay = (s) => { const d = new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return isoDay(d); };
