/* Parsing CSV statements: Revolut, Bank of Cyprus and any other format with manual column selection.
   Pure functions only, no DOM — easy to check in Node. */

const pad = (n) => String(n).padStart(2, '0');

/** Delimiter: whichever of , ; \t occurs most outside quotes in the first lines. */
function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  let best = ',', max = -1;
  for (const d of [',', ';', '\t']) {
    let cnt = 0;
    for (const l of lines) { let q = false; for (const ch of l) { if (ch === '"') q = !q; else if (!q && ch === d) cnt++; } }
    if (cnt > max) { max = cnt; best = d; }
  }
  return best;
}

/** CSV -> { headers, rows }. Quotes, "" inside quotes, line breaks inside quotes, CRLF, BOM. */
export function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const d = detectDelimiter(text);
  const all = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); all.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); all.push(row); }
  const rows = all.map((r) => r.map((c) => c.trim())).filter((r) => r.some(Boolean));
  // Account details may precede the table: the header is the first of the "fullest" rows
  const filled = (r) => r.filter(Boolean).length;
  const head = rows.slice(0, 30);
  const maxFilled = Math.max(0, ...head.map(filled));
  const hi = head.findIndex((r) => filled(r) === maxFilled);
  if (hi < 0) return { headers: [], rows: [] };
  return { headers: rows[hi], rows: rows.slice(hi + 1) };
}

/** "1.234,56" / "1,234.56" / "-12,50" / "(12.00)" / "12.00-" / "€ 12" -> a number or NaN. */
export function parseAmount(s) {
  let v = String(s ?? '').replace(/[\s  ']/g, '');
  if (!v) return NaN;
  let neg = false;
  if (/^\(.*\)$/.test(v)) { neg = true; v = v.slice(1, -1); }
  if (/-$/.test(v)) { neg = true; v = v.slice(0, -1); }
  v = v.replace(/[^\d.,+-]/g, '');
  if (v.startsWith('-')) { neg = !neg; v = v.slice(1); } else if (v.startsWith('+')) v = v.slice(1);
  const lc = v.lastIndexOf(','), ld = v.lastIndexOf('.');
  if (lc >= 0 && ld >= 0) v = lc > ld ? v.replace(/\./g, '').replace(',', '.') : v.replace(/,/g, '');
  else if (lc >= 0) v = /^\d{1,3}(,\d{3})+$/.test(v) ? v.replace(/,/g, '') : v.replace(',', '.');
  else if ((v.match(/\./g) || []).length > 1) v = v.replace(/\./g, '');
  if (!/^\d+(\.\d+)?$/.test(v)) return NaN;
  const n = Math.round(parseFloat(v) * 100) / 100;
  return neg ? -n : n;
}

/** The day comes first (DD/MM/YYYY) unless the column has dates whose second number is greater than 12. */
export function detectDayFirst(values) {
  for (const s of values) {
    const m = /^(\d{1,2})[./-](\d{1,2})[./-]\d{2,4}/.exec(String(s).trim());
    if (m && +m[2] > 12) return false;
  }
  return true;
}

/** Date string -> { date: 'YYYY-MM-DD', datetime: 'YYYY-MM-DD[ HH:MM[:SS]]' } or null. */
export function parseDate(s, dayFirst = true) {
  s = String(s ?? '').trim();
  let y, mo, d, t;
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}:\d{2}(?::\d{2})?))?/.exec(s);
  if (m) [, y, mo, d, t] = m;
  else if ((m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?:,?\s+(\d{1,2}:\d{2}(?::\d{2})?))?/.exec(s))) {
    [, d, mo, y, t] = m;
    if (!dayFirst) [d, mo] = [mo, d];
    if (y.length === 2) y = `20${y}`;
  } else return null;
  if (!(+mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31)) return null;
  const date = `${y}-${pad(mo)}-${pad(d)}`;
  const dt = new Date(`${date}T12:00:00`);
  if (Number.isNaN(dt.getTime()) || dt.getDate() !== +d) return null;
  return { date, datetime: t ? `${date} ${t.length < 6 ? t.padStart(5, '0') : t.padStart(8, '0')}` : date };
}

const norm = (h) => String(h).toLowerCase().replace(/\s+/g, ' ').trim();
const findCol = (headers, re, except = -1) => headers.findIndex((h, i) => i !== except && re.test(norm(h)));

/** 'revolut' | 'boc' | null by the header row. */
export function detectFormat(headers) {
  const h = headers.map(norm);
  if (['started date', 'description', 'amount', 'currency', 'state'].every((x) => h.includes(x))) return 'revolut';
  const m = guessMapping(headers);
  if (m.date >= 0 && m.desc >= 0 && m.debit >= 0 && findCol(headers, /credit|кредит|зачисл/) >= 0) return 'boc';
  return null;
}

/** Column guess for manual mode (indexes, -1 = none). Header keywords are matched in several languages. */
export function guessMapping(headers) {
  let date = findCol(headers, /^(transaction|posting|booking|operation)? ?date|дата (операции|транзакции)/);
  if (date < 0) date = findCol(headers, /date|дата|datum/);
  const desc = findCol(headers, /description|details|narrative|описан|назначен|payee|merchant|reference/);
  const debit = findCol(headers, /debit|withdraw|списан|расход/);
  const credit = findCol(headers, /credit|кредит|зачисл|поступ|приход/);
  const amount = debit >= 0 ? -1 : findCol(headers, /amount|сумма|betrag/);
  return { date, desc, amount, debit, credit };
}

const LIMIT = 500; // the description in the database is up to 500 characters
// "(no description)". Part of the import fingerprint, so it must not change or be translated
const NO_DESCRIPTION = '(без описания)';

/**
 * Table rows -> transactions { date, datetime, amount (>0), original, kind: 'expense' | 'income' }.
 * format 'revolut' uses its own columns; otherwise mapping = { date, desc, amount, debit, credit, negSign }.
 * Pending and non-EUR operations are dropped and counted in dropped.
 */
export function toTransactions({ headers, rows }, format, mapping) {
  const dropped = { pending: 0, cancelled: 0, currency: 0, other: 0, bad: 0 };
  const out = [];
  const push = (date, amount, original, kind) => {
    out.push({ date: date.date, datetime: date.datetime, amount, original: (original || NO_DESCRIPTION).slice(0, LIMIT), kind });
  };
  const r2 = (v) => Math.round(v * 100) / 100;

  if (format === 'revolut') {
    const col = (n) => headers.findIndex((h) => norm(h) === n);
    const c = { type: col('type'), product: col('product'), started: col('started date'), desc: col('description'), amount: col('amount'), fee: col('fee'), cur: col('currency'), state: col('state') };
    for (const r of rows) {
      const state = String(r[c.state] || '').toUpperCase();
      const amt = parseAmount(r[c.amount]);
      const date = parseDate(r[c.started]);
      if (!date || Number.isNaN(amt) || amt === 0) { dropped.bad++; continue; }
      if (state === 'PENDING') { dropped.pending++; continue; }
      if (state !== 'COMPLETED') { dropped.cancelled++; continue; }
      if (c.cur >= 0 && String(r[c.cur]).toUpperCase() !== 'EUR') { dropped.currency++; continue; }
      // transfers to "Savings" also show up in the main account — the savings pockets themselves are skipped
      if (c.product >= 0 && /savings|deposit/i.test(r[c.product])) { dropped.other++; continue; }
      const fee = c.fee >= 0 ? Math.abs(parseAmount(r[c.fee]) || 0) : 0;
      if (amt < 0) push(date, r2(-amt + fee), r[c.desc], 'expense');
      else if (amt - fee > 0) push(date, r2(amt - fee), r[c.desc], 'income');
      else dropped.bad++;
    }
    return { rows: out, dropped };
  }

  const m = mapping;
  if (m.date < 0 || (m.amount < 0 && m.debit < 0)) return { rows: out, dropped: { ...dropped, bad: rows.length } };
  const dayFirst = detectDayFirst(rows.map((r) => r[m.date]));
  for (const r of rows) {
    const date = parseDate(r[m.date], dayFirst);
    if (!date) { dropped.bad++; continue; }
    const desc = m.desc >= 0 ? r[m.desc] : '';
    if (m.debit >= 0) {
      // separate columns: a non-empty debit is an expense, a non-empty credit is an income
      const d = parseAmount(r[m.debit]), c = m.credit >= 0 ? parseAmount(r[m.credit]) : NaN;
      if (d) push(date, Math.abs(d), desc, 'expense');
      else if (c) push(date, Math.abs(c), desc, 'income');
      else dropped.bad++;
    } else {
      // one signed column: negSign sets the sign of expenses, the opposite sign is income
      const v = parseAmount(r[m.amount]);
      if (!v) { dropped.bad++; continue; }
      push(date, Math.abs(v), desc, (m.negSign ? v < 0 : v > 0) ? 'expense' : 'income');
    }
  }
  return { rows: out, dropped };
}

/** Whether the column has negative numbers — then expenses most likely have a minus sign. */
export const hasNegatives = (rows, col) => col >= 0 && rows.some((r) => parseAmount(r[col]) < 0);
