/* Бюджетный период «с N числа». Период называется по месяцу окончания:
   при старте 25-го «2026-11» = 25.10 – 24.11. При старте 1-го — обычный календарный месяц. */

const pad = (n) => String(n).padStart(2, '0');
const daysIn = (y, m) => new Date(y, m, 0).getDate(); // m: 1–12
const ym = (y, m) => { const dt = new Date(y, m - 1, 1); return [dt.getFullYear(), dt.getMonth() + 1]; };
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
// Граница периода внутри месяца: день старта, но не позже последнего дня месяца
const boundary = (y, m, d) => ymd(y, m, Math.min(d, daysIn(y, m)));

/** month 'YYYY-MM' -> { from, to (не входит), last (входит) } в формате 'YYYY-MM-DD'. */
export function periodRange(month, d = 1) {
  const [y, m] = month.split('-').map(Number);
  let from, to;
  if (d <= 1) { const [ny, nm] = ym(y, m + 1); from = ymd(y, m, 1); to = ymd(ny, nm, 1); }
  else { const [py, pm] = ym(y, m - 1); from = boundary(py, pm, d); to = boundary(y, m, d); }
  const l = new Date(`${to}T12:00:00`); l.setDate(l.getDate() - 1);
  return { from, to, last: ymd(l.getFullYear(), l.getMonth() + 1, l.getDate()) };
}

/** 'YYYY-MM-DD' -> период 'YYYY-MM', в который попадает дата. */
export function periodOf(date, d = 1) {
  const [y, m, day] = date.split('-').map(Number);
  if (d <= 1 || day < Math.min(d, daysIn(y, m))) return `${y}-${pad(m)}`;
  const [ny, nm] = ym(y, m + 1);
  return `${ny}-${pad(nm)}`;
}

/** «25 окт. – 24 нояб.» */
export function rangeLabel(month, d = 1) {
  const { from, last } = periodRange(month, d);
  const f = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  return `${f(from)} – ${f(last)}`;
}

/**
 * Дата списания, за которую засчитывается оплата регулярного платежа.
 * forMonth ('YYYY-MM') — выбран вручную; иначе для ежемесячного платежа с днём списания —
 * ближайшая дата списания (прошлый, этот или следующий месяц; при равенстве — более поздняя,
 * чаще платят заранее). Без дня списания — сама дата оплаты.
 */
export function dueDate(date, day, forMonth, monthly = true) {
  const at = (y, m, d) => { const [yy, mm] = ym(y, m); return boundary(yy, mm, d); };
  if (forMonth) { const [y, m] = forMonth.split('-').map(Number); return at(y, m, day || 1); }
  if (!day || !monthly) return date;
  const [y, m] = date.split('-').map(Number);
  const utc = (s) => Date.parse(`${s}T00:00:00Z`); // в UTC, чтобы переход на летнее время не ломал равенство
  const t = utc(date);
  let best = null, bestD = Infinity;
  for (const k of [-1, 0, 1]) {
    const c = at(y, m + k, day);
    const dist = Math.abs(utc(c) - t);
    if (dist <= bestD) { best = c; bestD = dist; }
  }
  return best;
}
