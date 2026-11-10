import en from './locales/en.js';
import ru from './locales/ru.js';

// A new language: a dictionary in ./locales (and in public/locales for the UI) + an entry in both maps below
export const LOCALES = { en, ru };
/** Language names as they are spelled in the LLM prompt */
export const LANGUAGE_NAMES = { en: 'English', ru: 'Russian' };
export const DEFAULT_LANG = 'en';

/** UI language picked in the browser: the client keeps it in the `lang` cookie */
export const langOf = (req) => {
  const l = req?.cookies?.lang;
  return typeof l === 'string' && Object.hasOwn(LOCALES, l) ? l : DEFAULT_LANG;
};

/** Message by key with {name} placeholders; falls back to the default language, then to the key itself */
export function t(lang, key, params = {}) {
  const s = LOCALES[lang]?.[key] ?? LOCALES[DEFAULT_LANG][key] ?? key;
  return typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (m, k) => params[k] ?? '') : s;
}
