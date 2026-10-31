// The only bridge between the page and the desktop: what the studio (window.dkDesktop) and the setup screen
// (window.dkSetup) may ask for. No Node in the page.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  const f = (_e, v) => cb(v);
  ipcRenderer.on(channel, f);
  return () => ipcRenderer.removeListener(channel, f);
};
const call = (channel) => (arg) => ipcRenderer.invoke(channel, arg);

contextBridge.exposeInMainWorld('dkDesktop', {
  isDesktop: true,
  version: ipcRenderer.sendSync('dk:version'),
  platform: process.platform,
  updates: {
    getState: call('dk:update:get'),
    onState: (cb) => on('dk:update', cb),
    check: call('dk:update:check'),
    download: call('dk:update:download'),
    install: call('dk:update:install'),
    getPrefs: () => ipcRenderer.invoke('dk:update:prefs'),
    setPrefs: (p) => ipcRenderer.invoke('dk:update:prefs', p),
  },
  openExternal: call('dk:open-external'),
  showItemInFolder: call('dk:show-item'),
  pickFolder: call('dk:pick-folder'),
  relaunch: call('dk:relaunch'),
  setTitleBarOverlay: call('dk:titlebar'),
  runtime: { getInfo: call('dk:runtime:info'), repair: call('dk:runtime:repair') },
});

contextBridge.exposeInMainWorld('dkSetup', {
  onEvent: (cb) => on('dk:setup', cb),
  replay: call('dk:setup:replay'),
  retry: call('dk:setup:retry'),
  skipUpdate: call('dk:update:skip'),
  openLogs: call('dk:setup:logs'),
  quit: call('dk:setup:quit'),
});
