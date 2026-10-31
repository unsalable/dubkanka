// The Python server behind the window: started on a free local port, logged to a file, stopped with its whole
// process tree (ffmpeg, cloudflared) when the app quits.
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const P = require('./paths');
const { pythonEnv } = require('./runtime');

function isFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

async function freePort(from = 8765) {
  for (let p = from; p < from + 100; p++) if (await isFree(p)) return p;
  throw new Error('Boş bir port bulunamadı.');
}

function openLog() {
  fs.mkdirSync(P.LOGS, { recursive: true });
  const f = path.join(P.LOGS, 'server.log');
  try {
    if (fs.existsSync(f)) fs.renameSync(f, path.join(P.LOGS, 'server.1.log'));
  } catch {}
  return fs.createWriteStream(f, { flags: 'a' });
}

class Server {
  constructor() {
    this.child = null;
    this.tail = [];
    this.exitHandlers = new Set();
  }
  start(python, port) {
    const log = openLog();
    log.write(`--- ${new Date().toISOString()} python=${python} port=${port}\n`);
    this.port = port;
    this.tail = [];
    const child = spawn(python, ['-m', 'dubkanka', '--no-browser', '--port', String(port), '--parent-pid', String(process.pid)],
      { cwd: P.APP_DIR, env: pythonEnv(), windowsHide: true });
    const feed = (buf) => {
      log.write(buf);
      for (const l of buf.toString('utf8').split(/\r?\n/)) if (l.trim()) this.tail = [...this.tail.slice(-60), l];
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('exit', (code) => {
      log.end(`--- exit ${code}\n`);
      if (this.child === child) {
        this.child = null;
        for (const f of this.exitHandlers) f(code);
      }
    });
    this.child = child;
    return child;
  }
  onExit(fn) {
    this.exitHandlers.add(fn);
    return () => this.exitHandlers.delete(fn);
  }
  async waitReady(timeoutMs = 150000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (!this.child) throw Object.assign(new Error('Sunucu başlarken kapandı.'), { tail: this.tail });
      try {
        const r = await fetch(`http://127.0.0.1:${this.port}/api/ping`);
        if (r.ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 400));
    }
    throw Object.assign(new Error('Sunucu zamanında açılmadı.'), { tail: this.tail });
  }
  stop() {
    const c = this.child;
    this.child = null;
    if (c && c.pid) spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { windowsHide: true });
  }
}

module.exports = { Server, freePort };
