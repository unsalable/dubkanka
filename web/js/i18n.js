// Two languages: Turkish, the language the interface is written in, and English. Strings stay Turkish in the code and
// are looked up in the English catalog by that very text (like gettext), so a missing entry still reads as Turkish
// instead of a key. `{name}` marks a value; an English entry can be [one, other] for a count passed as `n`.
import { EN } from './lang/en.js';

export const LANGS = [['tr', 'Türkçe'], ['en', 'English']];
const valid = (l) => (l === 'tr' || l === 'en' ? l : null);

/** Turkish on a Turkish system, English everywhere else (a first start, a friend's browser). */
export const systemLang = () => ((navigator.language || '').toLowerCase().startsWith('tr') ? 'tr' : 'en');

// read here, not through util.js: util.js itself translates and imports this module
function stored() {
  try {
    return valid(JSON.parse(localStorage.getItem('dk.lang')));
  } catch {
    return null;
  }
}

let lang = stored() || systemLang();
document.documentElement.lang = lang;

export const getLang = () => lang;
export const hasStoredLang = () => !!stored();
/** Locale for dates and numbers. */
export const locale = () => (lang === 'en' ? 'en-GB' : 'tr-TR');

export function setLang(l) {
  lang = valid(l) || 'tr';
  document.documentElement.lang = lang;
  try {
    localStorage.setItem('dk.lang', JSON.stringify(lang));
  } catch {}
}

/** A key can carry a context, "rec|Kaydet": one Turkish word with two English ones (Kaydet is both "save" and
 *  "record"). Turkish shows the text without it. */
const bare = (s) => {
  const i = s.indexOf('|');
  return i > 0 && i < 8 ? s.slice(i + 1) : s;
};

export function t(s, vars) {
  let out = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, s) ? EN[s] : bare(s);
  if (Array.isArray(out)) out = out[vars && Number(vars.n) === 1 ? 0 : 1];
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : out;
}
