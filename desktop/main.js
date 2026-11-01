// DubKanka desktop: a window around the local studio server. First run installs the runtime, later starts go straight
// to the studio; updates come from GitHub Releases.
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, screen, session, shell } = require('electron');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}
app.setAppUserModelId('com.unsalable.dubkanka');

const P = require('./lib/paths');
const i18n = require('./lib/i18n');
const runtime = require('./lib/runtime');
const updater = require('./lib/updater');
const { Server, freePort } = require('./lib/server');

const BG = '#0f0f0e';
const server = new Server();
let win = null;
let booting = false;
let quitting = false;
let lastSetup = [];

const isLocal = (url) => /^http:\/\/(127\.0\.0\.1|localhost):\d+(\/|$)/.test(url || '') || (url || '').startsWith('file://');

// ---------------------------------------------------------------- window
function loadBounds() {
  try {
    const b = JSON.parse(fs.readFileSync(P.WINDOW, 'utf8'));
    const area = screen.getDisplayMatching(b).workArea;
    if (b.x >= area.x - 50 && b.y >= area.y - 50 && b.x < area.x + area.width - 100 && b.y < area.y + area.height - 100) return b;
  } catch {}
  return { width: 1440, height: 900 };
}

function saveBounds() {
  if (!win || win.isDestroyed()) return;
  try {
    fs.mkdirSync(P.HOME, { recursive: true });
    fs.writeFileSync(P.WINDOW, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {}
}

function createWindow() {
  const b = loadBounds();
  win = new BrowserWindow({
    ...b, minWidth: 1024, minHeight: 640, show: false, backgroundColor: BG, title: 'DubKanka',
    icon: path.join(__dirname, 'build', 'icon.ico'),
    titleBarStyle: 'hidden', titleBarOverlay: { color: BG, symbolColor: '#b4b1a7', height: 48 },
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  if (b.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  win.on('close', saveBounds);
  win.on('closed', () => (win = null));
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !isLocal(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (isLocal(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = input.key.toLowerCase();
    if (input.key === 'F12' || (input.control && input.shift && k === 'i')) win.webContents.toggleDevTools();
    else if (input.control && !input.shift && k === 'r') win.webContents.reload();
  });
  win.loadFile(path.join(__dirname, 'setup', 'index.html'));
}

function send(ev) {
  if (ev.type === 'plan') lastSetup = [];
  lastSetup.push(ev);
  if (lastSetup.length > 400) lastSetup.splice(1, lastSetup.length - 400);
  if (win && !win.isDestroyed() && win.webContents.getURL().startsWith('file://')) win.webContents.send('dk:setup', ev);
}

// ---------------------------------------------------------------- permissions: the studio may use the microphone
function setupSession() {
  const allowed = new Set(['media', 'clipboard-sanitized-write', 'fullscreen']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => {
    const okOrigin = isLocal(details.requestingUrl || wc.getURL());
    const audioOnly = permission !== 'media' || !(details.mediaTypes || []).includes('video');
    cb(okOrigin && allowed.has(permission) && audioOnly);
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => isLocal(origin) && allowed.has(permission));
}

// ---------------------------------------------------------------- boot
async function boot() {
  if (booting) return;
  booting = true;
  try {
    send({ type: 'phase', phase: 'starting' });
    updater.init(() => {
      quitting = true;
      server.stop();
    });
    // every launch asks for a new version first; when there is one it is installed and the app reopens on it
    if (await updater.onLaunch(send)) return;
    send({ type: 'phase', phase: 'starting' });
    const python = process.env.DUBKANKA_PYTHON || (await runtime.ensure(send));
    send({ type: 'phase', phase: 'server' });
    const port = await freePort(8765);
    server.start(python, port);
    await server.waitReady();
    if (!win) return;
    await win.loadURL(`http://127.0.0.1:${port}/`);
    updater.watch();
  } catch (e) {
    send({ type: 'error', message: e.message, tail: (e.tail || server.tail || []).slice(-40) });
  } finally {
    booting = false;
  }
}

// the server died under a running studio: show the setup page with the log instead of a dead window
server.onExit((code) => {
  // while booting the setup page is still up and boot() reports the failure itself
  if (quitting || !win || win.isDestroyed() || !win.webContents.getURL().startsWith('http')) return;
  const tail = server.tail.slice(-40);
  win.loadFile(path.join(__dirname, 'setup', 'index.html')).then(() =>
    send({ type: 'error', message: i18n.t('DubKanka sunucusu kapandı (kod {code}).', { code }), tail }));
});

// ---------------------------------------------------------------- bridge
ipcMain.on('dk:version', (e) => (e.returnValue = app.getVersion()));
// the studio's language: the start screen asks for it, the studio sets it when the user picks another one
ipcMain.on('dk:lang', (e) => (e.returnValue = i18n.get()));
ipcMain.handle('dk:lang:set', (_e, l) => i18n.setLang(l));
ipcMain.handle('dk:setup:replay', () => lastSetup);
ipcMain.handle('dk:setup:retry', () => {
  server.stop();
  boot();
});
ipcMain.handle('dk:setup:logs', () => shell.openPath(P.LOGS));
ipcMain.handle('dk:setup:quit', () => app.quit());
ipcMain.handle('dk:update:get', () => updater.getState());
ipcMain.handle('dk:update:check', () => updater.check());
ipcMain.handle('dk:update:download', () => updater.download());
ipcMain.handle('dk:update:install', () => updater.install());
ipcMain.handle('dk:update:skip', () => updater.skip());
ipcMain.handle('dk:update:prefs', (_e, p) => (p ? updater.setPrefs(p) : updater.getPrefs()));
updater.onState((s) => win && !win.isDestroyed() && win.webContents.send('dk:update', s));
ipcMain.handle('dk:open-external', (_e, url) => /^https?:\/\//i.test(String(url)) && shell.openExternal(String(url)));
ipcMain.handle('dk:show-item', (_e, p) => p && shell.showItemInFolder(String(p)));
ipcMain.handle('dk:pick-folder', async (_e, o = {}) => {
  const r = await dialog.showOpenDialog(win, { title: o.title || i18n.t('Klasör seç'), defaultPath: o.defaultPath, properties: ['openDirectory', 'createDirectory'] });
  return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
});
ipcMain.handle('dk:relaunch', () => {
  quitting = true;
  server.stop();
  app.relaunch();
  app.exit(0);
});
ipcMain.handle('dk:titlebar', (_e, o) => win && win.setTitleBarOverlay({ color: o.color || BG, symbolColor: o.symbolColor || '#b4b1a7', height: 48 }));
ipcMain.handle('dk:runtime:info', () => runtime.info());
ipcMain.handle('dk:runtime:repair', () => {
  runtime.resetForRepair();
  quitting = true;
  server.stop();
  app.relaunch();
  app.exit(0);
});

// ---------------------------------------------------------------- lifecycle
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  setupSession();
  createWindow();
  win.webContents.once('did-finish-load', boot);
});
app.on('before-quit', () => {
  quitting = true;
  saveBounds();
  server.stop();
});
app.on('window-all-closed', () => app.quit());
