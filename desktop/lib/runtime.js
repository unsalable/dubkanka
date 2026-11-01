// The runtime the studio needs on this PC: Python, the studio's own packages and ffmpeg (about 200 MB). Installed on
// first run, topped up after updates (only what changed), every step resumable. The AI features (speech to text, voice
// separation with PyTorch, the room tool, recording cleanup) are not part of it: the studio adds them when someone
// picks them (dubkanka/features.py), and this file only brings installed ones to new pins after an update.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, net } = require('electron');
const P = require('./paths');
const { t } = require('./i18n');

const PYTHON = '3.14';
const FFMPEG_URLS = [
  'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
];

// labels in Turkish, translated when the plan goes to the setup screen
const STEPS = [
  { id: 'python', label: 'Python 3.14', size: '30 MB', weight: 3 },
  { id: 'packages', label: 'Stüdyo', size: '80 MB', weight: 6 },
  { id: 'ffmpeg', label: 'Video araçları (ffmpeg)', size: '100 MB', weight: 6 },
];

const exists = (f) => fs.existsSync(f);
const readState = () => {
  try {
    return JSON.parse(fs.readFileSync(P.STATE, 'utf8'));
  } catch {
    return {};
  }
};
function writeState(s) {
  fs.mkdirSync(P.RUNTIME, { recursive: true });
  fs.writeFileSync(P.STATE + '.tmp', JSON.stringify(s, null, 2));
  fs.renameSync(P.STATE + '.tmp', P.STATE);
}
const CORE = () => path.join(P.APP_DIR, 'requirements-core.txt');
const LOCK = () => path.join(P.APP_DIR, 'requirements.lock');
const lockHash = () => crypto.createHash('sha256').update(fs.readFileSync(LOCK())).update(fs.readFileSync(CORE())).digest('hex').slice(0, 16);

/** Environment of every Python process: data folders, tools on PATH, UTF-8 output. */
function pythonEnv() {
  return {
    ...process.env,
    DUBKANKA_HOME: P.HOME, DUBKANKA_BIN: P.BIN, DUBKANKA_MODELS: P.MODELS, DUBKANKA_EXPORTS: P.exportsDir(),
    DUBKANKA_DESKTOP: '1', DUBKANKA_VERSION: app.getVersion(), DUBKANKA_UV: P.UV, DUBKANKA_UV_CACHE: P.UV_CACHE,
    PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', HF_HUB_DISABLE_SYMLINKS_WARNING: '1',
    PATH: `${P.BIN};${process.env.PATH || ''}`,
  };
}

const uvEnv = () => ({
  ...process.env, UV_PYTHON_INSTALL_DIR: P.PYTHON_DIR, UV_CACHE_DIR: P.UV_CACHE, UV_PYTHON_PREFERENCE: 'only-managed',
  UV_HTTP_TIMEOUT: '600', UV_NO_PROGRESS: '1', NO_COLOR: '1',
});

/** What still has to be done (empty when everything is in place and current). */
function pending(s = readState()) {
  const out = [];
  if (!exists(P.VENV_PY) || s.python !== PYTHON) out.push('python');
  if (s.lockHash !== lockHash() || out.includes('python')) out.push('packages');
  if (!exists(path.join(P.BIN, 'ffmpeg.exe')) || !exists(path.join(P.BIN, 'ffprobe.exe'))) out.push('ffmpeg');
  return out;
}

function run(cmd, args, { env, cwd, onLine, onChild } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, cwd, windowsHide: true });
    onChild && onChild(child);
    const tail = [];
    const feed = (buf) => {
      for (const line of buf.toString('utf8').split(/\r?\n|\r/)) {
        const l = line.trim();
        if (!l) continue;
        tail.push(l);
        if (tail.length > 30) tail.shift();
        onLine && onLine(l);
      }
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve(tail);
      else {
        const e = new Error(tail.slice(-6).join('\n') || t('{exe} çıkış kodu {code}', { exe: path.basename(cmd), code: code ?? signal }));
        e.tail = tail;
        e.killed = signal != null;
        reject(e);
      }
    });
  });
}

function freeBytes(dir) {
  try {
    const st = fs.statfsSync(path.parse(dir).root);
    return st.bavail * st.bsize;
  } catch {
    return null;
  }
}

async function download(url, dest, onBytes) {
  const res = await net.fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(t('İndirilemedi (HTTP {status}): {url}', { status: res.status, url }));
  const total = Number(res.headers.get('content-length')) || 0;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const file = fs.createWriteStream(dest);
  const reader = res.body.getReader();
  let got = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!file.write(Buffer.from(value))) await new Promise((r) => file.once('drain', r));
      onBytes && onBytes(got, total);
    }
  } finally {
    await new Promise((r) => file.end(r));
  }
  if (total && got < total) throw new Error(t('İndirme yarıda kesildi, internet bağlantını kontrol et.'));
}

function findFile(dir, name, depth = 3) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isFile() && e.name.toLowerCase() === name) return f;
    if (e.isDirectory() && depth > 0) {
      const r = findFile(f, name, depth - 1);
      if (r) return r;
    }
  }
  return null;
}

const mb = (b) => (b / 2 ** 20).toFixed(0);

/**
 * Bring the runtime up to date. emit({type: 'plan' | 'step' | 'progress' | 'log', ...}) drives the setup screen.
 * Returns the venv's python.exe.
 */
async function ensure(emit) {
  const state = readState();
  const todo = pending(state);
  if (!todo.length) return P.VENV_PY;
  const firstRun = !exists(P.VENV_PY);
  const steps = STEPS.map((s) => ({ ...s, label: t(s.label), state: todo.includes(s.id) ? 'pending' : 'done' }));
  emit({ type: 'plan', firstRun, steps });
  fs.mkdirSync(P.BIN, { recursive: true });
  const free = freeBytes(P.HOME);
  if (firstRun && free != null && free < 2 * 2 ** 30)
    emit({ type: 'log', line: t('Uyarı: diskte {mb} MB boş yer var, stüdyo yaklaşık 1 GB ister.', { mb: mb(free) }), warn: true });

  const total = steps.filter((s) => s.state === 'pending').reduce((a, s) => a + s.weight, 0) || 1;
  let base = 0;
  const progress = (step, f, detail) => emit({ type: 'progress', id: step.id, fraction: Math.max(0, Math.min(1, f)), overall: (base + step.weight * Math.max(0, Math.min(1, f))) / total, detail });
  const log = (line) => emit({ type: 'log', line });

  for (const step of steps) {
    if (step.state !== 'pending') continue;
    emit({ type: 'step', id: step.id, state: 'running' });
    try {
      if (step.id === 'python') {
        progress(step, 0.1, `uv python install ${PYTHON}`);
        await run(P.UV, ['python', 'install', PYTHON], { env: uvEnv(), onLine: log });
        progress(step, 0.7, 'uv venv');
        await run(P.UV, ['venv', P.VENV, '--python', PYTHON, '--clear'], { env: uvEnv(), onLine: log });
        state.python = PYTHON;
      } else if (step.id === 'packages') {
        progress(step, 0.05, 'uv pip install -r requirements-core.txt');
        let n = 0;
        await run(P.UV, ['pip', 'install', '--python', P.VENV_PY, '-r', CORE(), '-c', LOCK()], {
          env: uvEnv(),
          onLine: (l) => {
            log(l);
            if (/^(Downloading|Downloaded|Installed|Prepared|\+)/.test(l)) progress(step, Math.min(0.8, 0.05 + ++n / 60), l);
          },
        });
        // features the studio added (speech, separation...) follow new pins after an update, and come back after a
        // repair rebuilt Python; on a first run there are none and this takes a second
        await run(P.VENV_PY, ['-m', 'dubkanka.features', 'refresh', '--json'], {
          cwd: P.APP_DIR, env: pythonEnv(),
          onLine: (l) => {
            if (!l.startsWith('{')) return log(l);
            try {
              const m = JSON.parse(l);
              progress(step, 0.8 + 0.2 * m.progress, m.message);
            } catch {
              log(l);
            }
          },
        });
        state.lockHash = lockHash();
      } else if (step.id === 'ffmpeg') {
        const zip = path.join(P.BIN, 'ffmpeg.zip.part');
        let lastErr = null;
        for (const url of FFMPEG_URLS) {
          try {
            await download(url, zip, (got, all) => progress(step, all ? (got / all) * 0.85 : 0.4, `${mb(got)}${all ? ' / ' + mb(all) : ''} MB`));
            lastErr = null;
            break;
          } catch (e) {
            lastErr = e;
            log(`${url}: ${e.message}`);
          }
        }
        if (lastErr) throw lastErr;
        const tmp = path.join(P.BIN, 'ffmpeg-unpack');
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.mkdirSync(tmp, { recursive: true });
        progress(step, 0.9, t('Arşiv açılıyor'));
        await run(P.TAR, ['-xf', zip, '-C', tmp]);
        for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
          const f = findFile(tmp, exe);
          if (!f) throw new Error(t('{exe} arşivde bulunamadı.', { exe }));
          fs.copyFileSync(f, path.join(P.BIN, exe));
        }
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(zip, { force: true });
        await run(path.join(P.BIN, 'ffmpeg.exe'), ['-hide_banner', '-version']);
      }
      writeState(state);
      base += step.weight;
      emit({ type: 'step', id: step.id, state: 'done' });
    } catch (e) {
      emit({ type: 'step', id: step.id, state: 'error' });
      const err = new Error(`${step.label}: ${friendly(e)}`);
      err.tail = e.tail;
      throw err;
    }
  }
  return P.VENV_PY;
}

function friendly(e) {
  const m = String((e && e.message) || e);
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ERR_INTERNET|ERR_NAME|network|dns|timed out/i.test(m)) return t('İnternet bağlantısı yok ya da çok yavaş. Bağlantını kontrol edip tekrar dene.');
  if (/ENOSPC|not enough space|No space/i.test(m)) return t('Diskte yer kalmadı.');
  return m.split('\n').slice(-3).join(' ').slice(0, 400);
}

/** Forget what was installed so the next start checks and repairs everything (projects, features and models stay). */
function resetForRepair() {
  writeState({});
}

function info() {
  const s = readState();
  return { home: P.HOME, python: s.python || null, ffmpeg: path.join(P.BIN, 'ffmpeg.exe'), logs: P.LOGS };
}

module.exports = { ensure, pending, pythonEnv, resetForRepair, info, STEPS };
