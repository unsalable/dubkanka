// Auto-update from GitHub Releases (electron-updater reads latest.yml next to the setup exe). The page sees the state
// through the preload bridge; the install itself runs on quit or when the user presses "Yeniden başlat".
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const P = require('./paths');

let autoUpdater = null;
let state = { state: 'idle' };
let prefs = { auto: true };
const listeners = new Set();

try {
  prefs = { ...prefs, ...JSON.parse(fs.readFileSync(P.PREFS, 'utf8')) };
} catch {}

function set(patch) {
  state = { ...state, ...patch };
  if (patch.state && patch.state !== 'error') delete state.error;
  for (const f of listeners) f(state);
}

function log(...a) {
  try {
    fs.mkdirSync(P.LOGS, { recursive: true });
    fs.appendFileSync(path.join(P.LOGS, 'updater.log'), `${new Date().toISOString()} ${a.join(' ')}\n`);
  } catch {}
}

function init(beforeInstall) {
  const feed = process.env.DUBKANKA_UPDATE_URL;
  if (!app.isPackaged && !feed) return set({ state: 'disabled' });
  ({ autoUpdater } = require('electron-updater'));
  if (feed) autoUpdater.setFeedURL({ provider: 'generic', url: feed });
  autoUpdater.logger = { info: (m) => log('info', m), warn: (m) => log('warn', m), error: (m) => log('error', m), debug: () => {} };
  autoUpdater.autoDownload = prefs.auto;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => set({ state: prefs.auto ? 'downloading' : 'available', version: i.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: (p.percent || 0) / 100 }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'downloaded', version: i.version }));
  autoUpdater.on('error', (e) => {
    log('error', e && e.stack);
    set({ state: 'error', error: /net::|ENOTFOUND|ETIMEDOUT|ECONNRESET/.test(String(e)) ? 'İnternete ulaşılamadı' : String((e && e.message) || e).slice(0, 160) });
  });
  module.exports.beforeInstall = beforeInstall;
  setTimeout(check, 8000);
  setInterval(check, 4 * 3600 * 1000);
}

function check() {
  if (!autoUpdater) return Promise.resolve(state);
  return autoUpdater.checkForUpdates().then(() => state, () => state);
}

function download() {
  if (autoUpdater && state.state === 'available') {
    set({ state: 'downloading', progress: 0 });
    autoUpdater.downloadUpdate().catch(() => {});
  }
}

function install() {
  if (!autoUpdater || state.state !== 'downloaded') return;
  module.exports.beforeInstall && module.exports.beforeInstall();
  autoUpdater.quitAndInstall(true, true); // silent installer, start the new version right after
}

function setPrefs(p) {
  prefs = { ...prefs, ...p };
  try {
    fs.mkdirSync(P.HOME, { recursive: true });
    fs.writeFileSync(P.PREFS, JSON.stringify(prefs, null, 2));
  } catch {}
  if (autoUpdater) autoUpdater.autoDownload = prefs.auto;
  if (prefs.auto) download();
  return prefs;
}

module.exports = {
  init, check, download, install, setPrefs,
  getState: () => state,
  getPrefs: () => prefs,
  onState: (f) => {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
