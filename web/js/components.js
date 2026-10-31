import { html, useEffect, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { player } from './engine.js';
import { recorder } from './recorder.js';
import { dismissToast, useStore } from './state.js';
import { clamp, cls, fmtTime } from './util.js';

const ICONS = {
  play: '<path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z" fill="currentColor" stroke="none"/>',
  pause: '<rect x="6.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none"/>',
  rec: '<circle cx="12" cy="12" r="7" fill="currentColor" stroke="none"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21m-3.5 0h7"/>',
  prev: '<path d="M18 5.5 9 12l9 6.5zM6 5v14"/>',
  next: '<path d="m6 5.5 9 6.5-9 6.5zM18 5v14"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7m-8 0 .9 12.1a1 1 0 0 0 1 .9h7.2a1 1 0 0 0 1-.9L17.5 7"/>',
  cut: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8.2 8.5 20 18M8.2 15.5 20 6"/>',
  merge: '<path d="M7 4v6a5 5 0 0 0 5 5h0a5 5 0 0 1 5 5M17 4v4M7 20v-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6"/>',
  download: '<path d="M12 4v11m-5-5 5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9m-5 5 5-5 5 5M5 4h14"/>',
  folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  wand: '<path d="m4 20 11-11m2-5 .8 1.7L19.5 6.5l-1.7.8L17 9l-.8-1.7L14.5 6.5l1.7-.8zM9 3l.5 1L10.5 4.5 9.5 5 9 6l-.5-1L7.5 4.5l1-.5z"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4m10 0h4M3 15h4m10 0h4"/>',
  music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  sliders: '<path d="M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="14" width="4" height="7" rx="1.5"/><rect x="17" y="14" width="4" height="7" rx="1.5"/>',
  text: '<path d="M5 6V4h14v2M12 4v16m-3 0h6"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  repeat: '<path d="M4 12a8 8 0 0 1 14-5.3L20 9m0-5v5h-5M20 12a8 8 0 0 1-14 5.3L4 15m0 5v-5h5"/>',
  share: '<path d="M12 15V3.5m-4.5 4L12 3l4.5 4.5M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6"/>',
  zoomin: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8M10.5 7.5v6m-3-3h6"/>',
  zoomout: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.8-4.8M7.5 10.5h6"/>',
  fit: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/>',
  dots: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  alert: '<path d="M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0zM12 10v4m0 3v.5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.5v.5"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
  leaf: '<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19c3-4 6-7 10-9"/>',
};

export function Icon({ name, size = 18, class: c }) {
  return html`<svg class=${cls('icon', c)} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
    dangerouslySetInnerHTML=${{ __html: ICONS[name] || '' }}></svg>`;
}

export function Btn({ icon, children, onClick, kind = '', disabled, title, type = 'button', small, class: c, active }) {
  return html`<button type=${type} class=${cls('btn', kind && kind.split(' ').map((k) => (k === 'big' ? k : 'btn-' + k)).join(' '), small && 'btn-sm', active && 'active', c)}
    onClick=${onClick} disabled=${disabled} title=${title}>
    ${icon && html`<${Icon} name=${icon} size=${small ? 14 : 16} />`}${children && html`<span>${children}</span>`}
  </button>`;
}

const TOAST_ICON = { error: 'alert', ok: 'check', info: 'info' };

export function Toasts() {
  const s = useStore();
  return html`<div class="toasts" role="status" aria-live="polite">${s.toasts.map(
    (t) => html`<div key=${t.id} class=${cls('toast', 'toast-' + t.type, t.leaving && 'leaving')} onClick=${() => dismissToast(t.id)}>
      <${Icon} name=${TOAST_ICON[t.type] || 'info'} size=${16} /><span class="grow">${t.text}</span>
      <i class="toast-life" style=${{ animationDuration: t.ms + 'ms' }}></i>
    </div>`
  )}</div>`;
}

let modalSeq = 0;
export function Modal({ title, onClose, children, wide }) {
  const id = useRef('m' + ++modalSeq).current;
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return html`<div class="modal-bg" onMouseDown=${(e) => e.target === e.currentTarget && onClose && onClose()}>
    <div class=${cls('modal', wide && 'modal-wide')} role="dialog" aria-modal="true" aria-labelledby=${id}>
      <div class="modal-head"><h3 id=${id}>${title}</h3>${onClose && html`<button class="iconbtn" title="Kapat" onClick=${onClose}><${Icon} name="x" /></button>`}</div>
      <div class="modal-body">${children}</div>
    </div>
  </div>`;
}

export function Progress({ value, indeterminate, live }) {
  return html`<div class=${cls('progress', indeterminate && 'indeterminate', live && 'live')} role="progressbar"
    aria-valuemin="0" aria-valuemax="100" aria-valuenow=${indeterminate ? undefined : Math.round(clamp(value || 0, 0, 1) * 100)}>
    <div style=${indeterminate ? null : { transform: `scaleX(${clamp(value || 0, 0, 1)})` }}></div></div>`;
}

const STEP_ICON = {
  done: '<path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
  error: '<path d="M12 6v7m0 4.5v.5" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/>',
};

export function JobPanel({ job, onCancel, bare }) {
  if (!job) return null;
  const running = job.status === 'running' || job.status === 'queued';
  const pct = Math.round((job.progress || 0) * 100);
  return html`<div class=${cls(!bare && 'jobpanel', job.status === 'error' && 'is-error')}>
    <div class="jobpanel-top">
      <strong>${job.title}</strong>
      <span class="jobpanel-pct">${running ? pct + '%' : job.status === 'done' ? 'Bitti' : job.status === 'error' ? 'Hata' : 'İptal'}</span>
    </div>
    ${running && html`<${Progress} value=${job.progress} live />`}
    ${job.steps && job.steps.length > 0 && html`<ol class="steps">${job.steps.map(
      (s) => html`<li key=${s.key} class=${'step step-' + s.status}>
        <span class="step-ico">${STEP_ICON[s.status] && html`<svg viewBox="0 0 24 24" dangerouslySetInnerHTML=${{ __html: STEP_ICON[s.status] }}></svg>`}</span>${s.label}</li>`
    )}</ol>`}
    <div class="jobpanel-msg">${job.error ? job.error : job.message}</div>
    ${running && onCancel && html`<${Btn} small kind="ghost" onClick=${onCancel}>İptal</${Btn}>`}
  </div>`;
}

export function Field({ label, hint, children, class: c }) {
  return html`<label class=${cls('field', c)}><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}</label>`;
}

export function Select({ value, options, onChange, disabled, class: c }) {
  return html`<select class=${cls('input', c)} value=${value} disabled=${disabled} onChange=${(e) => onChange(e.target.value)}>
    ${options.map(([v, l]) => html`<option value=${v} selected=${String(v) === String(value)}>${l}</option>`)}
  </select>`;
}

export function Toggle({ checked, onChange, label, disabled }) {
  return html`<label class=${cls('toggle', disabled && 'disabled')}>
    <input type="checkbox" checked=${!!checked} disabled=${disabled} onChange=${(e) => onChange(e.target.checked)} />
    <span class="toggle-ui"></span><span>${label}</span>
  </label>`;
}

const pctOf = (v, min, max) => clamp(((Number(v) - min) / (max - min)) * 100, 0, 100) + '%';

/** Range input whose track fills up to the thumb. */
export function Range({ value, min = 0, max = 1, step = 0.01, onInput, onChange, title }) {
  return html`<input type="range" min=${min} max=${max} step=${step} value=${value} title=${title} style=${{ '--p': pctOf(value, min, max) }}
    onInput=${(e) => { e.target.style.setProperty('--p', pctOf(e.target.value, min, max)); onInput && onInput(Number(e.target.value)); }}
    onChange=${(e) => onChange && onChange(Number(e.target.value))} />`;
}

/** dB slider that reports live while dragging and commits on release. */
export function GainSlider({ value, onInput, onCommit, min = -24, max = 12, step = 0.5, label }) {
  const [v, setV] = useState(value || 0);
  const dragging = useRef(false);
  useEffect(() => {
    if (!dragging.current) setV(value || 0);
  }, [value]);
  return html`<div class="gain" title="Ses seviyesi (dB) · çift tık: 0 dB">
    ${label && html`<span class="gain-label">${label}</span>`}
    <input type="range" min=${min} max=${max} step=${step} value=${v} style=${{ '--p': pctOf(v, min, max) }}
      onPointerDown=${() => (dragging.current = true)}
      onInput=${(e) => { const x = Number(e.target.value); setV(x); onInput && onInput(x); }}
      onChange=${(e) => { dragging.current = false; onCommit && onCommit(Number(e.target.value)); }}
      onDblClick=${() => { setV(0); onInput && onInput(0); onCommit && onCommit(0); }} />
    <span class="gain-val">${v > 0 ? '+' : ''}${Number(v).toFixed(1)} dB</span>
  </div>`;
}

/** Slide an indicator under the active child of a container (tabs, segmented controls). */
export function useIndicator(box, ind, selector, deps) {
  useLayoutEffect(() => {
    const place = () => {
      const b = box.current;
      const i = ind.current;
      const a = b && b.querySelector(selector);
      if (!i) return;
      if (!a) {
        i.style.opacity = '0';
        return;
      }
      i.style.opacity = '1';
      i.style.width = a.offsetWidth + 'px';
      i.style.transform = `translateX(${a.offsetLeft}px)`;
      // first placement without animation, every later move glides
      if (!i.classList.contains('ready')) requestAnimationFrame(() => i.classList.add('ready'));
    };
    place();
    const ro = new ResizeObserver(place);
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, deps);
}

export function Segmented({ value, options, onChange }) {
  const box = useRef(null);
  const ind = useRef(null);
  useIndicator(box, ind, 'button.on', [value]);
  return html`<div class="segmented" ref=${box} role="tablist">
    <i class="seg-ind" ref=${ind}></i>
    ${options.map(([v, label]) => html`<button key=${v} role="tab" aria-selected=${v === value} class=${cls(v === value && 'on')} onClick=${() => onChange(v)}>${label}</button>`)}
  </div>`;
}

/** Video element registered as the player's picture. */
export function VideoPane({ src, poster, class: c, children, onReady }) {
  const ref = useRef(null);
  useEffect(() => {
    player.attachVideo(ref.current);
    return () => {
      if (player.video === ref.current) {
        player.stop();
        player.attachVideo(null);
      }
    };
  }, []);
  return html`<div class=${cls('videopane', c)}>
    <video ref=${ref} src=${src} poster=${poster} muted playsinline preload="auto" onLoadedMetadata=${(e) => onReady && onReady(e.target)}></video>
    ${children}
  </div>`;
}

export function PlayButton({ playing, onClick, disabled, title = 'Oynat / durdur (Boşluk)' }) {
  return html`<button class="playbtn" onClick=${onClick} disabled=${disabled} title=${title} aria-label=${playing ? 'Durdur' : 'Oynat'}>
    <${Icon} name=${playing ? 'pause' : 'play'} size=${16} /></button>`;
}

/** Current player time, refreshed ~15x per second without re-rendering the parent. */
export function TimeReadout({ duration }) {
  const ref = useRef(null);
  useEffect(() => {
    let last = 0;
    const upd = (type) => {
      const now = performance.now();
      if (type === 'tick' && now - last < 60) return;
      last = now;
      if (ref.current) ref.current.textContent = fmtTime(Math.max(0, player.time));
    };
    upd();
    return player.on(upd);
  }, [duration]);
  return html`<span class="timereadout"><span ref=${ref}></span>${duration ? html`<span class="dur"> / ${fmtTime(duration)}</span>` : ''}</span>`;
}

export function usePlaying() {
  const [p, setP] = useState(player.playing);
  useEffect(() => player.on(() => setP(player.playing)), []);
  return p;
}

export function LevelMeter() {
  const ref = useRef(null);
  useEffect(
    () =>
      recorder.onLevel((peak) => {
        if (!ref.current) return;
        const db = 20 * Math.log10(Math.max(peak, 1e-5));
        ref.current.style.transform = `scaleX(${clamp((db + 60) / 60, 0, 1)})`;
      }),
    []
  );
  return html`<div class="meter" title="Mikrofon seviyesi"><div ref=${ref}></div></div>`;
}

// One animation loop drives every bus meter on screen: fast attack, slow fall, idle when silent.
const meters = new Set();
let meterRaf = 0;
function meterLoop() {
  let alive = player.playing;
  for (const m of meters) {
    const target = player.playing ? player.level(m.bus) : 0;
    m.v = target > m.v ? target : m.v * 0.9;
    if (m.v > 0.004) alive = true;
    if (m.el) m.el.style.transform = m.h ? `scaleX(${m.v})` : `scaleY(${m.v})`;
  }
  meterRaf = alive && meters.size ? requestAnimationFrame(meterLoop) : 0;
}
player.on((type) => type === 'play' && !meterRaf && meters.size && (meterRaf = requestAnimationFrame(meterLoop)));

export function BusMeter({ bus, horizontal = true, title = 'Seviye' }) {
  const ref = useRef(null);
  useEffect(() => {
    const m = { bus, el: ref.current, v: 0, h: horizontal };
    meters.add(m);
    if (player.playing && !meterRaf) meterRaf = requestAnimationFrame(meterLoop);
    return () => meters.delete(m);
  }, [bus]);
  return html`<span class=${cls('vu', horizontal && 'h')} title=${title}><i ref=${ref}></i></span>`;
}

export function Empty({ icon = 'film', title, children }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${32} /><h3>${title}</h3><div>${children}</div></div>`;
}

export function CharDot({ color, size = 10 }) {
  return html`<span class="chardot" style=${{ background: color, width: size + 'px', height: size + 'px' }}></span>`;
}

export function Swatch({ color }) {
  return html`<span class="swatch" style=${{ '--c': color }}></span>`;
}

export function Kbd({ children }) {
  return html`<kbd>${children}</kbd>`;
}
