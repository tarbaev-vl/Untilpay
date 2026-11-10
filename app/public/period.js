/* Budget period "from day N". A period is named after the month it ends in:
   starting on the 25th, "2026-11" = 25.10 – 24.11. Starting on the 1st it is a plain calendar month. */

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(y, m, 0).getDate(); // m: 1–12
const ym = (y, m) => { const dt = new Date(y, m - 1, 1); return [dt.getFullYear(), dt.getMonth() + 1]; };
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// Period boundary inside a month: the start day, but no later than the last day of the month
const boundary = (y, m, d) => ymd(y, m, Math.min(d, daysIn(y, m)));

/** month 'YYYY-MM' -> { from, to (exclusive), last (inclusive) } as 'YYYY-MM-DD'. */
export function periodRange(month, d = 1) {
  const [y, m] = month.split('-').map(Number);
  let from, to;
  if (d <= 1) { const [ny, nm] = ym(y, m + 1); from = ymd(y, m, 1); to = ymd(ny, nm, 1); }
  else { const [py, pm] = ym(y, m - 1); from = boundary(py, pm, d); to = boundary(y, m, d); }
  const l = new Date(`${to}T12:00:00`); l.setDate(l.getDate() - 1);
  return { from, to, last: ymd(l.getFullYear(), l.getMonth() + 1, l.getDate()) };
}

/** 'YYYY-MM-DD' -> the period 'YYYY-MM' the date falls into. */
export function periodOf(date, d = 1) {
  const [y, m, day] = date.split('-').map(Number);
  if (d <= 1 || day < Math.min(d, daysIn(y, m))) return `${y}-${pad(m)}`;
  const [ny, nm] = ym(y, m + 1);
  return `${ny}-${pad(nm)}`;
}

/** "25 Oct – 24 Nov" */
export function rangeLabel(month, d = 1, locale = 'en-GB') {
  const { from, last } = periodRange(month, d);
  const f = (s) => new Date(`${s}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return `${f(from)} – ${f(last)}`;
}

/**
 * The charge date a payment of a recurring payment counts for.
 * forMonth ('YYYY-MM') — chosen manually; otherwise, for a monthly payment with a charge day —
 * the nearest charge date (previous, this or next month; on a tie — the later one,
 * since people more often pay in advance). Without a charge day — the payment date itself.
 */
export function dueDate(date, day, forMonth, monthly = true) {
  const at = (y, m, d) => { const [yy, mm] = ym(y, m); return boundary(yy, mm, d); };
  if (forMonth) { const [y, m] = forMonth.split('-').map(Number); return at(y, m, day || 1); }
  if (!day || !monthly) return date;
  const [y, m] = date.split('-').map(Number);
  const utc = (s) => Date.parse(`${s}T00:00:00Z`); // in UTC so that a daylight saving switch does not break the tie
  const t = utc(date);
  let best = null, bestD = Infinity;
  for (const k of [-1, 0, 1]) {
    const c = at(y, m + k, day);
    const dist = Math.abs(utc(c) - t);
    if (dist <= bestD) { best = c; bestD = dist; }
  }
  return best;
}
