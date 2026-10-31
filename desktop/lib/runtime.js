// The runtime DubKanka needs on this PC: Python, PyTorch for its GPU, the AI packages, ffmpeg, the room tool and the
// models. Installed on first run, topped up after updates (only what changed), every step resumable.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { app, net } = require('electron');
const P = require('./paths');

const PYTHON = '3.14';
const TORCH = '2.11.0';
const FFMPEG_URLS = [
  'https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip',
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip',
];
const CLOUDFLARED_URL = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';
const VARIANTS = { cu128: 'CUDA 12.8', cu126: 'CUDA 12.6', cpu: 'işlemci' };

const STEPS = [
  { id: 'python', label: 'Python 3.14', size: '35 MB', weight: 3 },
  { id: 'torch', label: 'PyTorch', size: '2.5 GB', weight: 40 },
  { id: 'packages', label: 'Yapay zeka paketleri', size: '700 MB', weight: 17 },
  { id: 'ffmpeg', label: 'ffmpeg', size: '115 MB', weight: 6 },
  { id: 'cloudflared', label: 'Oda bağlantı aracı (cloudflared)', size: '55 MB', weight: 3 },
  { id: 'models', label: 'Yapay zeka modelleri', size: '2 GB', weight: 31 },
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
const lockHash = () => crypto.createHash('sha256').update(fs.readFileSync(path.join(P.APP_DIR, 'requirements.lock'))).digest('hex').slice(0, 16);

/** Environment of every Python process: data folders, tools on PATH, UTF-8 output. */
function pythonEnv() {
  return {
    ...process.env,
    DUBKANKA_HOME: P.HOME, DUBKANKA_BIN: P.BIN, DUBKANKA_MODELS: P.MODELS, DUBKANKA_EXPORTS: P.exportsDir(),
    DUBKANKA_DESKTOP: '1', DUBKANKA_VERSION: app.getVersion(),
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
  if (!s.torch || s.torch.version !== TORCH || out.includes('python')) out.push('torch');
  if (s.lockHash !== lockHash() || out.includes('python')) out.push('packages');
  if (!exists(path.join(P.BIN, 'ffmpeg.exe')) || !exists(path.join(P.BIN, 'ffprobe.exe'))) out.push('ffmpeg');
  if (!exists(path.join(P.BIN, 'cloudflared.exe'))) out.push('cloudflared');
  if (!s.models && !s.modelsSkipped) out.push('models');
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
        const e = new Error(tail.slice(-6).join('\n') || `${path.basename(cmd)} çıkış kodu ${code ?? signal}`);
        e.tail = tail;
        e.killed = signal != null;
        reject(e);
      }
    });
  });
}

function detectGpu() {
  const forced = process.env.DUBKANKA_TORCH_VARIANT;
  if (forced && VARIANTS[forced]) return Promise.resolve({ variant: forced, name: 'elle seçildi' });
  return new Promise((resolve) => {
    execFile('nvidia-smi', ['--query-gpu=name,compute_cap', '--format=csv,noheader'], { windowsHide: true, timeout: 20000 }, (err, out) => {
      const line = !err && String(out).trim().split(/\r?\n/)[0];
      if (!line) return resolve({ variant: 'cpu', name: null });
      const [name, cc] = line.split(',').map((x) => x.trim());
      const v = parseFloat(cc);
      // CUDA 12.8 builds start at Turing (7.5); Maxwell/Pascal/Volta still run the CUDA 12.6 build
      resolve({ variant: v >= 7.5 ? 'cu128' : v >= 5.0 ? 'cu126' : 'cpu', name });
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
  if (!res.ok) throw new Error(`İndirilemedi (HTTP ${res.status}): ${url}`);
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
  if (total && got < total) throw new Error('İndirme yarıda kesildi, internet bağlantını kontrol et.');
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
 * Returns the venv's python.exe. control.skipModels() can cut the model download short (models then come on first use).
 */
async function ensure(emit, control = {}) {
  const state = readState();
  const todo = pending(state);
  if (!todo.length) return P.VENV_PY;
  const firstRun = !exists(P.VENV_PY);
  const steps = STEPS.map((s) => ({ ...s, state: todo.includes(s.id) ? 'pending' : 'done' }));
  emit({ type: 'plan', firstRun, steps });
  fs.mkdirSync(P.BIN, { recursive: true });
  const free = freeBytes(P.HOME);
  if (firstRun && free != null && free < 8 * 2 ** 30)
    emit({ type: 'log', line: `Uyarı: diskte ${mb(free)} MB boş yer var, kurulum yaklaşık 8 GB ister.`, warn: true });

  const total = steps.filter((s) => s.state === 'pending').reduce((a, s) => a + s.weight, 0) || 1;
  let base = 0;
  const progress = (step, f, detail) => emit({ type: 'progress', id: step.id, fraction: Math.max(0, Math.min(1, f)), overall: (base + step.weight * Math.max(0, Math.min(1, f))) / total, detail });
  const log = (line) => emit({ type: 'log', line });

  for (const step of steps) {
    if (step.state !== 'pending') continue;
    if (step.id === 'models' && control.skipped && control.skipped()) {
      emit({ type: 'step', id: step.id, state: 'skipped' });
      state.modelsSkipped = true;
      writeState(state);
      continue;
    }
    emit({ type: 'step', id: step.id, state: 'running' });
    try {
      if (step.id === 'python') {
        progress(step, 0.1, `uv python install ${PYTHON}`);
        await run(P.UV, ['python', 'install', PYTHON], { env: uvEnv(), onLine: log });
        progress(step, 0.7, 'uv venv');
        await run(P.UV, ['venv', P.VENV, '--python', PYTHON, '--clear'], { env: uvEnv(), onLine: log });
        state.python = PYTHON;
      } else if (step.id === 'torch') {
        const gpu = await detectGpu();
        const label = `PyTorch ${TORCH} · ${VARIANTS[gpu.variant]}${gpu.name && gpu.variant !== 'cpu' ? ` (${gpu.name})` : ''}`;
        emit({ type: 'step', id: step.id, state: 'running', label, size: gpu.variant === 'cpu' ? '250 MB' : '2.5 GB' });
        const expected = (gpu.variant === 'cpu' ? 0.9 : 5.2) * 2 ** 30; // installed size on disk
        const start = freeBytes(P.HOME);
        const timer = setInterval(() => {
          const now = freeBytes(P.HOME);
          if (start != null && now != null) progress(step, Math.min(0.97, (start - now) / expected), `${mb(Math.max(0, start - now))} MB yazıldı`);
        }, 1500);
        try {
          await run(P.UV, ['pip', 'install', '--python', P.VENV_PY, `torch==${TORCH}`, '--index-url', `https://download.pytorch.org/whl/${gpu.variant}`],
            { env: uvEnv(), onLine: log });
        } finally {
          clearInterval(timer);
        }
        state.torch = { version: TORCH, variant: gpu.variant, gpu: gpu.name };
      } else if (step.id === 'packages') {
        progress(step, 0.05, 'uv pip install -r requirements.lock');
        let n = 0;
        await run(P.UV, ['pip', 'install', '--python', P.VENV_PY, '-r', path.join(P.APP_DIR, 'requirements.lock')], {
          env: uvEnv(),
          onLine: (l) => {
            log(l);
            if (/^(Downloading|Downloaded|Installed|Prepared|\+)/.test(l)) progress(step, Math.min(0.95, 0.05 + ++n / 120), l);
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
        progress(step, 0.9, 'Arşiv açılıyor');
        await run(P.TAR, ['-xf', zip, '-C', tmp]);
        for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
          const f = findFile(tmp, exe);
          if (!f) throw new Error(`${exe} arşivde bulunamadı.`);
          fs.copyFileSync(f, path.join(P.BIN, exe));
        }
        fs.rmSync(tmp, { recursive: true, force: true });
        fs.rmSync(zip, { force: true });
        await run(path.join(P.BIN, 'ffmpeg.exe'), ['-hide_banner', '-version']);
      } else if (step.id === 'cloudflared') {
        const part = path.join(P.BIN, 'cloudflared.exe.part');
        await download(CLOUDFLARED_URL, part, (got, all) => progress(step, all ? got / all : 0.5, `${mb(got)}${all ? ' / ' + mb(all) : ''} MB`));
        fs.renameSync(part, path.join(P.BIN, 'cloudflared.exe'));
      } else if (step.id === 'models') {
        let child = null;
        const stop = control.onSkip ? control.onSkip(() => child && child.kill()) : null;
        try {
          await run(P.VENV_PY, ['-m', 'dubkanka.prefetch', '--json'], {
            cwd: P.APP_DIR, env: pythonEnv(), onChild: (c) => (child = c),
            onLine: (l) => {
              if (!l.startsWith('{')) return log(l);
              try {
                const m = JSON.parse(l);
                progress(step, m.progress, m.message);
              } catch {
                log(l);
              }
            },
          });
          state.models = true;
        } catch (e) {
          if (!(control.skipped && control.skipped())) throw e;
          state.modelsSkipped = true; // they download on first use instead
          emit({ type: 'step', id: step.id, state: 'skipped' });
          writeState(state);
          continue;
        } finally {
          stop && stop();
        }
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
  if (/ENOTFOUND|ECONNRESET|ETIMEDOUT|ERR_INTERNET|ERR_NAME|network|dns|timed out/i.test(m)) return 'İnternet bağlantısı yok ya da çok yavaş. Bağlantını kontrol edip tekrar dene.';
  if (/ENOSPC|not enough space|No space/i.test(m)) return 'Diskte yer kalmadı.';
  return m.split('\n').slice(-3).join(' ').slice(0, 400);
}

/** Forget what was installed so the next start checks and repairs everything (projects and models stay). */
function resetForRepair() {
  const s = readState();
  writeState({ models: s.models, modelsSkipped: s.modelsSkipped });
}

function info() {
  const s = readState();
  return { home: P.HOME, python: s.python || null, torch: s.torch ? `${s.torch.version} · ${VARIANTS[s.torch.variant] || s.torch.variant}` : null,
    gpu: s.torch && s.torch.gpu, ffmpeg: path.join(P.BIN, 'ffmpeg.exe'), logs: P.LOGS };
}

module.exports = { ensure, pending, pythonEnv, resetForRepair, info, STEPS };
