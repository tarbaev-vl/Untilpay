import { parseCsv, detectFormat, guessMapping, toTransactions, hasNegatives } from '/csv.js';
import { periodRange, periodOf, rangeLabel, dueDate } from '/period.js';
import { t, tn, label, monthLabel, locale, lang, setLang, LANGS, applyDom } from '/i18n.js';

// Stored values: they are saved to the database as they are and translated only for display (label())
const OTHER = 'Другое';

const CATS = ['Жильё', 'Коммунальные', 'Связь и интернет', 'Продукты', 'Кафе и рестораны', 'Транспорт', 'Авто', 'Здоровье', 'Страховка', 'Кредиты', 'Подписки и сервисы', 'Образование', 'Дети', 'Одежда', 'Дом', 'Развлечения', 'Спорт', 'Путешествия', 'Подарки', OTHER];
const ACCS = ['Bank of Cyprus', 'Revolut', 'Наличные', OTHER];
const INC_SOURCES = ['Зарплата', 'Аванс', 'Премия', 'Фриланс', 'Аренда', 'Возврат', 'Проценты', 'Подарок', OTHER];
const PERIOD = { month: { k: 1 }, year: { k: 1 / 12 }, quarter: { k: 1 / 3 }, week: { k: 52 / 12 } };

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt = (n) => eur.format(Math.round((n || 0) * 100) / 100);
const parseAmt = (s) => { const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN; };
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthOf = (s) => s.slice(0, 7);
const monthly = (r) => (r.amount || 0) * (PERIOD[r.period] || PERIOD.month).k;
// An income source is free text: a translated name of a standard source is saved as its stored value
const canonSource = (v) => INC_SOURCES.find((x) => label(x).toLowerCase() === v.toLowerCase()) || v;

const S = { ai: { configured: true, saved: null, busy: false, error: '', open: false }, rec: [], exp: [], inc: [], sources: [], editInc: null, income: 0, periodStart: 1, cat: null, acc: null, month: monthOf(today()), editRec: null, editExp: null, kind: 'mandatory', loaded: false };

/* ---------- API ---------- */
class ApiError extends Error { constructor(status, body) { super(body?.message || `HTTP ${status}`); this.status = status; this.body = body; } }
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new ApiError(401, { message: t('err.auth') }); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
async function write(fn, msg) {
  try { await fn(); if (msg) toast(msg); return true; }
  catch (err) { if (err.status !== 401) toast(err.message || t('err.save')); return false; }
}

/* ---------- loading ---------- */
async function loadRec() { S.rec = await api('GET', '/api/recurring'); }
const periodQs = () => { const r = periodRange(S.month, S.periodStart); return `from=${r.from}&to=${r.to}`; };
// linked=1: the server adds recurring payments made close to the period — they may have been paid early or late
async function loadExp() {
  const [exp, inc] = await Promise.all([api('GET', `/api/expenses?${periodQs()}&linked=1`), api('GET', `/api/incomes?${periodQs()}`)]);
  S.exp = exp; S.inc = inc;
  await loadInsights();
}
const aiStatus = (r) => ({ configured: r.configured, provider: r.provider, model: r.model, local: r.local, cfgError: r.error });
// Saved AI advice for the current period; an error here must not break loading the expenses
async function loadInsights() {
  const { from, to } = periodRange(S.month, S.periodStart);
  try { const r = await api('GET', `/api/insights?from=${from}&to=${to}`); Object.assign(S.ai, aiStatus(r), { saved: r.saved, error: '' }); }
  catch (err) { if (err.status === 401) throw err; S.ai.saved = null; }
}
// Income source suggestions: the standard ones and those already used
async function loadSources() {
  S.sources = await api('GET', '/api/incomes/sources');
  const dl = $('incSources'); dl.innerHTML = '';
  [...new Set([...S.sources, ...INC_SOURCES].map(label))].forEach((v) => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });
}
async function loadSettings() { const st = await api('GET', '/api/settings'); S.income = st.income || 0; S.periodStart = st.periodStart || 1; }
async function loadAll() {
  try {
    await loadSettings();
    if (!S.loaded) S.month = periodOf(today(), S.periodStart); // the period depends on the day the month starts
    await Promise.all([loadRec(), loadExp(), loadSources()]); S.loaded = true; $('banner').hidden = true;
  }
  catch (err) { if (err.status !== 401) { const b = $('banner'); b.hidden = false; b.textContent = t('banner.load_failed'); } }
  render();
}

/* ---------- UI helpers ---------- */
function fillSelect(sel, arr, val) { sel.innerHTML = ''; arr.forEach((a) => { const o = document.createElement('option'); o.value = a; o.textContent = label(a); sel.appendChild(o); }); if (val) sel.value = val; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function toast(text) { const e = $('toast'); e.textContent = text; e.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { e.hidden = true; }, 2400); }
function confirmBtn(btn, fn) {
  if (btn.dataset.armed) { fn(); return; }
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = t('common.sure'); btn.classList.add('danger');
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; btn.classList.remove('danger'); }, 3000);
}
function setKind(v) {
  S.kind = v; [...$('rKind').children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  if (v === 'subscription' && $('rCat').value === 'Жильё') $('rCat').value = 'Подписки и сервисы';
}

/* ---------- recurring payments and their payments ---------- */
// An expense linked to a recurring payment settles that payment and does not count towards "Expenses"
// A payment counts for the nearest charge date (or the manually chosen month), not for the expense date
const coverPeriod = (e, r) => periodOf(dueDate(e.date, r.day, e.for_month, r.period === 'month'), S.periodStart);
function ledger() {
  const byId = new Map(S.rec.map((r) => [r.id, r]));
  const { from, to } = periodRange(S.month, S.periodStart);
  const paid = {}; const listed = [];
  const cover = (e) => { const r = e.recurring_id && byId.get(e.recurring_id); return r ? coverPeriod(e, r) : null; };
  S.exp.forEach((e) => {
    const inRange = e.date >= from && e.date < to; const c = cover(e);
    if (c === S.month) (paid[e.recurring_id] = paid[e.recurring_id] || []).push(e);
    // period expenses: by date, and recurring payments — by the period their charge date belongs to
    if (c ? c === S.month : inRange) listed.push(e);
  });
  const paidSum = (r) => (paid[r.id] || []).reduce((s, e) => s + (e.amount || 0), 0);
  // kind of the linked recurring payment — to split spending into mandatory, subscriptions and other
  const kindOf = (e) => { const r = cover(e) === S.month && byId.get(e.recurring_id); return r ? (r.kind === 'subscription' ? 'subscription' : 'mandatory') : null; };
  // for reference: active monthly payments not yet paid in this period
  const pending = S.rec.filter((r) => r.active !== false && r.period === 'month' && !paid[r.id]);
  return { byId, paid, paidSum, listed, cover, kindOf, pending };
}
const shortDate = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
function fillRecSelect(sel, val, none = '—') {
  sel.innerHTML = ''; const o = el('option', null, none); o.value = ''; sel.appendChild(o);
  [...S.rec].sort((a, b) => a.name.localeCompare(b.name, lang)).forEach((r) => {
    const x = el('option', null, r.active === false ? t('rec.paused_opt', { name: r.name }) : r.name); x.value = r.id; sel.appendChild(x);
  });
  sel.value = val || '';
}

/* ---------- render ---------- */
function render() {
  $('monthLabel').textContent = monthLabel(S.month);
  $('periodLabel').hidden = S.periodStart <= 1; $('periodLabel').textContent = rangeLabel(S.month, S.periodStart, locale);
  $('csvLink').href = `/api/expenses.csv?${periodQs()}`;
  // Totals are actual spending only; recurring payments are a reference list that expenses link to
  const L = ledger();
  const active = S.rec.filter((r) => r.active !== false);
  const sumOf = (arr) => arr.reduce((s, e) => s + (e.amount || 0), 0);
  const total = sumOf(L.listed);
  const mand = sumOf(L.listed.filter((e) => L.kindOf(e) === 'mandatory'));
  const subs = sumOf(L.listed.filter((e) => L.kindOf(e) === 'subscription'));
  const vari = total - mand - subs;
  if (document.activeElement !== $('eRec')) fillRecSelect($('eRec'), $('eRec').value);

  // "paid 2 of 3 · plan €2,785 / mo" for the active payments of a kind
  const recInfo = (kind) => {
    const rs = active.filter((r) => (r.kind === 'subscription' ? 'subscription' : 'mandatory') === kind);
    if (!rs.length) return t('tile.no_recurring');
    const plan = rs.reduce((s, r) => s + monthly(r), 0);
    return t('tile.paid_of', { paid: rs.filter((r) => L.paid[r.id]).length, total: rs.length, plan: eur0.format(plan) });
  };
  $('tMand').textContent = fmt(mand); $('tMandSub').textContent = recInfo('mandatory');
  $('tSubs').textContent = fmt(subs); $('tSubsSub').textContent = recInfo('subscription');
  $('tVar').textContent = fmt(total); $('tVarSub').textContent = tn('tile.entries', L.listed.length);
  if (document.activeElement !== $('income')) $('income').value = S.income ? String(S.income).replace('.', ',') : '';
  if (document.activeElement !== $('pstart')) $('pstart').value = String(S.periodStart);
  // income: actual for the period, or the plan until something is entered
  const incFact = S.inc.reduce((s, i) => s + (i.amount || 0), 0);
  const incBase = incFact > 0 ? incFact : S.income || 0;
  $('tRest').textContent = fmt(incBase - total);
  $('tIncFact').textContent = incFact > 0 ? t('tile.received', { sum: fmt(incFact) }) + (S.income ? t('tile.plan_suffix', { sum: fmt(S.income) }) : '')
    : t(S.income ? 'tile.no_income_plan' : 'tile.no_income');
  const expected = L.pending.reduce((s, r) => s + monthly(r), 0);
  $('tExpected').hidden = !expected;
  $('tExpected').textContent = expected ? t('tile.expected', { sum: fmt(expected) }) : '';
  $('tExpected').title = L.pending.map((r) => `${r.name}: ${fmt(monthly(r))}`).join('\n');

  const base = Math.max(incBase, total) || 1;
  const parts = [[t('tile.mandatory'), mand, 'var(--mand)'], [t('tile.subs'), subs, 'var(--subs)'], [t('load.other'), vari, 'var(--var)']];
  $('stack').innerHTML = '';
  parts.forEach(([n, v, c]) => { const i = el('i'); i.style.width = `${(v / base) * 100}%`; i.style.background = c; i.title = `${n}: ${fmt(v)}`; $('stack').appendChild(i); });
  $('legend').innerHTML = '';
  parts.forEach(([n, v, c]) => {
    const s = el('span'); const sw = el('span', 'sw'); sw.style.background = c; s.appendChild(sw);
    s.append(`${n} `); s.appendChild(el('b', 'num', fmt(v))); if (total) s.append(` · ${Math.round((v / total) * 100)}%`);
    $('legend').appendChild(s);
  });
  if (incBase) {
    const s = el('span'); s.append(`${t(incFact > 0 ? 'load.income_fact' : 'load.income_plan')} `); s.appendChild(el('b', 'num', fmt(incBase)));
    s.append(` · ${t('load.used', { pct: Math.round((total / incBase) * 100) })}`); $('legend').appendChild(s);
  }

  renderRec(active.length, L);
  renderCats(L.listed, L.kindOf);
  // the category filter applies only to the expense list, totals cover everything
  const byCat = S.cat ? L.listed.filter((e) => (e.category || OTHER) === S.cat) : L.listed;
  renderAccs(byCat);
  const shown = S.acc ? byCat.filter((e) => (e.account || OTHER) === S.acc) : byCat;
  $('catReset').hidden = !S.cat;
  renderExp(shown, L, total);
  renderInc(incFact);
  renderInsights();
}

/* ---------- AI advice ---------- */
const PRIO = { high: ['ai.prio_high', 'var(--bad)'], medium: ['ai.prio_medium', 'var(--var)'], low: ['ai.prio_low', 'var(--muted)'] };
function renderInsights() {
  const B = $('aiBody'); B.innerHTML = '';
  const { configured, saved, busy, error, provider, local, cfgError, open } = S.ai;
  // the panel is collapsed by default; the header shows a short summary
  B.hidden = !open; $('aiPanel').classList.toggle('collapsed', !open); $('aiToggle').setAttribute('aria-expanded', String(open));
  $('aiRun').disabled = busy || !configured;
  $('aiRun').textContent = t(busy ? 'ai.busy' : saved ? 'ai.refresh' : 'ai.get');
  const when = (opts) => new Date(saved.created_at).toLocaleString(locale, opts);
  if (open) {
    $('aiMeta').textContent = saved ? `${t('ai.updated', { when: when({ day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) })} · ${saved.model}`
      : provider ? `${provider} · ${S.ai.model}` : '';
  } else if (!configured) $('aiMeta').textContent = t('ai.not_configured');
  else if (busy) $('aiMeta').textContent = '';
  else if (!saved) $('aiMeta').textContent = t('ai.never');
  else {
    const n = saved.result.recommendations.length, sv = saved.result.savings_potential;
    $('aiMeta').textContent = [sv > 0 ? `≈ ${t('ai.per_month', { sum: eur0.format(sv) })}` : null, tn('ai.tips', n),
      t('ai.updated', { when: when({ day: 'numeric', month: 'short' }) })].filter(Boolean).join(' · ');
  }
  if (!configured) {
    if (cfgError) B.appendChild(el('div', 'ai-error', cfgError));
    B.appendChild(el('div', 'empty', t('ai.setup')));
    return;
  }
  if (error) B.appendChild(el('div', 'ai-error', error));
  if (!saved) {
    if (!busy) {
      const where = local ? t('ai.local') : t('ai.remote', { provider });
      B.appendChild(el('div', 'empty', t('ai.intro', { provider, month: monthLabel(S.month, true), where })));
    }
    return;
  }
  const r = saved.result;
  B.appendChild(el('p', 'ai-summary', r.summary));
  if (r.savings_potential > 0) {
    const p = el('div', 'ai-saving'); p.append(t('ai.can_save')); p.appendChild(el('b', 'num', t('ai.per_month', { sum: eur0.format(r.savings_potential) }))); B.appendChild(p);
  }
  const order = { high: 0, medium: 1, low: 2 };
  [...r.recommendations].sort((a, b) => order[a.priority] - order[b.priority] || b.saving_per_month - a.saving_per_month).forEach((x) => {
    const [prio, color] = PRIO[x.priority] || PRIO.low;
    const c = el('div', 'ai-card'); c.style.borderLeftColor = color;
    const h = el('div', 'ai-card-h');
    h.append(el('b', null, x.title));
    if (x.saving_per_month > 0) h.append(el('span', 'num ai-minus', t('ai.minus_per_month', { sum: eur0.format(x.saving_per_month) })));
    c.appendChild(h);
    const meta = el('div', 'ai-card-meta'); const chip = el('span', 'chip', t(prio)); chip.style.color = color; meta.append(chip, label(x.category));
    c.append(meta, el('div', 'ai-card-d', x.detail));
    B.appendChild(c);
  });
  [[r.positives, t('ai.positives')], [r.warnings, t('ai.warnings')]].forEach(([items, title]) => {
    if (!items?.length) return;
    B.appendChild(el('div', 'eyebrow ai-h', title));
    const ul = el('ul', 'ai-list'); items.forEach((x) => ul.appendChild(el('li', null, x))); B.appendChild(ul);
  });
}
$('aiToggle').onclick = () => { S.ai.open = !S.ai.open; renderInsights(); };
$('aiRun').onclick = async () => {
  // the current month and the three previous ones — for comparison
  const periods = [0, -1, -2, -3].map((k) => {
    const [y, m] = S.month.split('-').map(Number); const dt = new Date(y, m - 1 + k, 1);
    const id = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; const { from, to } = periodRange(id, S.periodStart);
    return { label: id, from, to };
  });
  const month = S.month;
  Object.assign(S.ai, { busy: true, error: '', open: true }); renderInsights();
  try {
    const r = await api('POST', '/api/insights', { periods });
    if (S.month === month) Object.assign(S.ai, aiStatus(r), { saved: r.saved });
  } catch (err) {
    if (err.status !== 401) S.ai.error = err.message || t('ai.failed');
    if (err.status === 503) S.ai.configured = false;
  }
  S.ai.busy = false; renderInsights();
};

function renderRec(nActive, led) {
  const L = $('recList'); L.innerHTML = '';
  $('recMeta').textContent = tn('rec.active', nActive);
  if (!S.rec.length) { L.appendChild(el('div', 'empty', S.loaded ? t('rec.empty') : t('common.loading'))); return; }
  [['mandatory', t('tile.mandatory'), 'var(--mand)'], ['subscription', t('tile.subs'), 'var(--subs)']].forEach(([k, title, color]) => {
    const items = S.rec.filter((r) => (r.kind === 'subscription' ? 'subscription' : 'mandatory') === k)
      .sort((a, b) => (b.active !== false) - (a.active !== false) || monthly(b) - monthly(a));
    if (!items.length) return;
    const plan = items.filter((r) => r.active !== false).reduce((s, r) => s + monthly(r), 0); // for reference
    const gh = el('div', 'group-h'); gh.append(el('span', null, title), el('span', 'num', t('rec.plan', { sum: fmt(plan) }))); L.appendChild(gh);
    items.forEach((r) => {
      const it = el('div', `item${r.active === false ? ' off' : ''}`);
      const bar = el('span', 'bar'); bar.style.background = color; it.appendChild(bar);
      const nm = el('div', 'name', r.name); if (r.active === false) nm.appendChild(el('span', 'chip', t('rec.paused_chip'))); it.appendChild(nm);
      const a = el('div', 'amt', fmt(r.amount));
      a.appendChild(el('small', null, r.period !== 'month' ? t('rec.monthly_equiv', { period: t(`period.${r.period}`), sum: fmt(monthly(r)) }) : t('period.month')));
      it.appendChild(a);
      const ops = el('div', 'ops');
      const e = el('button', 'op', t('common.edit')); e.type = 'button'; e.onclick = () => editRec(r);
      const p = el('button', 'op', t(r.active === false ? 'rec.resume' : 'rec.pause')); p.type = 'button';
      p.onclick = () => write(async () => { await api('PATCH', `/api/recurring/${r.id}`, { active: r.active === false }); await loadRec(); render(); });
      const d = el('button', 'op', t('common.delete')); d.type = 'button';
      d.onclick = () => confirmBtn(d, () => write(async () => { await api('DELETE', `/api/recurring/${r.id}`); await loadRec(); render(); }, t('common.deleted')));
      ops.append(e, p, d); it.appendChild(ops);
      const det = [label(r.category), label(r.account)]; if (r.day) det.push(t('rec.charge_day', { day: r.day }));
      const ps = led.paid[r.id];
      if (ps) det.push(t('rec.paid_on', { dates: ps.map((x) => shortDate(x.date)).join(', '), sum: fmt(led.paidSum(r)) }));
      else if (r.period === 'month' && r.active !== false) det.push(t('rec.not_charged'));
      it.appendChild(el('div', 'det', det.filter(Boolean).join(' · ')));
      L.appendChild(it);
    });
  });
}

function renderCats(listed, kindOf) {
  const C = $('cats'); C.innerHTML = ''; C.classList.toggle('filtered', Boolean(S.cat)); const m = {};
  // f — recurring payments, v — other spending
  listed.forEach((e) => { const c = e.category || OTHER; (m[c] = m[c] || { f: 0, v: 0 })[kindOf(e) ? 'f' : 'v'] += e.amount || 0; });
  const rows = Object.entries(m).map(([k, v]) => [k, v.f, v.v, v.f + v.v]).sort((a, b) => b[3] - a[3]);
  if (!rows.length) { C.appendChild(el('div', 'empty', t('exp.cats_empty'))); return; }
  const max = rows[0][3] || 1;
  rows.forEach(([k, f, v, sum]) => {
    const r = el('button', `cat${S.cat === k ? ' on' : ''}`); r.type = 'button'; r.setAttribute('aria-pressed', String(S.cat === k));
    r.title = S.cat === k ? t('exp.cat_show_all') : t('exp.cat_only', { name: label(k) });
    r.onclick = () => { S.cat = S.cat === k ? null : k; render(); };
    r.appendChild(el('span', 'lbl', label(k)));
    const tr = el('div', 'track');
    const a = el('i'); a.style.width = `${(f / max) * 100}%`; a.style.background = 'var(--mand)'; a.title = t('exp.bar_recurring', { sum: fmt(f) });
    const b = el('i'); b.style.width = `${(v / max) * 100}%`; b.style.background = 'var(--var)'; b.title = t('exp.bar_other', { sum: fmt(v) });
    tr.append(a, b); r.appendChild(tr); r.appendChild(el('span', 'v', fmt(sum))); C.appendChild(r);
  });
}

// Account filter above the list: sums respect the selected category
function renderAccs(list) {
  const A = $('accs'); A.innerHTML = '';
  const by = {}; list.forEach((e) => { const a = e.account || OTHER; by[a] = (by[a] || 0) + (e.amount || 0); });
  if (S.acc && !(S.acc in by)) by[S.acc] = 0; // the selected account with no spending — so that the selection can be cleared
  const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
  A.hidden = !rows.length;
  const chip = (name, sum, on, onclick) => {
    const b = el('button', 'op acc'); b.type = 'button'; b.setAttribute('aria-pressed', String(on));
    b.append(`${name} · `); b.appendChild(el('span', 'num', eur0.format(sum))); b.onclick = onclick; A.appendChild(b);
  };
  chip(t('common.all'), list.reduce((s, e) => s + (e.amount || 0), 0), !S.acc, () => { S.acc = null; render(); });
  rows.forEach(([a, sum]) => chip(label(a), sum, S.acc === a, () => { S.acc = S.acc === a ? null : a; render(); }));
}

function renderExp(exp, led, all) {
  const L = $('expList'); L.innerHTML = '';
  const recOf = (e) => (e.recurring_id && led.byId.get(e.recurring_id)) || null;
  const sumOf = (arr) => arr.reduce((s, e) => s + (e.amount || 0), 0);
  const total = sumOf(exp);
  const filters = [S.cat ? t('common.quoted', { name: label(S.cat) }) : null, S.acc ? label(S.acc) : null].filter(Boolean);
  $('expMeta').textContent = filters.length ? t('exp.meta_filtered', { filters: filters.join(' · '), sum: fmt(total), all: fmt(all) }) : `${monthLabel(S.month)} · ${fmt(total)}`;
  if (!exp.length) {
    const month = monthLabel(S.month, true);
    const msg = filters.length ? t('exp.none_filtered', {
      acc: S.acc ? t('exp.none_acc', { name: label(S.acc) }) : '', cat: S.cat ? t('exp.none_cat', { name: label(S.cat) }) : '', month,
    }) : t('exp.none', { month });
    L.appendChild(el('div', 'empty', S.loaded ? msg : t('common.loading'))); return;
  }
  const by = {}; exp.forEach((e) => (by[e.date] = by[e.date] || []).push(e));
  Object.keys(by).sort().reverse().forEach((d) => {
    const items = by[d]; const sum = items.reduce((s, e) => s + (e.amount || 0), 0);
    const gh = el('div', 'group-h');
    gh.append(el('span', null, new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' })), el('span', 'num', fmt(sum)));
    L.appendChild(gh);
    items.forEach((e) => {
      const rr = recOf(e);
      const it = el('div', 'item'); const bar = el('span', 'bar');
      bar.style.background = rr ? (rr.kind === 'subscription' ? 'var(--subs)' : 'var(--mand)') : 'var(--var)'; it.appendChild(bar);
      it.appendChild(el('div', 'name', e.note || label(e.category)));
      it.appendChild(el('div', 'amt', fmt(e.amount)));
      const ops = el('div', 'ops');
      const ed = el('button', 'op', t('common.edit')); ed.type = 'button'; ed.onclick = () => editExp(e);
      const del = el('button', 'op', t('common.delete')); del.type = 'button';
      del.onclick = () => confirmBtn(del, () => write(async () => { await api('DELETE', `/api/expenses/${e.id}`); await loadExp(); render(); }, t('common.deleted')));
      ops.append(ed, del); it.appendChild(ops);
      const orig = e.original && e.original !== e.note ? t('import.from_statement', { text: e.original }) : null;
      const c = rr ? led.cover(e) : null;
      const forLbl = c && c !== periodOf(e.date, S.periodStart) ? t('exp.for', { month: monthLabel(c, true) }) : null;
      it.appendChild(el('div', 'det', [e.note ? label(e.category) : null, label(e.account), rr ? t('exp.recurring', { name: rr.name }) : null, forLbl, orig].filter(Boolean).join(' · ')));
      L.appendChild(it);
    });
  });
}

function renderInc(total) {
  const L = $('incList'); L.innerHTML = '';
  $('incMeta').textContent = `${monthLabel(S.month)} · +${fmt(total)}`;
  // by source: "Salary €3,000 · Freelance €350"
  const by = {}; S.inc.forEach((i) => { by[i.source] = (by[i.source] || 0) + (i.amount || 0); });
  const src = Object.entries(by).sort((a, b) => b[1] - a[1]);
  $('incBySrc').hidden = !src.length;
  $('incBySrc').textContent = src.length ? t('inc.by_source', { list: src.map(([k, v]) => `${label(k)} ${fmt(v)}`).join(' · ') }) : '';
  if (!S.inc.length) { L.appendChild(el('div', 'empty', S.loaded ? t('inc.empty', { month: monthLabel(S.month, true) }) : t('common.loading'))); return; }
  const byDate = {}; S.inc.forEach((i) => (byDate[i.date] = byDate[i.date] || []).push(i));
  Object.keys(byDate).sort().reverse().forEach((d) => {
    const items = byDate[d]; const sum = items.reduce((a, i) => a + (i.amount || 0), 0);
    const gh = el('div', 'group-h');
    gh.append(el('span', null, new Date(`${d}T12:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' })), el('span', 'num', `+${fmt(sum)}`));
    L.appendChild(gh);
    items.forEach((i) => {
      const it = el('div', 'item'); const bar = el('span', 'bar'); bar.style.background = 'var(--good)'; it.appendChild(bar);
      it.appendChild(el('div', 'name', i.note || label(i.source)));
      it.appendChild(el('div', 'amt plus', `+${fmt(i.amount)}`));
      const ops = el('div', 'ops');
      const ed = el('button', 'op', t('common.edit')); ed.type = 'button'; ed.onclick = () => editInc(i);
      const del = el('button', 'op', t('common.delete')); del.type = 'button';
      del.onclick = () => confirmBtn(del, () => write(async () => { await api('DELETE', `/api/incomes/${i.id}`); await loadExp(); render(); }, t('common.deleted')));
      ops.append(ed, del); it.appendChild(ops);
      const orig = i.original && i.original !== i.note ? t('import.from_statement', { text: i.original }) : null;
      it.appendChild(el('div', 'det', [i.note ? label(i.source) : null, label(i.account), orig].filter(Boolean).join(' · ')));
      L.appendChild(it);
    });
  });
}

/* ---------- recurring payments ---------- */
function resetRec() {
  S.editRec = null; $('recForm').reset(); setKind('mandatory'); $('rCat').value = 'Жильё'; $('rAcc').value = 'Bank of Cyprus';
  $('rSubmit').textContent = t('rec.add'); $('rCancel').hidden = true; $('rHint').textContent = '';
}
function editRec(r) {
  S.editRec = r; $('rName').value = r.name; $('rAmt').value = String(r.amount).replace('.', ','); $('rPeriod').value = r.period || 'month';
  setKind(r.kind || 'mandatory'); $('rCat').value = r.category || OTHER; $('rAcc').value = r.account || OTHER; $('rDay').value = r.day || '';
  $('rSubmit').textContent = t('common.save'); $('rCancel').hidden = false; $('rHint').textContent = t('rec.editing', { name: r.name }); $('rName').focus();
}
$('rCancel').onclick = resetRec;
$('rKind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setKind(b.dataset.v); });
$('recForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseAmt($('rAmt').value);
  if (!(amount > 0)) { $('rHint').textContent = t('rec.amount_hint'); $('rAmt').focus(); return; }
  const name = $('rName').value.trim(); if (!name) { $('rName').focus(); return; }
  const day = parseInt($('rDay').value, 10);
  const body = { name, amount, period: $('rPeriod').value, kind: S.kind, category: $('rCat').value, account: $('rAcc').value, day: day >= 1 && day <= 31 ? day : null };
  const ed = S.editRec;
  const ok = await write(async () => {
    if (ed) await api('PUT', `/api/recurring/${ed.id}`, { ...body, active: ed.active !== false });
    else await api('POST', '/api/recurring', { ...body, active: true });
    await loadRec(); render();
  }, ed ? t('common.saved') : t('rec.added'));
  if (ok) resetRec();
});

/* ---------- expenses ---------- */
function resetExp() {
  S.editExp = null; const keepDate = $('eDate').value, keepAcc = $('eAcc').value; $('expForm').reset();
  $('eDate').value = keepDate || today(); $('eAcc').value = keepAcc; $('eCat').value = 'Продукты'; $('eRec').value = ''; fillForSelect('');
  $('eSubmit').textContent = t('exp.add'); $('eCancel').hidden = true; $('eHint').textContent = '';
}
function editExp(x) {
  S.editExp = x; $('eAmt').value = String(x.amount).replace('.', ','); $('eCat').value = x.category || OTHER; $('eDate').value = x.date;
  $('eNote').value = x.note || ''; $('eAcc').value = x.account || OTHER; $('eRec').value = x.recurring_id || ''; fillForSelect(x.for_month);
  $('eSubmit').textContent = t('common.save'); $('eCancel').hidden = false; $('eHint').textContent = t('exp.editing'); $('eAmt').focus();
}
$('eCancel').onclick = resetExp;
// choosing a recurring payment fills in its category and account, and the name and amount if those fields are empty
// "For month": auto by the nearest charge date, or manual — the previous, this or the next month relative to the payment date
function fillForSelect(val) {
  const r = S.rec.find((x) => x.id === $('eRec').value);
  $('eForWrap').hidden = !r; if (!r) return;
  const date = $('eDate').value || today();
  const target = (fm) => periodOf(dueDate(date, r.day, fm, r.period === 'month'), S.periodStart);
  const sel = $('eFor'); sel.innerHTML = '';
  const add = (v, text) => { const o = el('option', null, text); o.value = v; sel.appendChild(o); };
  add('', t('exp.auto', { month: monthLabel(target(null), true) }));
  const seen = new Set(); const [y, m] = date.split('-').map(Number);
  [-1, 0, 1].forEach((k) => {
    const dt = new Date(y, m - 1 + k, 1); const fm = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
    const p = target(fm); if (seen.has(p)) return; seen.add(p); add(fm, t('exp.for', { month: monthLabel(p, true) }));
  });
  sel.value = val || '';
  if (val && sel.value !== val) { add(val, t('exp.for', { month: monthLabel(target(val), true) })); sel.value = val; }
}
$('eDate').addEventListener('change', () => fillForSelect($('eFor').value));
$('eRec').addEventListener('change', () => {
  fillForSelect($('eFor').value);
  const r = S.rec.find((x) => x.id === $('eRec').value); if (!r) return;
  if (CATS.includes(r.category)) $('eCat').value = r.category;
  if (ACCS.includes(r.account)) $('eAcc').value = r.account;
  if (!$('eNote').value.trim()) $('eNote').value = r.name;
  if (!$('eAmt').value.trim()) $('eAmt').value = String(r.amount).replace('.', ',');
});
$('expForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseAmt($('eAmt').value);
  if (!(amount > 0)) { $('eHint').textContent = t('exp.amount_hint'); $('eAmt').focus(); return; }
  const date = $('eDate').value || today();
  const body = { amount, category: $('eCat').value, date, note: $('eNote').value.trim(), account: $('eAcc').value,
    recurring_id: $('eRec').value || null, for_month: $('eRec').value ? ($('eFor').value || null) : null };
  const ed = S.editExp;
  const ok = await write(async () => {
    if (ed) await api('PUT', `/api/expenses/${ed.id}`, body); else await api('POST', '/api/expenses', body);
    S.month = periodOf(date, S.periodStart); await loadExp(); render();
  }, ed ? t('common.saved') : t('exp.added'));
  if (ok) { resetExp(); $('eAmt').focus(); }
});

/* ---------- income ---------- */
function resetInc() {
  S.editInc = null; const keepDate = $('iDate').value, keepAcc = $('iAcc').value; $('incForm').reset();
  $('iDate').value = keepDate || today(); $('iAcc').value = keepAcc;
  $('iSubmit').textContent = t('inc.add'); $('iCancel').hidden = true; $('iHint').textContent = '';
}
function editInc(x) {
  S.editInc = x; $('iAmt').value = String(x.amount).replace('.', ','); $('iSrc').value = x.source ? label(x.source) : ''; $('iDate').value = x.date;
  $('iNote').value = x.note || ''; $('iAcc').value = x.account || OTHER;
  $('iSubmit').textContent = t('common.save'); $('iCancel').hidden = false; $('iHint').textContent = t('inc.editing'); $('iAmt').focus();
}
$('iCancel').onclick = resetInc;
$('incForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseAmt($('iAmt').value);
  if (!(amount > 0)) { $('iHint').textContent = t('inc.amount_hint'); $('iAmt').focus(); return; }
  const date = $('iDate').value || today();
  const body = { amount, source: canonSource($('iSrc').value.trim()) || OTHER, date, note: $('iNote').value.trim(), account: $('iAcc').value };
  const ed = S.editInc;
  const ok = await write(async () => {
    if (ed) await api('PUT', `/api/incomes/${ed.id}`, body); else await api('POST', '/api/incomes', body);
    S.month = periodOf(date, S.periodStart); await Promise.all([loadExp(), loadSources()]); render();
  }, ed ? t('common.saved') : t('inc.added'));
  if (ok) { resetInc(); $('iAmt').focus(); }
});

/* ---------- planned income ---------- */
let incT;
async function saveIncome() {
  clearTimeout(incT);
  const raw = $('income').value.trim(); const v = raw ? parseAmt(raw) : 0;
  if (!(v >= 0) || v === S.income) return;
  S.income = v; render();
  await write(() => api('PUT', '/api/settings', { income: v }));
}
$('income').addEventListener('input', () => { clearTimeout(incT); incT = setTimeout(saveIncome, 700); });
$('income').addEventListener('blur', saveIncome);

/* ---------- start of the budget month ---------- */
async function savePeriodStart() {
  const v = parseInt($('pstart').value, 10);
  if (!(v >= 1 && v <= 31)) { $('pstart').value = String(S.periodStart); return; }
  if (v === S.periodStart) return;
  await write(async () => {
    await api('PUT', '/api/settings', { periodStart: v });
    S.periodStart = v; S.month = periodOf(today(), v);
    await loadExp(); render();
  }, t('tile.pstart_saved', { day: v }));
}
$('pstart').addEventListener('change', savePeriodStart);
$('pstart').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pstart').blur(); });

/* ---------- months ---------- */
async function shiftMonth(d) {
  const [y, m] = S.month.split('-').map(Number); const dt = new Date(y, m - 1 + d, 1);
  S.month = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; render();
  try { await loadExp(); } catch { /* 401 is already handled */ }
  render();
}
$('catReset').onclick = () => { S.cat = null; render(); };
$('prevM').onclick = () => shiftMonth(-1);
$('nextM').onclick = () => shiftMonth(1);

/* ---------- CSV import ---------- */
const FORMAT_ACC = { revolut: 'Revolut', boc: 'Bank of Cyprus' };
// mode — 'csv' | 'bank' (which source the panel shows), null when closed;
// table — a parsed CSV file; bank — rows loaded from a bank account { id, name, rows, dropped, from, to }
const IMP = { mode: null, table: null, format: null, bank: null, items: [], dropped: null, showHidden: false, seq: 0 };
const IMPORT_MODES = { csv: ['import.title', 'import.meta'], bank: ['bank.panel_title', 'bank.panel_meta'] };
const visibleImport = () => IMP.items.filter((i) => i.status === 'new' || (i.status === 'skipped' && IMP.showHidden));

/** Opens the import panel for one source; switching to the other source drops the rows loaded so far */
async function openImport(mode) {
  if (!$('importPanel').hidden && IMP.mode === mode) return;
  if (!$('importPanel').hidden) closeImport();
  IMP.mode = mode;
  const [title, meta] = IMPORT_MODES[mode];
  $('impH').textContent = t(title); $('impMeta').textContent = t(meta);
  $('csvBox').hidden = mode !== 'csv'; $('bankBox').hidden = mode !== 'bank';
  $('importPanel').hidden = false;
  if (mode === 'csv') { $('impFile').focus(); return; }
  await loadBank();
  const first = $('bankBox').querySelector('.bank-row .btn:not(:disabled), #bankCountry:not([hidden])');
  if (first && IMP.mode === 'bank') first.focus();
}
function closeImport() {
  $('importPanel').hidden = true; $('impFile').value = ''; $('impShowHidden').checked = false; $('impHint').textContent = '';
  Object.assign(IMP, { mode: null, table: null, format: null, bank: null, items: [], dropped: null, showHidden: false }); IMP.seq++;
  $('impMap').hidden = true; $('impAcc').disabled = false; renderImport();
}
function fillCols(sel, headers, val, optional) {
  sel.innerHTML = '';
  if (optional) { const o = el('option', null, '—'); o.value = '-1'; sel.appendChild(o); }
  headers.forEach((h, i) => { const o = el('option', null, h || t('import.column', { n: i + 1 })); o.value = String(i); sel.appendChild(o); });
  sel.value = String(val < 0 && !optional ? 0 : val);
}
const colMap = () => ({ date: +$('mDate').value, desc: +$('mDesc').value, amount: +$('mAmt').value, debit: +$('mDebit').value, credit: +$('mCredit').value, negSign: $('mNeg').checked });

async function previewImport() {
  const seq = ++IMP.seq;
  let src = IMP.bank; // rows from the bank are ready; a CSV table is converted with the chosen columns
  if (!src) {
    const m = colMap();
    $('mNegWrap').hidden = !(m.debit < 0 && m.amount >= 0);
    $('mCreditWrap').hidden = m.debit < 0; // the credit column only makes sense together with a debit column
    src = toTransactions(IMP.table, IMP.format, m);
  }
  const { rows, dropped } = src;
  let items = []; $('impHint').textContent = '';
  if (rows.length) {
    try { items = await api('POST', '/api/import/preview', { account: $('impAcc').value, rows }); }
    catch (err) { if (err.status !== 401 && seq === IMP.seq) $('impHint').textContent = err.message || t('import.preview_failed'); }
  }
  if (seq !== IMP.seq) return; // a reply to an outdated request
  IMP.dropped = dropped;
  // for an income, category holds the source (free text); for an expense — a category from the list
  IMP.items = items.map((r) => ({ ...r, category: r.kind === 'income' || CATS.includes(r.category) ? r.category : OTHER, checked: r.status === 'new' }))
    .sort((a, b) => (b.datetime || b.date).localeCompare(a.datetime || a.date));
  $('impMeta').textContent = IMP.bank ? t('bank.source', { name: IMP.bank.name })
    : t('import.format', { name: FORMAT_ACC[IMP.format] || t('import.format_custom') });
  renderImport();
}

function importRow(it) {
  const r = el('div', `imp-row${it.checked ? '' : ' off'}`);
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = it.checked; cb.setAttribute('aria-label', t('import.submit'));
  const dt = el('div', 'd num', new Date(`${it.date}T12:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: '2-digit' }));
  const nm = el('input', 'fld nm'); nm.value = it.note; nm.maxLength = 500; nm.setAttribute('aria-label', t('field.name'));
  const inc = it.kind === 'income';
  let cat;
  if (inc) { cat = el('input', 'fld icat'); cat.value = label(it.category); cat.maxLength = 100; cat.setAttribute('list', 'incSources'); cat.setAttribute('aria-label', t('import.income_source')); }
  else { cat = el('select', 'fld icat'); fillSelect(cat, CATS, it.category); cat.setAttribute('aria-label', t('field.category')); }
  const rec = el('select', 'fld irec'); fillRecSelect(rec, it.recurring_id, t('import.not_recurring')); rec.setAttribute('aria-label', t('field.recurring'));
  const amt = el('div', `amt${inc ? ' plus' : ''}`, `${inc ? '+' : ''}${fmt(it.amount)}`);
  const orig = el('div', 'orig'); const origT = el('span');
  if (inc) orig.appendChild(el('span', 'chip inc', t('import.chip_income')));
  if (it.status === 'skipped') orig.appendChild(el('span', 'chip', t('import.chip_hidden')));
  orig.appendChild(origT);
  const showOrig = () => {
    origT.textContent = it.note.trim() !== it.original ? t('import.from_statement', { text: it.original }) : '';
    orig.hidden = !origT.textContent && it.status !== 'skipped' && !inc;
  };
  cb.onchange = () => { it.checked = cb.checked; r.classList.toggle('off', !cb.checked); updateImportBtn(); };
  nm.oninput = () => { it.note = nm.value; showOrig(); };
  cat.onchange = () => { it.category = inc ? canonSource(cat.value.trim()) || OTHER : cat.value; };
  rec.onchange = () => {
    it.recurring_id = rec.value || null;
    const p = S.rec.find((x) => x.id === rec.value); if (!p) return;
    if (it.note === it.original) { it.note = p.name; nm.value = p.name; showOrig(); }
    if (CATS.includes(p.category)) { it.category = p.category; cat.value = p.category; }
  };
  showOrig(); r.append(cb, dt, nm, cat, ...(inc ? [] : [rec]), amt, orig); // an income has no recurring payment
  return r;
}

function renderImport() {
  const L = $('impList'); L.innerHTML = '';
  const its = IMP.items; const cnt = (st) => its.filter((i) => i.status === st).length;
  const nNew = cnt('new'), nImp = cnt('imported'), nHid = cnt('skipped'), d = IMP.dropped || {};
  const loaded = Boolean(IMP.table || IMP.bank);
  $('impTools').hidden = !loaded;
  const nInc = its.filter((i) => i.status === 'new' && i.kind === 'income').length;
  const parts = [nInc ? t('import.sum_new_inc', { n: nNew, inc: nInc }) : t('import.sum_new', { n: nNew })];
  [[nImp, 'imported'], [nHid, 'hidden'], [d.pending, 'pending'], [d.currency, 'currency'],
    [d.cancelled, 'cancelled'], [d.other, 'other'], [d.bad, 'bad']].forEach(([n, k]) => { if (n) parts.push(t(`import.sum_${k}`, { n })); });
  $('impSummary').textContent = parts.join(' · ');
  $('impHiddenWrap').hidden = !nHid;
  const vis = visibleImport();
  if (loaded && !vis.length) {
    L.appendChild(el('div', 'empty', its.length ? t('import.none_new')
      : `${t('import.none_found')}${IMP.bank || IMP.format === 'revolut' ? '' : ` ${t('import.check_columns')}`}`));
  }
  vis.forEach((it) => L.appendChild(importRow(it)));
  updateImportBtn();
}

function updateImportBtn() {
  const vis = visibleImport();
  const k = vis.filter((i) => i.checked).length, s = vis.filter((i) => !i.checked && i.status === 'new').length;
  $('impSubmit').disabled = !(k + s);
  const parts = []; if (k) parts.push(t('import.btn_import', { n: k })); if (s) parts.push(t(k ? 'import.btn_hide_also' : 'import.btn_hide', { n: s }));
  $('impSubmit').textContent = parts.join(' · ') || t('import.submit');
}

// Import menu: hover opens it with a mouse, click/tap opens it on phones and from the keyboard
const impMenu = $('impMenu');
const menuItems = () => [...impMenu.querySelectorAll('[role="menuitem"]')];
let menuTimer;
function setMenu(open, focusFirst = false) {
  clearTimeout(menuTimer);
  impMenu.hidden = !open; $('impOpen').setAttribute('aria-expanded', String(open));
  if (open && focusFirst) menuItems()[0].focus();
}
$('impMenuWrap').addEventListener('mouseenter', () => setMenu(true));
// a short delay lets the pointer cross the gap between the button and the menu
$('impMenuWrap').addEventListener('mouseleave', () => { clearTimeout(menuTimer); menuTimer = setTimeout(() => setMenu(false), 200); });
// detail === 0: the click came from Enter/Space — move the focus into the menu
$('impOpen').onclick = (e) => setMenu(true, e.detail === 0);
$('impOpen').addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setMenu(true, true); } });
impMenu.addEventListener('keydown', (e) => {
  const items = menuItems(); const i = items.indexOf(document.activeElement);
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault(); items[(i + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
  } else if (e.key === 'Escape') { setMenu(false); $('impOpen').focus(); } else if (e.key === 'Tab') setMenu(false);
});
impMenu.addEventListener('click', (e) => {
  const item = e.target.closest('[data-mode]'); if (!item) return;
  setMenu(false); openImport(item.dataset.mode);
});
document.addEventListener('click', (e) => { if (!impMenu.hidden && !$('impMenuWrap').contains(e.target)) setMenu(false); });
$('impCancel').onclick = closeImport;
$('impFile').addEventListener('change', async () => {
  const f = $('impFile').files[0]; if (!f) return;
  const table = parseCsv(await f.text());
  if (!table.rows.length) { closeImport(); openImport('csv'); $('impHint').textContent = t('import.no_rows'); return; }
  IMP.bank = null; $('impAcc').disabled = false; IMP.table = table; IMP.format = detectFormat(table.headers);
  if (FORMAT_ACC[IMP.format]) $('impAcc').value = FORMAT_ACC[IMP.format];
  $('impMap').hidden = IMP.format === 'revolut';
  if (IMP.format !== 'revolut') {
    const g = guessMapping(table.headers);
    fillCols($('mDate'), table.headers, g.date); fillCols($('mDesc'), table.headers, g.desc, true);
    fillCols($('mAmt'), table.headers, g.amount, true); fillCols($('mDebit'), table.headers, g.debit, true);
    fillCols($('mCredit'), table.headers, g.credit, true);
    $('mNeg').checked = hasNegatives(table.rows, g.amount);
  }
  await previewImport();
});
// a signed amount and a separate debit column are mutually exclusive
$('mAmt').addEventListener('change', () => { if (+$('mAmt').value >= 0) { $('mDebit').value = '-1'; $('mNeg').checked = hasNegatives(IMP.table.rows, +$('mAmt').value); } });
$('mDebit').addEventListener('change', () => { if (+$('mDebit').value >= 0) $('mAmt').value = '-1'; });
['mDate', 'mDesc', 'mAmt', 'mDebit', 'mCredit', 'mNeg', 'impAcc'].forEach((id) => $(id).addEventListener('change', () => { if (IMP.table || IMP.bank) previewImport(); }));
$('impShowHidden').onchange = () => { IMP.showHidden = $('impShowHidden').checked; renderImport(); };
const markAll = (v) => { visibleImport().forEach((i) => { i.checked = v; }); renderImport(); };
$('impAll').onclick = () => markAll(true);
$('impNone').onclick = () => markAll(false);
$('impSubmit').onclick = async () => {
  const items = visibleImport().filter((i) => i.checked || i.status === 'new').map((i) => ({
    date: i.date, datetime: i.datetime, amount: i.amount, original: i.original, n: i.n,
    action: i.checked ? 'import' : 'skip', note: i.note.trim(), category: i.category, kind: i.kind || 'expense',
    recurring_id: i.kind === 'income' ? null : i.recurring_id || null,
  }));
  if (!items.length) return;
  $('impSubmit').disabled = true;
  let res;
  const ok = await write(async () => {
    res = await api('POST', '/api/import/commit', { account: $('impAcc').value, items });
    // remember the reviewed range: "since the last sync" continues from it (the server moves it only forward, without gaps)
    if (IMP.bank) await api('PUT', `/api/bank/accounts/${IMP.bank.id}`, { synced_from: IMP.bank.from, synced_to: IMP.bank.to }).catch(() => {});
    // if nothing was added to the current month, show the latest imported month
    const months = items.filter((i) => i.action === 'import').map((i) => periodOf(i.date, S.periodStart)).sort();
    if (months.length && !months.includes(S.month)) S.month = months.at(-1);
    await Promise.all([loadExp(), loadSources()]); render();
  });
  if (ok) {
    toast(t('import.done', { n: res.imported }) + (res.incomes ? t('import.done_incomes', { n: res.incomes }) : '') + (res.skipped ? t('import.done_skipped', { n: res.skipped }) : ''));
    closeImport();
  } else updateImportBtn();
};

/* ---------- bank sync (Enable Banking) ---------- */
// An alternative to a CSV file: rows come from the bank API and go through the same review list
const BANK = { configured: false, error: null, connections: [], country: '', custom: {} };
const RENEW_DAYS = 14; // offer to renew the consent this many days before it expires
const BANK_RESULTS = ['connected', 'denied', 'error'];
const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoLocal(d); };
const budgetMonthStart = () => periodRange(periodOf(today(), S.periodStart), S.periodStart).from;

// Sync period: the choice is shared by all accounts and remembered in this browser
const SYNC_PERIODS = ['since', 'day', 'week', 'month', 'custom'];
const PERIOD_KEY = 'bank.period';
let syncPeriod = 'since';
try { const v = localStorage.getItem(PERIOD_KEY); if (SYNC_PERIODS.includes(v)) syncPeriod = v; } catch { /* storage unavailable */ }
const saveSyncPeriod = (v) => { syncPeriod = v; try { localStorage.setItem(PERIOD_KEY, v); } catch { /* storage unavailable */ } };

/** { from, to } for an account: "since" starts a week before the last reviewed date, the first time — at the budget month */
function syncRange(a) {
  const d = today();
  switch (syncPeriod) {
    case 'day': return { from: d, to: d };
    case 'week': return { from: addDays(d, -6), to: d };
    case 'month': return { from: budgetMonthStart(), to: d };
    case 'custom': return BANK.custom[a.id] || (BANK.custom[a.id] = { from: budgetMonthStart(), to: d });
    default: return { from: a.synced_to ? addDays(a.synced_to, -7) : budgetMonthStart(), to: d };
  }
}
const validRange = (r) => Boolean(r.from && r.to && r.from <= r.to && r.to <= today());
function rangeText({ from, to }) {
  const f = (s) => new Date(`${s}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  return from === to ? f(from) : `${f(from)} – ${f(to)}`;
}
async function loadBank() {
  try { Object.assign(BANK, await api('GET', '/api/bank')); }
  catch (err) { if (err.status === 401) return; BANK.error = err.message; }
  renderBank();
  if (BANK.configured && BANK.country !== $('bankCountry').value.trim().toUpperCase()) loadAspsps();
}
async function loadAspsps() {
  const cc = $('bankCountry').value.trim().toUpperCase(); const sel = $('bankAspsp');
  sel.innerHTML = ''; $('bankConnectBtn').disabled = true;
  if (!/^[A-Z]{2}$/.test(cc)) return;
  try {
    const list = await api('GET', `/api/bank/aspsps?country=${cc}`);
    if ($('bankCountry').value.trim().toUpperCase() !== cc) return; // the country was changed meanwhile
    BANK.country = cc;
    list.forEach((name) => { const o = el('option', null, name); o.value = name; sel.appendChild(o); });
    $('bankConnectBtn').disabled = !list.length;
  } catch (err) { if (err.status !== 401) $('bankHint').textContent = err.message || t('bank.failed'); }
}
async function connectBank(aspsp, country, btn) {
  btn.disabled = true; $('bankHint').textContent = t('bank.redirecting');
  try { const { url } = await api('POST', '/api/bank/connect', { aspsp, country }); window.location.href = url; }
  catch (err) { btn.disabled = false; if (err.status !== 401) $('bankHint').textContent = err.message || t('bank.result_error'); }
}
async function syncBank(conn, acc, range, btn) {
  btn.disabled = true; $('bankHint').textContent = t('bank.loading');
  try {
    const r = await api('GET', `/api/bank/transactions?account_id=${acc.id}&from=${range.from}&to=${range.to}`);
    $('impFile').value = ''; $('impMap').hidden = true; $('bankHint').textContent = '';
    if (![...$('impAcc').options].some((o) => o.value === r.account)) $('impAcc').appendChild(Object.assign(el('option', null, label(r.account)), { value: r.account }));
    // the bank defines the account: it cannot be changed for these rows
    $('impAcc').value = r.account; $('impAcc').disabled = true;
    Object.assign(IMP, { table: null, format: null, bank: { id: acc.id, name: conn.aspsp_name, rows: r.rows, dropped: r.dropped, from: r.from, to: r.to } });
    await previewImport();
  } catch (err) {
    if (err.status !== 401) $('bankHint').textContent = err.message || t('bank.failed');
    if (err.status === 409) loadBank(); // the consent has expired: show it
  }
  btn.disabled = false;
}
function renderBank() {
  const L = $('bankList'); L.innerHTML = '';
  $('bankConnect').hidden = !BANK.configured;
  $('bankHint').textContent = BANK.error || (BANK.configured ? '' : t('bank.setup'));
  BANK.connections.forEach((c) => {
    const left = c.expired ? 0 : Math.ceil((new Date(c.valid_until) - Date.now()) / 864e5);
    const soon = c.expired || left <= RENEW_DAYS;
    const head = el('div', 'bank-h');
    head.append(el('b', null, c.aspsp_name), el('span', `meta${soon ? ' warn' : ''}`, c.expired ? t('bank.expired')
      : t('bank.valid_until', { date: new Date(c.valid_until).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }) })));
    if (soon) {
      const renew = el('button', 'op', t('bank.renew')); renew.type = 'button';
      renew.onclick = () => connectBank(c.aspsp_name, c.aspsp_country, renew); head.appendChild(renew);
    }
    const off = el('button', 'op', t('bank.disconnect')); off.type = 'button';
    off.onclick = () => confirmBtn(off, () => write(async () => { await api('DELETE', `/api/bank/connections/${c.id}`); await loadBank(); }));
    head.appendChild(off); L.appendChild(head);
    c.accounts.forEach((a) => {
      const row = el('div', 'bank-row');
      const name = el('span', 'nm', [a.name, a.iban_tail ? `••${a.iban_tail}` : '', a.currency].filter(Boolean).join(' ') || c.aspsp_name);
      // period: a ready-made range with its dates shown next to it, or two date fields for a custom one
      const per = el('select', 'fld per'); per.setAttribute('aria-label', t('bank.period'));
      SYNC_PERIODS.forEach((p) => { const o = el('option', null, t(`bank.p_${p}`)); o.value = p; per.appendChild(o); });
      per.value = syncPeriod;
      const rng = el('span', 'rng');
      const custom = el('span', 'custom');
      const dateField = (key, aria) => {
        const i = el('input', 'fld'); i.type = 'date'; i.max = today(); i.setAttribute('aria-label', t(aria));
        i.onchange = () => { syncRange(a)[key] = i.value; refresh(); }; return i;
      };
      const from = dateField('from', 'bank.date_from'), to = dateField('to', 'bank.date_to');
      custom.append(from, el('span', 'dash', '–'), to);
      const go = el('button', 'btn small', t('bank.sync')); go.type = 'button';
      const refresh = () => {
        const r = syncRange(a), ok = validRange(r);
        custom.hidden = syncPeriod !== 'custom'; rng.hidden = !custom.hidden;
        from.value = r.from; to.value = r.to; rng.textContent = rangeText(r);
        go.disabled = c.expired || !ok; go.title = ok ? '' : t('bank.bad_range');
      };
      // the period is shared: changing it on one account updates all of them
      per.onchange = () => { saveSyncPeriod(per.value); renderBank(); };
      go.onclick = () => { const r = syncRange(a); if (validRange(r)) syncBank(c, a, { ...r }, go); };
      refresh();
      row.append(name, per, rng, custom, go); L.appendChild(row);
    });
  });
}
$('bankCountry').addEventListener('change', loadAspsps);
$('bankConnectBtn').onclick = () => { if ($('bankAspsp').value) connectBank($('bankAspsp').value, BANK.country, $('bankConnectBtn')); };
// Back from the bank: /api/bank/callback redirects to /?bank=connected|denied|error
function bankReturn() {
  const result = new URLSearchParams(window.location.search).get('bank');
  if (!BANK_RESULTS.includes(result)) return;
  window.history.replaceState(null, '', window.location.pathname);
  openImport('bank'); toast(t(`bank.result_${result}`));
}

/* ---------- sign-in ---------- */
function showLogin() { $('appView').hidden = true; $('loginView').hidden = false; $('pw').focus(); }
function showApp(passwordRequired) { $('loginView').hidden = true; $('appView').hidden = false; $('logout').hidden = !passwordRequired; }
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('loginErr').textContent = '';
  try { await api('POST', '/api/login', { password: $('pw').value }); $('pw').value = ''; showApp(true); loadAll(); }
  catch (err) { $('loginErr').textContent = err.message || t('login.failed'); }
});
$('logout').onclick = async () => { await api('POST', '/api/logout').catch(() => {}); S.rec = []; S.exp = []; S.inc = []; S.cat = null; S.acc = null; S.loaded = false; closeImport(); showLogin(); };

/* ---------- start ---------- */
applyDom();
// Language switch: the choice is kept in a cookie (the server reads it too), the page reloads in the new language
document.querySelectorAll('.lang').forEach((box) => {
  LANGS.forEach(({ id, label: name }) => {
    const b = el('button', null, name); b.type = 'button'; b.lang = id; b.setAttribute('aria-pressed', String(id === lang));
    b.onclick = () => setLang(id); box.appendChild(b);
  });
});
fillSelect($('rCat'), CATS, 'Жильё'); fillSelect($('eCat'), CATS, 'Продукты');
fillSelect($('rAcc'), ACCS, 'Bank of Cyprus'); fillSelect($('eAcc'), ACCS, 'Revolut'); fillSelect($('impAcc'), ACCS, 'Revolut'); fillSelect($('iAcc'), ACCS, 'Bank of Cyprus');
$('eDate').value = today(); $('iDate').value = today();
(async () => {
  try {
    const me = await api('GET', '/api/me');
    if (!me.authed) { showLogin(); return; }
    showApp(me.passwordRequired); render(); loadAll(); bankReturn();
  } catch { showApp(false); const b = $('banner'); b.hidden = false; b.textContent = t('banner.server_down'); }
})();
