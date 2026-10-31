// Web Audio playback synced to a muted <video>. The mix rules mirror dubkanka/mixer.py.
import { fileUrl } from './api.js';
import { clamp, db2gain, readyTake } from './util.js';

export const engine = {
  ctx: null,
  master: null,
  cache: new Map(),
  ensure() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.masterTap = tap(this.ctx, this.master);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  },
  load(url) {
    if (!url) return Promise.resolve(null);
    if (!this.cache.has(url)) {
      const p = fetch(url, { credentials: 'same-origin' })
        .then((r) => {
          if (!r.ok) throw new Error('Ses dosyası yüklenemedi');
          return r.arrayBuffer();
        })
        .then((b) => new Promise((res, rej) => this.ensure().decodeAudioData(b, res, rej)));
      p.catch(() => this.cache.delete(url));
      this.cache.set(url, p);
    }
    return this.cache.get(url);
  },
  get outLatency() {
    const c = this.ctx;
    return c ? c.outputLatency || c.baseLatency || 0 : 0;
  },
};

/** A level meter tap: an analyser fed by `node`, connected nowhere else. */
function tap(ctx, node) {
  const a = ctx.createAnalyser();
  a.fftSize = 1024;
  a.smoothingTimeConstant = 0;
  node.connect(a);
  return a;
}

const levelBuf = new Float32Array(1024);
/** Loudness of an analyser right now, 0 (-54 dB or less) to 1 (0 dBFS). */
function levelOf(a) {
  if (!a) return 0;
  a.getFloatTimeDomainData(levelBuf);
  let s = 0;
  for (let i = 0; i < levelBuf.length; i++) s += levelBuf[i] * levelBuf[i];
  const db = 20 * Math.log10(Math.sqrt(s / levelBuf.length) + 1e-9);
  return clamp((db + 54) / 54, 0, 1);
}

/** Stems of a project. Guests get small mono previews to save their data plan; their `bg` already holds the
 *  ambience. `voices` is the original dialogue: the clean speech stem once ambience was split off. */
export function stemUrls(p, lite) {
  const s = p.stems;
  if (!s) return {};
  return {
    bg: fileUrl(p.id, lite ? s.bedLite || s.backgroundLite : s.background, s.ver),
    amb: lite || !s.ambience ? null : fileUrl(p.id, s.ambience, s.ver),
    voices: fileUrl(p.id, lite ? s.speechLite || s.voicesLite : s.speech || s.voices, s.ver),
    original: lite ? null : fileUrl(p.id, s.original, s.ver),
  };
}
export const takeUrl = (p, t) => (t && t.file ? fileUrl(p.id, t.file) : null);
export const sfxUrl = (p, s) => fileUrl(p.id, s.file);

export async function loadMixBuffers(p, { lite = false, original = false } = {}) {
  const u = stemUrls(p, lite);
  const out = { takes: {}, sfx: {} };
  const jobs = [
    engine.load(u.bg).then((b) => (out.bg = b)),
    engine.load(u.amb).then((b) => (out.amb = b)),
    engine.load(u.voices).then((b) => (out.voices = b)),
  ];
  if (original && u.original) jobs.push(engine.load(u.original).then((b) => (out.original = b)));
  for (const line of p.lines) {
    const t = readyTake(line);
    if (t) jobs.push(engine.load(takeUrl(p, t)).then((b) => (out.takes[t.id] = b)).catch(() => {}));
  }
  for (const s of p.mix.sfx || []) jobs.push(engine.load(sfxUrl(p, s)).then((b) => (out.sfx[s.id] = b)).catch(() => {}));
  await Promise.all(jobs);
  return out;
}

export const FILL_PRE = 0.15;
export const FILL_POST = 0.25;

/** The final dub mix as playable items (same rules as the server render). */
export function buildMix(p, bufs, mode = 'dub') {
  const items = [];
  if (mode === 'original') {
    if (bufs.original) items.push({ buffer: bufs.original, at: 0, bus: 'original' });
    else {
      items.push({ buffer: bufs.bg, at: 0, bus: 'bg' });
      items.push({ buffer: bufs.amb, at: 0, bus: 'amb' });
      items.push({ buffer: bufs.voices, at: 0, bus: 'orig' });
    }
    return { items, buses: {} };
  }
  const mix = p.mix;
  const chars = Object.fromEntries(p.characters.map((c) => [c.id, c]));
  const buses = {
    bg: mix.bgMute ? 0 : db2gain(mix.bgGain),
    amb: mix.ambMute ? 0 : db2gain(mix.ambGain || 0),
    orig: mix.origMute ? 0 : db2gain(mix.origGain),
    fill: mix.fillMute ? 0 : db2gain(mix.fillGain),
    sfx: 1,
  };
  items.push({ buffer: bufs.bg, at: 0, bus: 'bg' });
  items.push({ buffer: bufs.amb, at: 0, bus: 'amb' });
  if (!mix.origMute) items.push({ buffer: bufs.voices, at: 0, bus: 'orig' });
  const windows = [];
  for (const line of p.lines) {
    const t = readyTake(line);
    const c = chars[line.char] || {};
    const bus = 'char:' + line.char;
    if (!(bus in buses)) buses[bus] = c.mute || mix.dubMute ? 0 : db2gain((c.gain || 0) + (mix.dubGain || 0));
    if (t && bufs.takes[t.id]) {
      const at = t.start + (t.nudge || 0);
      windows.push([at, at + t.duration]);
      items.push({ buffer: bufs.takes[t.id], at, gain: db2gain(t.gain || 0), bus, fade: 0.003 });
    } else if (mix.fillMissing !== false) {
      items.push({ buffer: bufs.voices, at: 0, region: [line.start - FILL_PRE, line.end + FILL_POST], fade: 0.03, bus: 'fill' });
    }
  }
  for (const s of mix.sfx || []) {
    if (!s.mute && bufs.sfx[s.id]) items.push({ buffer: bufs.sfx[s.id], at: s.start, gain: db2gain(s.gain || 0), bus: 'sfx' });
  }
  return { items, buses, duck: mix.duck > 0 && windows.length ? { buses: ['bg', 'amb'], windows, depthDb: mix.duck } : null };
}

function duckCurve(windows, depthDb, from, to) {
  const rate = 100;
  const n = Math.max(2, Math.ceil((to - from) * rate));
  const m = new Float32Array(n);
  for (const [s, e] of windows) {
    const a = Math.max(0, Math.floor((s - 0.05 - from) * rate));
    const b = Math.min(n, Math.floor((e + 0.1 - from) * rate));
    for (let i = a; i < b; i++) m[i] = 1;
  }
  const floor = db2gain(-depthDb);
  let level = 0;
  for (let i = 0; i < n; i++) {
    level += (m[i] - level) * (m[i] > level ? 0.5 : 0.12);
    m[i] = 1 - level * (1 - floor);
  }
  return m;
}

/** One global transport. Times are project seconds (can start negative for a pre-roll). */
class Player {
  constructor() {
    this.playing = false;
    this.pausedAt = 0;
    this.nodes = [];
    this.buses = {};
    this.taps = {};
    this.listeners = new Set();
    this.video = null;
    this.raf = 0;
    this.lastTick = 0;
    this.tick = () => this.step(false);
  }
  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(type) {
    for (const f of this.listeners) f(type, this);
  }
  get time() {
    if (!this.playing) return this.pausedAt;
    return Math.min(this.to, this.from + (engine.ctx.currentTime - this.t0) - engine.outLatency);
  }
  /** Context time at which project time `t` will be heard. */
  ctxTimeOf(t) {
    return this.t0 + (t - this.from);
  }
  attachVideo(v) {
    this.video = v;
  }
  play({ from, to, items = [], buses = {}, duck = null, beeps = [], video = this.video, onEnd = null, id = null }) {
    this.stop(false);
    const ctx = engine.ensure();
    this.video = video;
    this.id = id;
    this.from = from;
    this.to = to;
    this.onEnd = onEnd;
    this.t0 = ctx.currentTime + 0.1;
    this.buses = {};
    this.taps = {};
    this.nodes = [];
    const busNode = (name) => {
      if (!this.buses[name]) {
        const g = ctx.createGain();
        g.gain.value = name in buses ? buses[name] : 1;
        g.connect(engine.master);
        this.buses[name] = g;
        this.taps[name] = tap(ctx, g);
      }
      return this.buses[name];
    };
    for (const it of items) {
      if (!it || !it.buffer) continue;
      const b = it.buffer;
      const rs = Math.max(it.region ? it.region[0] : it.at, it.at);
      const re = Math.min(it.region ? it.region[1] : it.at + b.duration, it.at + b.duration);
      const s = Math.max(rs, from);
      const e = Math.min(re, to);
      if (e - s < 0.005) continue;
      const when = this.ctxTimeOf(s);
      const src = ctx.createBufferSource();
      src.buffer = b;
      const g = ctx.createGain();
      const gain = it.gain == null ? 1 : it.gain;
      const fade = it.fade || 0.004;
      if (s > rs + 0.001 || fade < 0.005) g.gain.setValueAtTime(gain, when);
      else {
        g.gain.setValueAtTime(0, when);
        g.gain.linearRampToValueAtTime(gain, when + fade);
      }
      if (e >= re - 0.001 && e - s > fade * 2) {
        g.gain.setValueAtTime(gain, this.ctxTimeOf(e) - fade);
        g.gain.linearRampToValueAtTime(0, this.ctxTimeOf(e));
      }
      src.connect(g);
      g.connect(busNode(it.bus || 'main'));
      src.start(Math.max(ctx.currentTime, when), s - it.at, e - s);
      this.nodes.push(src);
    }
    const curve = duck && duckCurve(duck.windows, duck.depthDb, from, to);
    for (const name of duck ? duck.buses || [duck.bus] : []) {
      const bus = this.buses[name];
      if (!bus) continue;
      // insert a dedicated node so live bus-gain changes keep working
      const duckGain = ctx.createGain();
      bus.disconnect();
      bus.connect(duckGain);
      duckGain.connect(engine.master);
      duckGain.connect(this.taps[name]); // the meter shows the bus after ducking
      duckGain.gain.setValueCurveAtTime(curve, this.t0, Math.max(0.05, to - from));
      this.nodes.push({ stop() {}, disconnect: () => duckGain.disconnect() });
    }
    for (const bt of beeps) {
      if (bt < from || bt > to) continue;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 1000;
      const w = this.ctxTimeOf(bt);
      g.gain.setValueAtTime(0, w);
      g.gain.linearRampToValueAtTime(0.25, w + 0.005);
      g.gain.setValueAtTime(0.25, w + 0.08);
      g.gain.linearRampToValueAtTime(0, w + 0.09);
      o.connect(g);
      g.connect(engine.master);
      o.start(w);
      o.stop(w + 0.1);
      this.nodes.push(o);
    }
    this.playing = true;
    if (this.video) {
      this.video.playbackRate = 1;
      try {
        this.video.currentTime = clamp(from, 0, this.video.duration || 1e9);
      } catch {}
      if (from >= 0) this.video.play().catch(() => {});
      else this.video.pause();
    }
    this.emit('play');
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.tick);
    // animation frames stop when the tab is hidden; keep end-of-take detection alive with a timer
    clearInterval(this.fallback);
    this.fallback = setInterval(() => performance.now() - this.lastTick > 300 && this.step(true), 250);
  }
  setBusGain(name, gain) {
    const b = this.buses[name];
    if (b && engine.ctx) b.gain.setTargetAtTime(gain, engine.ctx.currentTime, 0.02);
  }
  /** Current loudness of a bus ('master' = everything), 0..1, for meters. */
  level(name) {
    if (!this.playing) return 0;
    return levelOf(name === 'master' ? engine.masterTap : this.taps[name]);
  }
  step(fromTimer) {
    if (!this.playing) return;
    this.lastTick = performance.now();
    const now = this.time;
    const v = this.video;
    if (v && v.readyState >= 2) {
      const dur = v.duration || 0;
      if (now < 0) {
        if (!v.paused) v.pause();
        if (v.currentTime > 0.04) v.currentTime = 0;
      } else if (now < dur - 0.05) {
        if (v.paused) {
          v.currentTime = now;
          v.play().catch(() => {});
        } else {
          const drift = now - v.currentTime;
          if (Math.abs(drift) > 0.3) v.currentTime = now + 0.03;
          else if (Math.abs(drift) > 0.035) v.playbackRate = clamp(1 + drift * 1.5, 0.8, 1.25);
          else if (v.playbackRate !== 1) v.playbackRate = 1;
        }
      } else if (!v.paused) v.pause();
    }
    this.emit('tick');
    if (now >= this.to - 0.001) {
      this.stop(true);
      return;
    }
    if (!fromTimer) this.raf = requestAnimationFrame(this.tick);
  }
  stop(ended = false) {
    const wasPlaying = this.playing;
    if (wasPlaying) this.pausedAt = clamp(this.time, Math.min(0, this.from || 0), this.to);
    this.playing = false;
    cancelAnimationFrame(this.raf);
    clearInterval(this.fallback);
    for (const n of this.nodes) {
      try {
        n.stop();
      } catch {}
      try {
        n.disconnect && n.disconnect();
      } catch {}
    }
    this.nodes = [];
    for (const b of Object.values(this.buses)) {
      try {
        b.disconnect();
      } catch {}
    }
    this.buses = {};
    this.taps = {};
    if (this.video) {
      this.video.pause();
      this.video.playbackRate = 1;
    }
    if (wasPlaying) {
      const cb = this.onEnd;
      this.onEnd = null;
      this.emit(ended ? 'end' : 'stop');
      if (cb) cb(ended);
    }
  }
  seek(t) {
    this.stop(false);
    this.pausedAt = t;
    if (this.video) {
      try {
        this.video.currentTime = Math.max(0, t);
      } catch {}
    }
    this.emit('seek');
  }
}

export const player = new Player();
