import { locale, t } from './i18n.js';

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const db2gain = (db) => Math.pow(10, (db || 0) / 20);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const cls = (...a) => a.filter(Boolean).join(' ');

export function fmtTime(secs, decimals = 1) {
  if (secs == null || isNaN(secs)) return '--:--';
  const neg = secs < 0;
  secs = Math.abs(secs);
  const m = Math.floor(secs / 60);
  const s = secs - m * 60;
  const ss = decimals ? s.toFixed(decimals).padStart(3 + decimals, '0') : String(Math.floor(s)).padStart(2, '0');
  return (neg ? '-' : '') + String(m).padStart(2, '0') + ':' + ss;
}

export function parseTime(str) {
  const parts = String(str).trim().replace(',', '.').split(':');
  if (!parts.length || parts.length > 3) return null;
  let secs = 0;
  for (const p of parts) {
    const n = Number(p);
    if (p === '' || isNaN(n)) return null;
    secs = secs * 60 + n;
  }
  return secs;
}

export function fmtBytes(n) {
  if (!n) return '0 MB';
  if (n > 2 ** 30) return (n / 2 ** 30).toFixed(1) + ' GB';
  return (n / 2 ** 20).toFixed(n > 100 * 2 ** 20 ? 0 : 1) + ' MB';
}

/** A download size given in MB: "60 MB", "1.7 GB". */
export function fmtSize(mb) {
  if (!mb) return '0 MB';
  return mb >= 1000 ? (mb / 1024).toFixed(1).replace(/\.0$/, '') + ' GB' : Math.round(mb) + ' MB';
}

export function timeAgo(ts) {
  const d = Date.now() / 1000 - ts;
  if (d < 60) return t('az önce');
  if (d < 3600) return t('{n} dk önce', { n: Math.floor(d / 60) });
  if (d < 86400) return t('{n} saat önce', { n: Math.floor(d / 3600) });
  return new Date(ts * 1000).toLocaleDateString(locale());
}

export function debounce(fn, ms) {
  let timer;
  const d = (...a) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...a), ms);
  };
  d.flush = (...a) => {
    clearTimeout(timer);
    fn(...a);
  };
  return d;
}

const VOWELS = /[aeiouyıöüâîûéèêàáíóúäëï]+/gi;
export function syllables(text) {
  let n = 0;
  for (const w of String(text || '').toLowerCase().split(/\s+/)) {
    if (!/[a-zçğıöşüâîû]/i.test(w)) continue;
    const m = w.match(VOWELS);
    let k = m ? m.length : 1;
    if (k > 1 && /[^aeiouy]e$/.test(w) && /^[a-z]+$/.test(w)) k -= 1; // silent English e
    n += Math.max(1, k);
  }
  return n;
}

export function selectedTake(line) {
  if (!line || !line.take) return null;
  return (line.takes || []).find((x) => x.id === line.take) || null;
}

export function readyTake(line) {
  const take = selectedTake(line);
  return take && take.status === 'ready' && take.file ? take : null;
}

export function encodeWav(samples, sampleRate) {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, n * 2, true);
  let o = 44;
  for (let i = 0; i < n; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

const peakCache = new WeakMap();
export const PEAK_RATE = 200;
/** Max-abs envelope of an AudioBuffer at PEAK_RATE values per second (cached). */
export function peaksOf(buffer) {
  if (!buffer) return null;
  let p = peakCache.get(buffer);
  if (p) return p;
  const step = buffer.sampleRate / PEAK_RATE;
  const n = Math.ceil(buffer.length / step);
  p = new Float32Array(n);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step);
      const b = Math.min(d.length, Math.floor((i + 1) * step));
      let m = p[i];
      for (let j = a; j < b; j += 2) {
        const x = d[j] < 0 ? -d[j] : d[j];
        if (x > m) m = x;
      }
      p[i] = m;
    }
  }
  peakCache.set(buffer, p);
  return p;
}

/** Draw a waveform of `buffer` for project-time window [t0, t1] where the buffer starts at `at`. */
export function drawWave(canvas, buffer, at, t0, t1, color, gain = 1) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const peaks = peaksOf(buffer);
  if (!peaks || t1 <= t0) return;
  ctx.fillStyle = color;
  const mid = H / 2;
  const spp = (t1 - t0) / W;
  for (let x = 0; x < W; x++) {
    const a = Math.floor((t0 + x * spp - at) * PEAK_RATE);
    const b = Math.max(a + 1, Math.floor((t0 + (x + 1) * spp - at) * PEAK_RATE));
    if (b <= 0 || a >= peaks.length) continue;
    let m = 0;
    for (let i = Math.max(0, a); i < Math.min(peaks.length, b); i++) if (peaks[i] > m) m = peaks[i];
    const h = Math.max(1, Math.min(1, Math.sqrt(m * gain)) * (H * 0.48));
    ctx.fillRect(x, mid - h, 1, h * 2);
  }
}

/** Bring `el` into view inside its own scrolling list. Unlike scrollIntoView, the page and the panes around the list
 *  never move. */
export function revealInList(el, smooth = true) {
  if (!el) return;
  let box = el.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  if (!box) return;
  const b = box.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  const d = r.top < b.top + 6 ? r.top - b.top - 6 : r.bottom > b.bottom - 6 ? r.bottom - b.bottom + 6 : 0;
  if (d) box.scrollBy({ top: d, behavior: smooth && document.documentElement.dataset.motion !== 'off' ? 'smooth' : 'auto' });
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

export const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem('dk.' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('dk.' + k, JSON.stringify(v));
    } catch {}
  },
};
