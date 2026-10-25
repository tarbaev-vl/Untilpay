import { parseCsv, detectFormat, guessMapping, toTransactions, hasNegatives } from '/csv.js';
import { periodRange, periodOf, rangeLabel } from '/period.js';

const CATS = ['Жильё', 'Коммунальные', 'Связь и интернет', 'Продукты', 'Кафе и рестораны', 'Транспорт', 'Авто', 'Здоровье', 'Страховка', 'Кредиты', 'Подписки и сервисы', 'Образование', 'Дети', 'Одежда', 'Дом', 'Развлечения', 'Спорт', 'Путешествия', 'Подарки', 'Другое'];
const ACCS = ['Bank of Cyprus', 'Revolut', 'Наличные', 'Другое'];
const PERIOD = { month: { k: 1, t: 'в месяц' }, year: { k: 1 / 12, t: 'в год' }, quarter: { k: 1 / 3, t: 'в квартал' }, week: { k: 52 / 12, t: 'в неделю' } };
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

const $ = (id) => document.getElementById(id);
const eur = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const eur0 = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const fmt = (n) => eur.format(Math.round((n || 0) * 100) / 100);
const parseAmt = (s) => { const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN; };
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthOf = (s) => s.slice(0, 7);
const monthly = (r) => (r.amount || 0) * (PERIOD[r.period] || PERIOD.month).k;
const monthLabel = (m) => { const [y, mm] = m.split('-'); return `${MONTHS[+mm - 1]} ${y}`; };
const plural = (n, a, b, c) => { const m = n % 10, h = n % 100; return m === 1 && h !== 11 ? a : m >= 2 && m <= 4 && (h < 12 || h > 14) ? b : c; };

const S = { rec: [], exp: [], income: 0, periodStart: 1, cat: null, month: monthOf(today()), editRec: null, editExp: null, kind: 'mandatory', loaded: false };

/* ---------- API ---------- */
class ApiError extends Error { constructor(status, body) { super(body?.message || `HTTP ${status}`); this.status = status; this.body = body; } }
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new ApiError(401, { message: 'Нужно войти' }); }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data);
  return data;
}
async function write(fn, msg) {
  try { await fn(); if (msg) toast(msg); return true; }
  catch (err) { if (err.status !== 401) toast(err.message || 'Не сохранилось. Проверьте связь.'); return false; }
}

/* ---------- загрузка ---------- */
async function loadRec() { S.rec = await api('GET', '/api/recurring'); }
const periodQs = () => { const r = periodRange(S.month, S.periodStart); return `from=${r.from}&to=${r.to}`; };
async function loadExp() { S.exp = await api('GET', `/api/expenses?${periodQs()}`); }
async function loadSettings() { const st = await api('GET', '/api/settings'); S.income = st.income || 0; S.periodStart = st.periodStart || 1; }
async function loadAll() {
  try {
    await loadSettings();
    if (!S.loaded) S.month = periodOf(today(), S.periodStart); // период зависит от дня начала месяца
    await Promise.all([loadRec(), loadExp()]); S.loaded = true; $('banner').hidden = true;
  }
  catch (err) { if (err.status !== 401) { const b = $('banner'); b.hidden = false; b.textContent = 'Не удалось загрузить данные с сервера. Проверьте, что контейнеры запущены.'; } }
  render();
}

/* ---------- UI helpers ---------- */
function fillSelect(sel, arr, val) { sel.innerHTML = ''; arr.forEach((a) => { const o = document.createElement('option'); o.value = a; o.textContent = a; sel.appendChild(o); }); if (val) sel.value = val; }
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function toast(t) { const e = $('toast'); e.textContent = t; e.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { e.hidden = true; }, 2400); }
function confirmBtn(btn, fn) {
  if (btn.dataset.armed) { fn(); return; }
  btn.dataset.armed = '1'; const old = btn.textContent; btn.textContent = 'Точно?'; btn.classList.add('danger');
  setTimeout(() => { delete btn.dataset.armed; btn.textContent = old; btn.classList.remove('danger'); }, 3000);
}
function setKind(v) {
  S.kind = v; [...$('rKind').children].forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  if (v === 'subscription' && $('rCat').value === 'Жильё') $('rCat').value = 'Подписки и сервисы';
}

/* ---------- регулярные платежи и их оплаты ---------- */
// Расход со ссылкой на регулярный платёж закрывает этот платёж и не входит в «Расходы»
function ledger() {
  const byId = new Map(S.rec.map((r) => [r.id, r]));
  const paid = {}; const free = [];
  S.exp.forEach((e) => { if (e.recurring_id && byId.has(e.recurring_id)) (paid[e.recurring_id] = paid[e.recurring_id] || []).push(e); else free.push(e); });
  const paidSum = (r) => (paid[r.id] || []).reduce((s, e) => s + (e.amount || 0), 0);
  // ежемесячный: факт заменяет план; годовой, квартальный, недельный — месячная доля по плану
  const effective = (r) => (r.period === 'month' && paid[r.id] ? paidSum(r) : monthly(r));
  const counted = S.rec.filter((r) => r.active !== false || paid[r.id]);
  return { byId, paid, paidSum, free, effective, counted };
}
const shortDate = (d) => `${d.slice(8, 10)}.${d.slice(5, 7)}`;
function fillRecSelect(sel, val, none = '—') {
  sel.innerHTML = ''; const o = el('option', null, none); o.value = ''; sel.appendChild(o);
  [...S.rec].sort((a, b) => a.name.localeCompare(b.name, 'ru')).forEach((r) => {
    const x = el('option', null, r.active === false ? `${r.name} (пауза)` : r.name); x.value = r.id; sel.appendChild(x);
  });
  sel.value = val || '';
}

/* ---------- render ---------- */
function render() {
  $('monthLabel').textContent = monthLabel(S.month);
  $('periodLabel').hidden = S.periodStart <= 1; $('periodLabel').textContent = rangeLabel(S.month, S.periodStart);
  $('csvLink').href = `/api/expenses.csv?${periodQs()}`;
  const L = ledger();
  const active = S.rec.filter((r) => r.active !== false);
  const mand = L.counted.filter((r) => r.kind !== 'subscription').reduce((s, r) => s + L.effective(r), 0);
  const subs = L.counted.filter((r) => r.kind === 'subscription').reduce((s, r) => s + L.effective(r), 0);
  const exp = L.free;
  const vari = exp.reduce((s, e) => s + (e.amount || 0), 0);
  if (document.activeElement !== $('eRec')) fillRecSelect($('eRec'), $('eRec').value);
  const total = mand + subs + vari;

  $('tMand').textContent = fmt(mand); $('tMandSub').textContent = `в месяц · ${eur0.format(mand * 12)} в год`;
  $('tSubs').textContent = fmt(subs); $('tSubsSub').textContent = `в месяц · ${eur0.format(subs * 12)} в год`;
  $('tVar').textContent = fmt(vari); $('tVarSub').textContent = `${exp.length} ${plural(exp.length, 'запись', 'записи', 'записей')}`;
  if (document.activeElement !== $('income')) $('income').value = S.income ? String(S.income).replace('.', ',') : '';
  if (document.activeElement !== $('pstart')) $('pstart').value = String(S.periodStart);
  $('tRest').textContent = fmt((S.income || 0) - total);

  const base = Math.max(S.income || 0, total) || 1;
  const parts = [['Обязательные', mand, 'var(--mand)'], ['Подписки', subs, 'var(--subs)'], ['Расходы', vari, 'var(--var)']];
  $('stack').innerHTML = '';
  parts.forEach(([n, v, c]) => { const i = el('i'); i.style.width = `${(v / base) * 100}%`; i.style.background = c; i.title = `${n}: ${fmt(v)}`; $('stack').appendChild(i); });
  $('legend').innerHTML = '';
  parts.forEach(([n, v, c]) => {
    const s = el('span'); const sw = el('span', 'sw'); sw.style.background = c; s.appendChild(sw);
    s.append(`${n} `); s.appendChild(el('b', 'num', fmt(v))); if (total) s.append(` · ${Math.round((v / total) * 100)}%`);
    $('legend').appendChild(s);
  });
  if (S.income) { const s = el('span'); s.append('Доход '); s.appendChild(el('b', 'num', fmt(S.income))); s.append(` · занято ${Math.round((total / S.income) * 100)}%`); $('legend').appendChild(s); }

  renderRec(active.length, L);
  renderCats(L.counted, exp, L.effective);
  // фильтр по категории действует только на список расходов, итоги считаются по всем
  const shown = S.cat ? S.exp.filter((e) => (e.category || 'Другое') === S.cat) : S.exp;
  $('catReset').hidden = !S.cat;
  renderExp(shown, L, vari);
}

function renderRec(nActive, led) {
  const L = $('recList'); L.innerHTML = '';
  $('recMeta').textContent = `${nActive} ${plural(nActive, 'активный', 'активных', 'активных')}`;
  if (!S.rec.length) { L.appendChild(el('div', 'empty', S.loaded ? 'Добавьте аренду, коммуналку, страховку, подписки. Годовые платежи пересчитаются в месячную сумму.' : 'Загрузка…')); return; }
  [['mandatory', 'Обязательные', 'var(--mand)'], ['subscription', 'Подписки', 'var(--subs)']].forEach(([k, title, color]) => {
    const items = S.rec.filter((r) => (r.kind === 'subscription' ? 'subscription' : 'mandatory') === k)
      .sort((a, b) => (b.active !== false) - (a.active !== false) || monthly(b) - monthly(a));
    if (!items.length) return;
    const sum = items.filter((r) => r.active !== false || led.paid[r.id]).reduce((s, r) => s + led.effective(r), 0);
    const gh = el('div', 'group-h'); gh.append(el('span', null, title), el('span', 'num', `${fmt(sum)} / мес`)); L.appendChild(gh);
    items.forEach((r) => {
      const it = el('div', `item${r.active === false ? ' off' : ''}`);
      const bar = el('span', 'bar'); bar.style.background = color; it.appendChild(bar);
      const nm = el('div', 'name', r.name); if (r.active === false) nm.appendChild(el('span', 'chip', 'на паузе')); it.appendChild(nm);
      const a = el('div', 'amt', fmt(r.amount));
      a.appendChild(el('small', null, r.period !== 'month' ? `${PERIOD[r.period].t} · ${fmt(monthly(r))}/мес` : 'в месяц'));
      it.appendChild(a);
      const ops = el('div', 'ops');
      const e = el('button', 'op', 'Изм.'); e.type = 'button'; e.onclick = () => editRec(r);
      const p = el('button', 'op', r.active === false ? 'Вкл.' : 'Пауза'); p.type = 'button';
      p.onclick = () => write(async () => { await api('PATCH', `/api/recurring/${r.id}`, { active: r.active === false }); await loadRec(); render(); });
      const d = el('button', 'op', 'Удал.'); d.type = 'button';
      d.onclick = () => confirmBtn(d, () => write(async () => { await api('DELETE', `/api/recurring/${r.id}`); await loadRec(); render(); }, 'Удалено'));
      ops.append(e, p, d); it.appendChild(ops);
      const det = [r.category, r.account]; if (r.day) det.push(`списание ${r.day}-го`);
      const ps = led.paid[r.id];
      if (ps) det.push(`оплачено ${ps.map((x) => shortDate(x.date)).join(', ')} · ${fmt(led.paidSum(r))}`);
      else if (r.period === 'month' && r.active !== false) det.push('ещё не списан');
      it.appendChild(el('div', 'det', det.filter(Boolean).join(' · ')));
      L.appendChild(it);
    });
  });
}

function renderCats(active, exp, effective) {
  const C = $('cats'); C.innerHTML = ''; C.classList.toggle('filtered', Boolean(S.cat)); const m = {};
  active.forEach((r) => { const c = r.category || 'Другое'; (m[c] = m[c] || { f: 0, v: 0 }).f += effective(r); });
  exp.forEach((e) => { const c = e.category || 'Другое'; (m[c] = m[c] || { f: 0, v: 0 }).v += e.amount || 0; });
  const rows = Object.entries(m).map(([k, v]) => [k, v.f, v.v, v.f + v.v]).sort((a, b) => b[3] - a[3]);
  if (!rows.length) { C.appendChild(el('div', 'empty', 'Здесь появится разбивка по категориям.')); return; }
  const max = rows[0][3] || 1;
  rows.forEach(([k, f, v, t]) => {
    const r = el('button', `cat${S.cat === k ? ' on' : ''}`); r.type = 'button'; r.setAttribute('aria-pressed', String(S.cat === k));
    r.title = S.cat === k ? 'Показать все расходы' : `Показать только «${k}»`;
    r.onclick = () => { S.cat = S.cat === k ? null : k; render(); };
    r.appendChild(el('span', 'lbl', k));
    const tr = el('div', 'track');
    const a = el('i'); a.style.width = `${(f / max) * 100}%`; a.style.background = 'var(--mand)'; a.title = `Регулярные: ${fmt(f)}`;
    const b = el('i'); b.style.width = `${(v / max) * 100}%`; b.style.background = 'var(--var)'; b.title = `Расходы: ${fmt(v)}`;
    tr.append(a, b); r.appendChild(tr); r.appendChild(el('span', 'v', fmt(t))); C.appendChild(r);
  });
}

function renderExp(exp, led, all) {
  const L = $('expList'); L.innerHTML = '';
  const recOf = (e) => (e.recurring_id && led.byId.get(e.recurring_id)) || null;
  const sumOf = (arr) => arr.reduce((s, e) => s + (e.amount || 0), 0);
  const total = sumOf(exp.filter((e) => !recOf(e))), linked = sumOf(exp.filter(recOf));
  $('expMeta').textContent = (S.cat ? `«${S.cat}» · ${fmt(total)} из ${fmt(all)}` : `${monthLabel(S.month)} · ${fmt(total)}`)
    + (linked ? ` · регулярные ${fmt(linked)}` : '');
  if (!exp.length) {
    const msg = S.cat ? `В категории «${S.cat}» за ${monthLabel(S.month).toLowerCase()} расходов нет.`
      : `За ${monthLabel(S.month).toLowerCase()} расходов пока нет. Внесите первую трату в форму выше.`;
    L.appendChild(el('div', 'empty', S.loaded ? msg : 'Загрузка…')); return;
  }
  const by = {}; exp.forEach((e) => (by[e.date] = by[e.date] || []).push(e));
  Object.keys(by).sort().reverse().forEach((d) => {
    const items = by[d]; const sum = items.reduce((s, e) => s + (e.amount || 0), 0);
    const gh = el('div', 'group-h');
    gh.append(el('span', null, new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long' })), el('span', 'num', fmt(sum)));
    L.appendChild(gh);
    items.forEach((e) => {
      const rr = recOf(e);
      const it = el('div', 'item'); const bar = el('span', 'bar');
      bar.style.background = rr ? (rr.kind === 'subscription' ? 'var(--subs)' : 'var(--mand)') : 'var(--var)'; it.appendChild(bar);
      it.appendChild(el('div', 'name', e.note || e.category));
      it.appendChild(el('div', 'amt', fmt(e.amount)));
      const ops = el('div', 'ops');
      const ed = el('button', 'op', 'Изм.'); ed.type = 'button'; ed.onclick = () => editExp(e);
      const del = el('button', 'op', 'Удал.'); del.type = 'button';
      del.onclick = () => confirmBtn(del, () => write(async () => { await api('DELETE', `/api/expenses/${e.id}`); await loadExp(); render(); }, 'Удалено'));
      ops.append(ed, del); it.appendChild(ops);
      const orig = e.original && e.original !== e.note ? `из выписки: ${e.original}` : null;
      it.appendChild(el('div', 'det', [e.note ? e.category : null, e.account, rr ? `регулярный: ${rr.name}` : null, orig].filter(Boolean).join(' · ')));
      L.appendChild(it);
    });
  });
}

/* ---------- регулярные платежи ---------- */
function resetRec() {
  S.editRec = null; $('recForm').reset(); setKind('mandatory'); $('rCat').value = 'Жильё'; $('rAcc').value = 'Bank of Cyprus';
  $('rSubmit').textContent = 'Добавить платёж'; $('rCancel').hidden = true; $('rHint').textContent = '';
}
function editRec(r) {
  S.editRec = r; $('rName').value = r.name; $('rAmt').value = String(r.amount).replace('.', ','); $('rPeriod').value = r.period || 'month';
  setKind(r.kind || 'mandatory'); $('rCat').value = r.category || 'Другое'; $('rAcc').value = r.account || 'Другое'; $('rDay').value = r.day || '';
  $('rSubmit').textContent = 'Сохранить'; $('rCancel').hidden = false; $('rHint').textContent = `Редактирование: ${r.name}`; $('rName').focus();
}
$('rCancel').onclick = resetRec;
$('rKind').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) setKind(b.dataset.v); });
$('recForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseAmt($('rAmt').value);
  if (!(amount > 0)) { $('rHint').textContent = 'Введите сумму больше нуля, например 12,99'; $('rAmt').focus(); return; }
  const name = $('rName').value.trim(); if (!name) { $('rName').focus(); return; }
  const day = parseInt($('rDay').value, 10);
  const body = { name, amount, period: $('rPeriod').value, kind: S.kind, category: $('rCat').value, account: $('rAcc').value, day: day >= 1 && day <= 31 ? day : null };
  const ed = S.editRec;
  const ok = await write(async () => {
    if (ed) await api('PUT', `/api/recurring/${ed.id}`, { ...body, active: ed.active !== false });
    else await api('POST', '/api/recurring', { ...body, active: true });
    await loadRec(); render();
  }, ed ? 'Сохранено' : 'Платёж добавлен');
  if (ok) resetRec();
});

/* ---------- расходы ---------- */
function resetExp() {
  S.editExp = null; const keepDate = $('eDate').value, keepAcc = $('eAcc').value; $('expForm').reset();
  $('eDate').value = keepDate || today(); $('eAcc').value = keepAcc; $('eCat').value = 'Продукты'; $('eRec').value = '';
  $('eSubmit').textContent = 'Добавить расход'; $('eCancel').hidden = true; $('eHint').textContent = '';
}
function editExp(x) {
  S.editExp = x; $('eAmt').value = String(x.amount).replace('.', ','); $('eCat').value = x.category || 'Другое'; $('eDate').value = x.date;
  $('eNote').value = x.note || ''; $('eAcc').value = x.account || 'Другое'; $('eRec').value = x.recurring_id || '';
  $('eSubmit').textContent = 'Сохранить'; $('eCancel').hidden = false; $('eHint').textContent = 'Редактирование расхода'; $('eAmt').focus();
}
$('eCancel').onclick = resetExp;
// выбор регулярного платежа подставляет его категорию, счёт, а в пустые поля — название и сумму
$('eRec').addEventListener('change', () => {
  const r = S.rec.find((x) => x.id === $('eRec').value); if (!r) return;
  if (CATS.includes(r.category)) $('eCat').value = r.category;
  if (ACCS.includes(r.account)) $('eAcc').value = r.account;
  if (!$('eNote').value.trim()) $('eNote').value = r.name;
  if (!$('eAmt').value.trim()) $('eAmt').value = String(r.amount).replace('.', ',');
});
$('expForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amount = parseAmt($('eAmt').value);
  if (!(amount > 0)) { $('eHint').textContent = 'Введите сумму больше нуля, например 23,40'; $('eAmt').focus(); return; }
  const date = $('eDate').value || today();
  const body = { amount, category: $('eCat').value, date, note: $('eNote').value.trim(), account: $('eAcc').value, recurring_id: $('eRec').value || null };
  const ed = S.editExp;
  const ok = await write(async () => {
    if (ed) await api('PUT', `/api/expenses/${ed.id}`, body); else await api('POST', '/api/expenses', body);
    S.month = periodOf(date, S.periodStart); await loadExp(); render();
  }, ed ? 'Сохранено' : 'Расход добавлен');
  if (ok) { resetExp(); $('eAmt').focus(); }
});

/* ---------- доход ---------- */
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

/* ---------- начало бюджетного месяца ---------- */
async function savePeriodStart() {
  const v = parseInt($('pstart').value, 10);
  if (!(v >= 1 && v <= 31)) { $('pstart').value = String(S.periodStart); return; }
  if (v === S.periodStart) return;
  await write(async () => {
    await api('PUT', '/api/settings', { periodStart: v });
    S.periodStart = v; S.month = periodOf(today(), v);
    await loadExp(); render();
  }, `Месяц начинается ${v}-го`);
}
$('pstart').addEventListener('change', savePeriodStart);
$('pstart').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('pstart').blur(); });

/* ---------- месяцы ---------- */
async function shiftMonth(d) {
  const [y, m] = S.month.split('-').map(Number); const dt = new Date(y, m - 1 + d, 1);
  S.month = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`; render();
  try { await loadExp(); } catch { /* 401 уже обработан */ }
  render();
}
$('catReset').onclick = () => { S.cat = null; render(); };
$('prevM').onclick = () => shiftMonth(-1);
$('nextM').onclick = () => shiftMonth(1);

/* ---------- импорт CSV ---------- */
const FORMAT_ACC = { revolut: 'Revolut', boc: 'Bank of Cyprus' };
const IMP = { table: null, format: null, items: [], dropped: null, showHidden: false, seq: 0 };
const visibleImport = () => IMP.items.filter((i) => i.status === 'new' || (i.status === 'skipped' && IMP.showHidden));

function openImport() { $('importPanel').hidden = false; $('impFile').focus(); }
function closeImport() {
  $('importPanel').hidden = true; $('impFile').value = ''; $('impShowHidden').checked = false; $('impHint').textContent = '';
  Object.assign(IMP, { table: null, format: null, items: [], dropped: null, showHidden: false }); IMP.seq++;
  $('impMap').hidden = true; $('impMeta').textContent = 'Revolut, Bank of Cyprus или любой CSV'; renderImport();
}
function fillCols(sel, headers, val, optional) {
  sel.innerHTML = '';
  if (optional) { const o = el('option', null, '—'); o.value = '-1'; sel.appendChild(o); }
  headers.forEach((h, i) => { const o = el('option', null, h || `Колонка ${i + 1}`); o.value = String(i); sel.appendChild(o); });
  sel.value = String(val < 0 && !optional ? 0 : val);
}
const colMap = () => ({ date: +$('mDate').value, desc: +$('mDesc').value, amount: +$('mAmt').value, debit: +$('mDebit').value, negSign: $('mNeg').checked });

async function previewImport() {
  const seq = ++IMP.seq; const m = colMap();
  $('mNegWrap').hidden = !(m.debit < 0 && m.amount >= 0);
  const { rows, dropped } = toTransactions(IMP.table, IMP.format, m);
  let items = []; $('impHint').textContent = '';
  if (rows.length) {
    try { items = await api('POST', '/api/import/preview', { account: $('impAcc').value, rows }); }
    catch (err) { if (err.status !== 401 && seq === IMP.seq) $('impHint').textContent = err.message || 'Не удалось проверить выписку'; }
  }
  if (seq !== IMP.seq) return; // пришёл ответ на устаревший запрос
  IMP.dropped = dropped;
  IMP.items = items.map((r) => ({ ...r, category: CATS.includes(r.category) ? r.category : 'Другое', checked: r.status === 'new' }))
    .sort((a, b) => (b.datetime || b.date).localeCompare(a.datetime || a.date));
  $('impMeta').textContent = `Формат: ${{ revolut: 'Revolut', boc: 'Bank of Cyprus' }[IMP.format] || 'свой — проверьте колонки'}`;
  renderImport();
}

function importRow(it) {
  const r = el('div', `imp-row${it.checked ? '' : ' off'}`);
  const cb = el('input'); cb.type = 'checkbox'; cb.checked = it.checked; cb.setAttribute('aria-label', 'Импортировать');
  const dt = el('div', 'd num', new Date(`${it.date}T12:00:00`).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }));
  const nm = el('input', 'fld nm'); nm.value = it.note; nm.maxLength = 500; nm.setAttribute('aria-label', 'Название');
  const cat = el('select', 'fld icat'); fillSelect(cat, CATS, it.category); cat.setAttribute('aria-label', 'Категория');
  const rec = el('select', 'fld irec'); fillRecSelect(rec, it.recurring_id, 'не регулярный'); rec.setAttribute('aria-label', 'Регулярный платёж');
  const amt = el('div', 'amt', fmt(it.amount));
  const orig = el('div', 'orig'); const origT = el('span');
  if (it.status === 'skipped') orig.appendChild(el('span', 'chip', 'скрыта'));
  orig.appendChild(origT);
  const showOrig = () => {
    origT.textContent = it.note.trim() !== it.original ? `из выписки: ${it.original}` : '';
    orig.hidden = !origT.textContent && it.status !== 'skipped';
  };
  cb.onchange = () => { it.checked = cb.checked; r.classList.toggle('off', !cb.checked); updateImportBtn(); };
  nm.oninput = () => { it.note = nm.value; showOrig(); };
  cat.onchange = () => { it.category = cat.value; };
  rec.onchange = () => {
    it.recurring_id = rec.value || null;
    const p = S.rec.find((x) => x.id === rec.value); if (!p) return;
    if (it.note === it.original) { it.note = p.name; nm.value = p.name; showOrig(); }
    if (CATS.includes(p.category)) { it.category = p.category; cat.value = p.category; }
  };
  showOrig(); r.append(cb, dt, nm, cat, rec, amt, orig);
  return r;
}

function renderImport() {
  const L = $('impList'); L.innerHTML = '';
  const its = IMP.items; const cnt = (st) => its.filter((i) => i.status === st).length;
  const nNew = cnt('new'), nImp = cnt('imported'), nHid = cnt('skipped'), d = IMP.dropped || {};
  $('impTools').hidden = !IMP.table;
  const parts = [`новых ${nNew}`];
  [[nImp, 'уже импортировано'], [nHid, 'скрыто'], [d.income, 'поступлений пропущено'], [d.pending, 'в обработке'], [d.currency, 'не в EUR'],
    [d.cancelled, 'отменённых'], [d.other, 'копилки'], [d.bad, 'не распознано']].forEach(([n, t]) => { if (n) parts.push(`${t} ${n}`); });
  $('impSummary').textContent = parts.join(' · ');
  $('impHiddenWrap').hidden = !nHid;
  const vis = visibleImport();
  if (IMP.table && !vis.length) {
    L.appendChild(el('div', 'empty', its.length ? 'Новых транзакций нет: всё из этого файла уже импортировано или скрыто.'
      : `Расходов в файле не нашлось.${IMP.format === 'revolut' ? '' : ' Проверьте, какие колонки выбраны.'}`));
  }
  vis.forEach((it) => L.appendChild(importRow(it)));
  updateImportBtn();
}

function updateImportBtn() {
  const vis = visibleImport();
  const k = vis.filter((i) => i.checked).length, s = vis.filter((i) => !i.checked && i.status === 'new').length;
  $('impSubmit').disabled = !(k + s);
  const t = []; if (k) t.push(`Импортировать ${k}`); if (s) t.push(`${k ? 'скрыть' : 'Скрыть'} ${s}`);
  $('impSubmit').textContent = t.join(' · ') || 'Импортировать';
}

$('impOpen').onclick = () => ($('importPanel').hidden ? openImport() : closeImport());
$('impCancel').onclick = closeImport;
$('impFile').addEventListener('change', async () => {
  const f = $('impFile').files[0]; if (!f) return;
  const table = parseCsv(await f.text());
  if (!table.rows.length) { closeImport(); openImport(); $('impHint').textContent = 'В файле не нашлось строк с данными'; return; }
  IMP.table = table; IMP.format = detectFormat(table.headers);
  if (FORMAT_ACC[IMP.format]) $('impAcc').value = FORMAT_ACC[IMP.format];
  $('impMap').hidden = IMP.format === 'revolut';
  if (IMP.format !== 'revolut') {
    const g = guessMapping(table.headers);
    fillCols($('mDate'), table.headers, g.date); fillCols($('mDesc'), table.headers, g.desc, true);
    fillCols($('mAmt'), table.headers, g.amount, true); fillCols($('mDebit'), table.headers, g.debit, true);
    $('mNeg').checked = hasNegatives(table.rows, g.amount);
  }
  await previewImport();
});
// сумма со знаком и отдельная колонка списаний — взаимоисключающие
$('mAmt').addEventListener('change', () => { if (+$('mAmt').value >= 0) { $('mDebit').value = '-1'; $('mNeg').checked = hasNegatives(IMP.table.rows, +$('mAmt').value); } });
$('mDebit').addEventListener('change', () => { if (+$('mDebit').value >= 0) $('mAmt').value = '-1'; });
['mDate', 'mDesc', 'mAmt', 'mDebit', 'mNeg', 'impAcc'].forEach((id) => $(id).addEventListener('change', () => { if (IMP.table) previewImport(); }));
$('impShowHidden').onchange = () => { IMP.showHidden = $('impShowHidden').checked; renderImport(); };
const markAll = (v) => { visibleImport().forEach((i) => { i.checked = v; }); renderImport(); };
$('impAll').onclick = () => markAll(true);
$('impNone').onclick = () => markAll(false);
$('impSubmit').onclick = async () => {
  const items = visibleImport().filter((i) => i.checked || i.status === 'new').map((i) => ({
    date: i.date, datetime: i.datetime, amount: i.amount, original: i.original, n: i.n,
    action: i.checked ? 'import' : 'skip', note: i.note.trim(), category: i.category, recurring_id: i.recurring_id || null,
  }));
  if (!items.length) return;
  $('impSubmit').disabled = true;
  let res;
  const ok = await write(async () => {
    res = await api('POST', '/api/import/commit', { account: $('impAcc').value, items });
    // если в текущем месяце ничего не добавилось — показываем последний месяц из импорта
    const months = items.filter((i) => i.action === 'import').map((i) => periodOf(i.date, S.periodStart)).sort();
    if (months.length && !months.includes(S.month)) S.month = months.at(-1);
    await loadExp(); render();
  });
  if (ok) { toast(`Импортировано ${res.imported}${res.skipped ? `, скрыто ${res.skipped}` : ''}`); closeImport(); } else updateImportBtn();
};

/* ---------- вход ---------- */
function showLogin() { $('appView').hidden = true; $('loginView').hidden = false; $('pw').focus(); }
function showApp(passwordRequired) { $('loginView').hidden = true; $('appView').hidden = false; $('logout').hidden = !passwordRequired; }
$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault(); $('loginErr').textContent = '';
  try { await api('POST', '/api/login', { password: $('pw').value }); $('pw').value = ''; showApp(true); loadAll(); }
  catch (err) { $('loginErr').textContent = err.message || 'Не удалось войти'; }
});
$('logout').onclick = async () => { await api('POST', '/api/logout').catch(() => {}); S.rec = []; S.exp = []; S.cat = null; S.loaded = false; closeImport(); showLogin(); };

/* ---------- старт ---------- */
fillSelect($('rCat'), CATS, 'Жильё'); fillSelect($('eCat'), CATS, 'Продукты');
fillSelect($('rAcc'), ACCS, 'Bank of Cyprus'); fillSelect($('eAcc'), ACCS, 'Revolut'); fillSelect($('impAcc'), ACCS, 'Revolut');
$('eDate').value = today();
(async () => {
  try {
    const me = await api('GET', '/api/me');
    if (!me.authed) { showLogin(); return; }
    showApp(me.passwordRequired); render(); loadAll();
  } catch { showApp(false); const b = $('banner'); b.hidden = false; b.textContent = 'Сервер недоступен.'; }
})();
