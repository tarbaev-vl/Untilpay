/* UI languages. A new language: a dictionary in ./locales (and in src/locales for server messages)
   + an entry in LOCALES below. */
import en from '/locales/en.js';
import ru from '/locales/ru.js';

// locale — for Intl formatting of numbers and dates; lowerMonths — month names are lowercase mid-sentence
const LOCALES = {
  en: { dict: en, locale: 'en-GB', label: 'EN' },
  ru: { dict: ru, locale: 'ru-RU', label: 'RU', lowerMonths: true },
};
const DEFAULT_LANG = 'en';
const COOKIE = 'lang';

export const LANGS = Object.entries(LOCALES).map(([id, l]) => ({ id, label: l.label }));

function detect() {
  const saved = document.cookie.match(/(?:^|;\s*)lang=([^;]+)/)?.[1];
  if (saved && LOCALES[saved]) return saved;
  const nav = (navigator.language || '').toLowerCase().split('-')[0];
  return LOCALES[nav] ? nav : DEFAULT_LANG;
}
// The server reads the same cookie to pick the language of error messages, the CSV export and AI advice
const save = (l) => { document.cookie = `${COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`; };

export const lang = detect();
save(lang);
const { dict, locale, lowerMonths } = LOCALES[lang];
export { locale };

export function setLang(l) {
  if (!LOCALES[l] || l === lang) return;
  save(l); window.location.reload();
}

const fill = (s, params) => s.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? '');
const lookup = (key) => dict[key] ?? LOCALES[DEFAULT_LANG].dict[key];

/** Text by key with {name} placeholders; falls back to the default language, then to the key itself */
export function t(key, params = {}) {
  const s = lookup(key);
  return typeof s === 'string' ? fill(s, params) : key;
}

const plurals = new Intl.PluralRules(locale);
/** Plural form by number: the entry is { one, few, many, other }, {n} is the number */
export function tn(key, n, params = {}) {
  const forms = lookup(key);
  if (!forms || typeof forms !== 'object') return key;
  return fill(forms[plurals.select(n)] ?? forms.other, { n, ...params });
}

/**
 * Display name of a stored value (category, account, income source). The database keeps the original
 * Russian values; a dictionary may translate them under `val.<value>`, custom values are shown as they are.
 */
export const label = (value) => dict[`val.${value}`] ?? value;

const monthFmt = new Intl.DateTimeFormat(locale, { month: 'long' });
/** 'YYYY-MM' -> "November 2026"; mid = inside a sentence */
export function monthLabel(month, mid = false) {
  const [y, m] = month.split('-').map(Number);
  const name = monthFmt.format(new Date(y, m - 1, 1));
  return `${mid && lowerMonths ? name.toLowerCase() : name[0].toUpperCase() + name.slice(1)} ${y}`;
}

/**
 * Translates static markup: data-i18n="key" sets the text,
 * data-i18n-attr="attr:key;attr2:key2" sets attributes (placeholder, aria-label…).
 */
export function applyDom(root = document) {
  document.documentElement.lang = lang;
  document.title = t('app.title');
  root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
  root.querySelectorAll('[data-i18n-attr]').forEach((e) => {
    e.dataset.i18nAttr.split(';').forEach((pair) => { const [attr, key] = pair.split(':'); e.setAttribute(attr.trim(), t(key.trim())); });
  });
}
