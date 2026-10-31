// Where everything lives. The app itself (Electron + the Python source) is replaced by every update; the runtime,
// tools, models and the user's projects live in %LOCALAPPDATA%\DubKanka and survive updates and reinstalls.
const path = require('node:path');
const { app } = require('electron');

const HOME = process.env.DUBKANKA_HOME_OVERRIDE || path.join(process.env.LOCALAPPDATA || app.getPath('appData'), 'DubKanka');
const RUNTIME = path.join(HOME, 'runtime');

module.exports = {
  HOME,
  RUNTIME,
  PYTHON_DIR: path.join(RUNTIME, 'python'),
  VENV: path.join(RUNTIME, 'venv'),
  VENV_PY: path.join(RUNTIME, 'venv', 'Scripts', 'python.exe'),
  UV_CACHE: path.join(RUNTIME, 'uv-cache'),
  STATE: path.join(RUNTIME, 'state.json'),
  BIN: path.join(HOME, 'bin'),
  MODELS: path.join(HOME, 'models'),
  LOGS: path.join(HOME, 'logs'),
  PREFS: path.join(HOME, 'desktop.json'),
  WINDOW: path.join(HOME, 'window.json'),
  // the Python package and the web UI: inside the installed app, or the repository when run with `npm start`
  APP_DIR: app.isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(__dirname, '..', '..'),
  UV: app.isPackaged ? path.join(process.resourcesPath, 'bin', 'uv.exe') : path.resolve(__dirname, '..', 'resources', 'uv.exe'),
  TAR: path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
  exportsDir: () => path.join(app.getPath('videos'), 'DubKanka'),
};
