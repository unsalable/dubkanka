// Auto-update from GitHub Releases (electron-updater reads latest.yml next to the setup exe). Every launch first asks
// whether a newer version is out; if so it downloads it (the setup screen shows the progress) and installs it silently,
// and the app opens again on the new version. Without internet, or after a few seconds of silence, the studio opens as
// usual and a later find is installed when the app quits. The page sees the state through the preload bridge.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const P = require('./paths');

const CHECK_TIMEOUT = 6000; // a launch never waits longer than this for the answer
let autoUpdater = null;
let state = { state: 'idle' };
let prefs = { auto: true };
let launched = false;
let skipLaunch = null;
const listeners = new Set();
// a failed download rejects the promise inside the check's result too: its error already went to the 'error' event
const quiet = (r) => {
  if (r && r.downloadPromise) r.downloadPromise.catch(() => {});
  return r;
};

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
  module.exports.beforeInstall = beforeInstall;
  if (autoUpdater) return;
  const feed = process.env.DUBKANKA_UPDATE_URL;
  if (!app.isPackaged && !feed) return set({ state: 'disabled' });
  ({ autoUpdater } = require('electron-updater'));
  if (feed) {
    autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    autoUpdater.forceDevUpdateConfig = !app.isPackaged; // a test feed works from source too
  }
  autoUpdater.logger = { info: (m) => log('info', m), warn: (m) => log('warn', m), error: (m) => log('error', m), debug: () => {} };
  autoUpdater.autoDownload = prefs.auto;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => set({ state: prefs.auto ? 'downloading' : 'available', version: i.version, progress: 0 }));
  autoUpdater.on('update-not-available', () => set({ state: 'none' }));
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: (p.percent || 0) / 100 }));
  autoUpdater.on('update-downloaded', (i) => set({ state: 'downloaded', version: i.version, progress: 1 }));
  autoUpdater.on('error', (e) => {
    log('error', e && e.stack);
    set({ state: 'error', error: /net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|EAI_AGAIN/.test(String(e)) ? 'İnternete ulaşılamadı' : String((e && e.message) || e).slice(0, 160) });
  });
}

/**
 * Run once per launch, before the studio starts: true when a new version is being installed (the app is about to quit
 * and reopen on it), false when the studio should open. emit() drives the setup screen.
 */
async function onLaunch(emit) {
  if (launched || !autoUpdater || !prefs.auto) return false;
  launched = true;
  emit({ type: 'phase', phase: 'update-check' });
  const answer = new Promise((resolve) => {
    const off = () => listeners.delete(seen);
    const seen = (s) => {
      if (['downloading', 'downloaded'].includes(s.state)) resolve(true);
      else if (['none', 'error', 'available'].includes(s.state)) resolve(false);
      else return;
      off();
    };
    listeners.add(seen);
    setTimeout(() => {
      off();
      resolve(false);
    }, CHECK_TIMEOUT);
  });
  autoUpdater.checkForUpdates().then(quiet).catch(() => {});
  if (!(await answer)) return false;

  // a new version is coming down: show it, install it as soon as it is here, or open the studio if asked to
  const done = await new Promise((resolve) => {
    const show = (s) => {
      if (s.state === 'downloading') emit({ type: 'update', version: s.version, progress: s.progress || 0 });
      else if (s.state === 'downloaded') finish(true);
      else if (s.state === 'error') finish(false);
    };
    const finish = (ok) => {
      listeners.delete(show);
      skipLaunch = null;
      resolve(ok);
    };
    skipLaunch = () => finish(false);
    listeners.add(show);
    show(state);
  });
  if (!done) return false; // skipped or failed: what did come down is installed when the app quits
  emit({ type: 'update', version: state.version, progress: 1, installing: true });
  log('info', `installing ${state.version} at launch`);
  setTimeout(install, 700);
  return true;
}

/** "Şimdilik atla" on the setup screen: open the studio, keep downloading in the background. */
function skip() {
  if (skipLaunch) skipLaunch();
}

/** While the studio is open, look again every few hours; a find downloads quietly and installs when the app quits. */
function watch() {
  if (!autoUpdater || watch.on) return;
  watch.on = true;
  if (!launched) setTimeout(check, 8000); // automatic updates are off: still say when there is one
  setInterval(check, 4 * 3600 * 1000);
}

function check() {
  if (!autoUpdater) return Promise.resolve(state);
  return autoUpdater.checkForUpdates().then((r) => (quiet(r), state), () => state);
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
  init, onLaunch, skip, watch, check, download, install, setPrefs,
  getState: () => state,
  getPrefs: () => prefs,
  onState: (f) => {
    listeners.add(f);
    return () => listeners.delete(f);
  },
};
