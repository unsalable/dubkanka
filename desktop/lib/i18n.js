// The shell's own words (its errors, the folder picker) in the studio's language: the one the studio last chose
// (lang.json, written when it changes), else Turkish for an install from before 1.4 (Turkish was the only language),
// else the system's. Strings are written in Turkish and looked up in EN like the studio does (web/js/i18n.js).
const fs = require('node:fs');
const { app } = require('electron');
const P = require('./paths');

const EN = {
  'Klasör seç': 'Choose a folder',
  'DubKanka sunucusu kapandı (kod {code}).': 'The DubKanka server stopped (code {code}).',
  'Stüdyo': 'Studio',
  'Video araçları (ffmpeg)': 'Video tools (ffmpeg)',
  '{exe} çıkış kodu {code}': '{exe} exit code {code}',
  'İndirilemedi (HTTP {status}): {url}': "Couldn't download (HTTP {status}): {url}",
  'İndirme yarıda kesildi, internet bağlantını kontrol et.': 'The download stopped halfway, check your internet connection.',
  'Uyarı: diskte {mb} MB boş yer var, stüdyo yaklaşık 1 GB ister.': 'Warning: {mb} MB free on the disk, the studio needs about 1 GB.',
  'Arşiv açılıyor': 'Unpacking the archive',
  '{exe} arşivde bulunamadı.': "{exe} wasn't found in the archive.",
  'İnternet bağlantısı yok ya da çok yavaş. Bağlantını kontrol edip tekrar dene.': 'No internet connection, or it is very slow. Check your connection and try again.',
  'Diskte yer kalmadı.': 'The disk is full.',
  'İnternete ulaşılamadı': "Couldn't reach the internet",
  'Boş bir port bulunamadı.': 'No free port was found.',
  'Sunucu başlarken kapandı.': 'The server stopped while starting.',
  'Sunucu zamanında açılmadı.': "The server didn't start in time.",
};

const valid = (l) => (l === 'tr' || l === 'en' ? l : null);
let cur = null;

function detect() {
  try {
    const l = valid(JSON.parse(fs.readFileSync(P.LANG, 'utf8')).lang);
    if (l) return l;
  } catch {}
  if (fs.existsSync(P.VENV_PY)) return 'tr';
  return (app.getLocale() || '').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

/** The language now ('tr' | 'en'); asked after the app is ready (the system locale is known only then). */
const get = () => cur || (cur = detect());

function setLang(l) {
  if (!valid(l)) return get();
  cur = l;
  try {
    fs.mkdirSync(P.HOME, { recursive: true });
    fs.writeFileSync(P.LANG, JSON.stringify({ lang: l }));
  } catch {}
  return cur;
}

function t(s, vars) {
  const out = get() === 'en' && Object.prototype.hasOwnProperty.call(EN, s) ? EN[s] : s;
  return vars ? out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : out;
}

module.exports = { t, get, setLang, EN };
