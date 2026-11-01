import { html, render, useEffect, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { getVolume, onVolume, player, setVolume } from './engine.js';
import { t } from './i18n.js';
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
  wave: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
  leaf: '<path d="M5 19c0-8 5-13 15-14-1 10-6 15-14 15M5 19c3-4 6-7 10-9"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.3-4.9L4 8m0-5v5h5M4 13a8 8 0 0 0 14.3 4.9L20 16m0 5v-5h-5"/>',
  speaker: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  mute: '<path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/><path d="m16 9.5 5 5m0-5-5 5"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/>',
  cpu: '<rect x="6" y="6" width="12" height="12" rx="1.5"/><path d="M9.5 9.5h5v5h-5zM9 3v3m6-3v3M9 18v3m6-3v3M3 9h3m-3 6h3m12-6h3m-3 6h3"/>',
  globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 3.5 5.4 3.5 8.5s-1 5.9-3.5 8.5c-2.5-2.6-3.5-5.4-3.5-8.5s1-5.9 3.5-8.5z"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  chevdown: '<path d="m6 9 6 6 6-6"/>',
  help: '<path d="M9.2 9.3a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.5-2.8 4.2M12 18v.2"/>',
  lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  layers: '<path d="m12 3.5 8.5 4.5-8.5 4.5L3.5 8z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  translate: '<path d="M3.5 5.5h9M8 3.5v2c0 4-2.5 7-5 8.5M5.5 9.5c1 2 3 3.5 5.5 4.5"/><path d="m12.5 20.5 4-10 4 10M14 17h5"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4zM6 8h4m4 0h4"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  user: '<circle cx="12" cy="8" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>',
  trim: '<path d="M7 4v16M17 4v16M7 12h10M10 9l-3 3 3 3M14 9l3 3-3 3"/>',
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
    (n) => html`<div key=${n.id} class=${cls('toast', 'toast-' + n.type, n.leaving && 'leaving')} onClick=${() => dismissToast(n.id)}>
      <${Icon} name=${TOAST_ICON[n.type] || 'info'} size=${16} /><span class="grow">${n.text}</span>
      ${n.action && html`<button class="btn btn-sm toast-action" onClick=${(e) => { e.stopPropagation(); dismissToast(n.id); n.action.onClick(); }}>${n.action.label}</button>`}
      <i class="toast-life" style=${{ animationDuration: n.ms + 'ms' }}></i>
    </div>`
  )}</div>`;
}

/** The question of ask() (state.js): a card in the app, never a system window. Enter answers, Esc or a click outside
 *  cancels, and while it is open the screen's own shortcuts (Space records in the booth) stay quiet. */
export function Dialog() {
  const s = useStore();
  const d = s.dialog;
  const [val, setVal] = useState('');
  const okBtn = useRef(null);
  const noBtn = useRef(null);
  const field = useRef(null);
  const typed = d && d.input != null;
  const cancel = () => d && d.close(typed ? null : false);
  useEffect(() => {
    if (!d || d.leaving) return;
    const back = document.activeElement;
    setVal(d.input || '');
    // a destructive question starts on "Vazgeç": Enter alone never deletes anything
    requestAnimationFrame(() => {
      const el = typed ? field.current : d.danger ? noBtn.current : okBtn.current;
      if (el) {
        el.focus();
        if (typed) el.select();
      }
    });
    const key = (e) => {
      e.stopPropagation(); // the default actions (typing, Enter on the focused button) still happen
      if (e.key === 'Escape') {
        e.preventDefault();
        d.close(typed ? null : false);
      }
    };
    addEventListener('keydown', key, true);
    return () => {
      removeEventListener('keydown', key, true);
      if (back && back.isConnected && back.focus) back.focus({ preventScroll: true });
    };
  }, [d && d.close, d && d.leaving]);
  if (!d) return null;
  return html`<div class=${cls('dialog-bg', d.leaving && 'leaving')} onMouseDown=${(e) => e.target === e.currentTarget && cancel()}>
    <form class="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dk-dialog-title"
      onSubmit=${(e) => { e.preventDefault(); d.close(typed ? val : true); }}>
      <h3 id="dk-dialog-title">${d.title}</h3>
      ${d.text && html`<p>${d.text}</p>`}
      ${typed && html`<input ref=${field} class="input" value=${val} onInput=${(e) => setVal(e.target.value)} />`}
      <div class="dialog-actions">
        <button type="button" class="btn" ref=${noBtn} onClick=${cancel}>${d.cancel}</button>
        <button type="submit" ref=${okBtn} class=${cls('btn', d.danger ? 'btn-destroy' : 'btn-primary')}>${d.ok}</button>
      </div>
    </form>
  </div>`;
}

/** Renders children into a layer on <body>: menus and popovers are never clipped by a scrolling pane. */
export function Portal({ children }) {
  const host = useRef(null);
  if (!host.current) host.current = document.createElement('div');
  useLayoutEffect(() => {
    document.body.appendChild(host.current);
    return () => {
      render(null, host.current);
      host.current.remove();
    };
  }, []);
  useLayoutEffect(() => render(children, host.current));
  return null;
}

/** A menu anchored to an element; opens below it, or above when there is no room. Closes on outside click / Esc. */
export function Popover({ anchor, onClose, children, align = 'end', title, class: c, role = 'menu' }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const place = () => {
      const el = ref.current;
      if (!el || !anchor.isConnected) return onClose();
      const a = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const left = clamp(align === 'end' ? a.right - w : a.left, 8, innerWidth - w - 8);
      let top = a.bottom + 4;
      let from = 'top';
      if (top + h > innerHeight - 8 && a.top - 4 - h > 8) {
        top = a.top - 4 - h;
        from = 'bottom';
      } else top = Math.max(8, Math.min(top, innerHeight - h - 8));
      setPos({ left: left + 'px', top: top + 'px', transformOrigin: `${from} ${align === 'end' ? 'right' : 'left'}` });
    };
    place();
    const outside = (e) => ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target) && onClose();
    const key = (e) => e.key === 'Escape' && onClose();
    addEventListener('pointerdown', outside, true);
    addEventListener('keydown', key);
    addEventListener('resize', onClose);
    addEventListener('scroll', place, true);
    return () => {
      removeEventListener('pointerdown', outside, true);
      removeEventListener('keydown', key);
      removeEventListener('resize', onClose);
      removeEventListener('scroll', place, true);
    };
  }, [anchor]);
  return html`<${Portal}><div class=${cls('popover', c)} ref=${ref} role=${role} style=${pos || { left: '0px', top: '0px', visibility: 'hidden' }}>
    ${title && html`<div class="popover-title">${title}</div>`}${children}</div></${Portal}>`;
}

export function Lamp({ tone, title, children }) {
  return html`<span class=${cls('lamp', tone)} title=${title}>${children}</span>`;
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
      <div class="modal-head"><h3 id=${id}>${title}</h3>${onClose && html`<button class="iconbtn" title=${t('Kapat')} onClick=${onClose}><${Icon} name="x" /></button>`}</div>
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

/** A job with its steps on one rail: a finished step fills the rail down to the next one, which then starts to turn. */
export function JobPanel({ job, onCancel, bare }) {
  if (!job) return null;
  const running = job.status === 'running' || job.status === 'queued';
  const pct = Math.round((job.progress || 0) * 100);
  return html`<div class=${cls(!bare && 'jobpanel', job.status === 'error' && 'is-error')}>
    <div class="jobpanel-top">
      <strong>${job.title}</strong>
      <span class="jobpanel-pct">${running ? pct + '%' : job.status === 'done' ? t('Bitti') : job.status === 'error' ? t('Hata') : t('İptal')}</span>
    </div>
    ${running && html`<${Progress} value=${job.progress} live />`}
    ${job.steps && job.steps.length > 0 && html`<ol class="steps">${job.steps.map(
      (s) => html`<li key=${s.key} class=${'step step-' + s.status}>
        <span class="step-ico">${STEP_ICON[s.status] && html`<svg viewBox="0 0 24 24" dangerouslySetInnerHTML=${{ __html: STEP_ICON[s.status] }}></svg>`}</span>
        <span class="step-label">${s.label}</span></li>`
    )}</ol>`}
    <div class="jobpanel-msg">${job.error ? job.error : job.message}</div>
    ${running && onCancel && html`<${Btn} small kind="ghost" onClick=${onCancel}>${t('İptal')}</${Btn}>`}
  </div>`;
}

export function Field({ label, hint, children, class: c }) {
  return html`<label class=${cls('field', c)}><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint">${hint}</span>`}</label>`;
}

/** A choice from a list, drawn by the app: the system's own drop-down looked foreign next to everything else. The field
 *  shows the choice; the list opens under it (above when there is no room), the chosen row ticked and in view. Arrow
 *  keys, Home / End, Enter, Esc and typing the first letters work like a native list. onChange gets the value as text. */
export function Select({ value, options, onChange, disabled, class: c, title, label }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  const cur = options.find(([v]) => String(v) === String(value));
  const key = (e) => {
    if (open || disabled) return;
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation(); // Space opens the list here, it does not record in the booth
      setOpen(true);
    }
  };
  return html`<button type="button" ref=${btn} class=${cls('input select', open && 'open', !cur && 'empty', c)} disabled=${disabled}
      aria-haspopup="listbox" aria-expanded=${open} aria-label=${label} title=${title} onClick=${() => setOpen(!open)} onKeyDown=${key}>
      <span class="select-value">${cur ? cur[1] : ''}</span><${Icon} name="chevdown" size=${14} class="select-chev" /></button>
    ${open && html`<${Listbox} anchor=${btn.current} value=${value} options=${options} onClose=${() => setOpen(false)}
      onPick=${(v) => {
        setOpen(false);
        if (btn.current) btn.current.focus({ preventScroll: true });
        if (String(v) !== String(value)) onChange(String(v));
      }} />`}`;
}

/** The open list of a Select, in the top layer so a scrolling pane never cuts it. */
function Listbox({ anchor, value, options, onPick, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex(([v]) => String(v) === String(value))));
  const typed = useRef({ text: '', at: 0 });
  useLayoutEffect(() => {
    const place = () => {
      const el = ref.current;
      if (!el || !anchor || !anchor.isConnected) return onClose();
      const a = anchor.getBoundingClientRect();
      const w = Math.max(a.width, Math.min(el.scrollWidth + 2, 420));
      const h = Math.min(el.scrollHeight, 320);
      const left = clamp(a.left, 8, innerWidth - w - 8);
      const below = innerHeight - a.bottom - 10;
      const up = below < Math.min(h, 200) && a.top - 10 > below;
      const maxH = Math.max(120, Math.min(320, up ? a.top - 14 : below - 4));
      setPos({ left: left + 'px', width: w + 'px', maxHeight: maxH + 'px', transformOrigin: up ? 'bottom' : 'top',
        ...(up ? { bottom: innerHeight - a.top + 4 + 'px' } : { top: a.bottom + 4 + 'px' }) });
    };
    place();
    const outside = (e) => ref.current && !ref.current.contains(e.target) && !anchor.contains(e.target) && onClose();
    addEventListener('pointerdown', outside, true);
    addEventListener('resize', onClose);
    addEventListener('scroll', place, true);
    return () => {
      removeEventListener('pointerdown', outside, true);
      removeEventListener('resize', onClose);
      removeEventListener('scroll', place, true);
    };
  }, [anchor]);
  // the chosen row sits in the middle of the list when it opens; the active one stays in view while moving through it
  useLayoutEffect(() => {
    const el = ref.current;
    const row = el && el.children[active];
    if (!row || !pos) return;
    if (row.offsetTop < el.scrollTop) el.scrollTop = row.offsetTop - 4;
    else if (row.offsetTop + row.offsetHeight > el.scrollTop + el.clientHeight) el.scrollTop = row.offsetTop + row.offsetHeight - el.clientHeight + 4;
  }, [active]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !pos) return;
    const row = el.children[active];
    if (row) el.scrollTop = Math.max(0, row.offsetTop - (el.clientHeight - row.offsetHeight) / 2);
    el.focus({ preventScroll: true });
  }, [!!pos]);
  const key = (e) => {
    const n = options.length;
    e.stopPropagation(); // keys belong to the open list, never to the screen's shortcuts (Space, P, K...)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, n - 1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : n - 1);
    } else if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      setActive((i) => clamp(i + (e.key === 'PageDown' ? 8 : -8), 0, n - 1));
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (options[active]) onPick(options[active][0]);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      onClose();
      if (anchor) anchor.focus({ preventScroll: true });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // typing jumps to the first row that starts with what was typed
      const now = performance.now();
      const tp = typed.current;
      tp.text = (now - tp.at > 700 ? '' : tp.text) + e.key.toLocaleLowerCase();
      tp.at = now;
      const i = options.findIndex(([, l]) => String(l).toLocaleLowerCase().startsWith(tp.text));
      if (i >= 0) setActive(i);
    }
  };
  return html`<${Portal}><div class="popover listbox" ref=${ref} role="listbox" tabIndex="-1" onKeyDown=${key}
    style=${pos || { left: '0px', top: '0px', visibility: 'hidden' }}>
    ${options.map(([v, l], i) => {
      const on = String(v) === String(value);
      return html`<button type="button" key=${String(v)} role="option" aria-selected=${on} tabIndex="-1"
        class=${cls('popitem', 'listopt', on && 'on', i === active && 'active')} onPointerMove=${() => i !== active && setActive(i)}
        onClick=${() => onPick(v)}><span class="grow">${l}</span>${on && html`<${Icon} name="check" size=${14} />`}</button>`;
    })}
  </div></${Portal}>`;
}

/** A small "?" beside something locked or not obvious: says why, and can offer the way out (`action`: {label, onClick}).
 *  Opens on hover and stays open on a click; `open` / `onClose` let a parent open it too (a click on a locked choice). */
export function HelpTip({ title, children, action, open: openProp, onClose, class: c }) {
  const btn = useRef(null);
  const [own, setOwn] = useState(null); // null: closed, 'hover' or 'pin'
  const timer = useRef(0);
  const open = openProp || !!own;
  const close = () => {
    clearTimeout(timer.current);
    setOwn(null);
    if (onClose) onClose();
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  const enter = () => {
    clearTimeout(timer.current);
    if (!own) timer.current = setTimeout(() => setOwn((o) => o || 'hover'), 260);
  };
  const leave = () => {
    clearTimeout(timer.current);
    if (own === 'hover') timer.current = setTimeout(() => setOwn((o) => (o === 'hover' ? null : o)), 220);
  };
  return html`<button type="button" ref=${btn} class=${cls('helptip', open && 'on', c)} aria-label=${title || t('Neden?')} aria-expanded=${open}
      onClick=${(e) => { e.stopPropagation(); e.preventDefault(); own === 'pin' || openProp ? close() : setOwn('pin'); }}
      onPointerEnter=${(e) => e.pointerType !== 'touch' && enter()} onPointerLeave=${leave}><${Icon} name="help" size=${13} /></button>
    ${open && html`<${Popover} anchor=${btn.current} onClose=${close} class="helppop" role="dialog">
      <div onPointerEnter=${() => clearTimeout(timer.current)} onPointerLeave=${leave}>
        ${title && html`<div class="helppop-title">${title}</div>`}
        <div class="helppop-text">${children}</div>
        ${action && html`<button type="button" class="btn btn-sm helppop-act" onClick=${() => { close(); action.onClick(); }}>${action.label}</button>`}
      </div>
    </${Popover}>`}`;
}

/** Every `title` in the app shows as the app's own tooltip instead of the system's: after a short rest the text appears
 *  under the element (above when there is no room) and goes on the next move away, a press, a key or a scroll. */
export function installTooltips() {
  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  let cur = null;
  let timer = 0;
  let shown = false;
  // While the pointer is on an element its title is held here (the system tooltip must not see it) and given back
  // when the pointer leaves, so the page's own updates of the title (or its removal) stay in charge.
  const release = () => {
    if (!cur) return;
    const text = cur.dataset.dkTip;
    delete cur.dataset.dkTip;
    if (text && !cur.hasAttribute('title')) cur.setAttribute('title', text);
  };
  const hide = () => {
    clearTimeout(timer);
    release();
    cur = null;
    if (shown) {
      shown = false;
      tip.classList.remove('show');
    }
  };
  const show = (el) => {
    const text = el.dataset.dkTip;
    if (!text || !el.isConnected || el.closest('[disabled], .dragging')) return;
    tip.textContent = text;
    if (!tip.isConnected) document.body.appendChild(tip);
    const r = el.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const below = r.bottom + 8 + h < innerHeight - 6;
    tip.style.left = clamp(r.left + r.width / 2 - w / 2, 6, innerWidth - w - 6) + 'px';
    tip.style.top = (below ? r.bottom + 8 : Math.max(6, r.top - h - 8)) + 'px';
    tip.dataset.side = below ? 'below' : 'above';
    shown = true;
    tip.classList.remove('show');
    void tip.offsetWidth; // restart the fade for a new element
    tip.classList.add('show');
  };
  document.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const el = e.target instanceof Element ? e.target.closest('[title], [data-dk-tip]') : null;
    if (el === cur) return;
    const wasShown = shown;
    hide();
    if (!el) return;
    const raw = el.getAttribute('title') || '';
    el.removeAttribute('title');
    if (!raw.trim()) return;
    // the title was the name of an icon button: keep it for screen readers
    if (!el.hasAttribute('aria-label') && !el.textContent.trim()) el.setAttribute('aria-label', raw);
    el.dataset.dkTip = raw;
    cur = el;
    // from one tooltip straight to the next one: it shows at once, like a menu bar
    timer = setTimeout(() => cur === el && show(el), wasShown ? 60 : 550);
  });
  document.addEventListener('pointerout', (e) => {
    if (cur && !(e.relatedTarget instanceof Node && cur.contains(e.relatedTarget))) hide();
  });
  for (const ev of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(ev, hide, true);
  addEventListener('scroll', hide, true);
  addEventListener('blur', hide);
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
  return html`<div class="gain" title=${t('Ses seviyesi (dB) · çift tık: 0 dB')}>
    ${label && html`<span class="gain-label">${label}</span>`}
    <input type="range" min=${min} max=${max} step=${step} value=${v} style=${{ '--p': pctOf(v, min, max) }}
      onPointerDown=${() => (dragging.current = true)}
      onInput=${(e) => { const x = Number(e.target.value); setV(x); onInput && onInput(x); }}
      onChange=${(e) => { dragging.current = false; onCommit && onCommit(Number(e.target.value)); }}
      onDblClick=${() => { setV(0); onInput && onInput(0); onCommit && onCommit(0); }} />
    <span class="gain-val">${v > 0 ? '+' : ''}${Number(v).toFixed(1)} dB</span>
  </div>`;
}

/** Slide an indicator under the active child of a container (tabs, segmented controls; a vertical list with 'y'). */
export function useIndicator(box, ind, selector, deps, axis = 'x') {
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
      if (axis === 'y') {
        i.style.height = a.offsetHeight + 'px';
        i.style.transform = `translateY(${a.offsetTop}px)`;
      } else {
        i.style.width = a.offsetWidth + 'px';
        i.style.transform = `translateX(${a.offsetLeft}px)`;
      }
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
export function VideoPane({ src, poster, class: c, children, onReady, onClick, title }) {
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
  return html`<div class=${cls('videopane', c, onClick && 'clickable')} onClick=${onClick} title=${title}>
    <video ref=${ref} src=${src} poster=${poster} muted playsinline preload="auto" onLoadedMetadata=${(e) => onReady && onReady(e.target)}></video>
    ${children}
  </div>`;
}

/** Listening volume and mute, the same control next to every transport. It never changes the exported video. */
export function VolumeControl() {
  const [v, setV] = useState(getVolume);
  useEffect(() => onVolume(setV), []);
  const level = v.muted ? 0 : v.level;
  const toggle = () => setVolume(level === 0 ? { muted: false, level: v.level || 0.8 } : { muted: true });
  return html`<div class="vol" title=${level === 0 ? t('Ses kapalı') : t('Dinleme sesi %{n}', { n: Math.round(level * 100) })}>
    <button class="iconbtn sm" onClick=${toggle} aria-label=${level === 0 ? t('Sesi aç') : t('Sesi kapat')}>
      <${Icon} name=${level === 0 ? 'mute' : 'speaker'} size=${16} /></button>
    <input type="range" min="0" max="1" step="0.01" value=${level} style=${{ '--p': level * 100 + '%' }} aria-label=${t('Dinleme sesi')}
      onInput=${(e) => { const x = Number(e.target.value); e.target.style.setProperty('--p', x * 100 + '%'); setVolume({ level: x, muted: x === 0 }); }} />
  </div>`;
}

export function PlayButton({ playing, onClick, disabled, title }) {
  return html`<button class=${cls('playbtn', playing && 'on')} onClick=${onClick} disabled=${disabled} title=${title || t('Oynat / durdur (Boşluk)')}
    aria-label=${playing ? t('Durdur') : t('Oynat')}>
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

/** Microphone level as an LED bar: -60..0 dBFS, the peak holds for a second, the frame turns red on clipping. */
export function LevelMeter({ title }) {
  const ref = useRef(null);
  useEffect(() => {
    let hold = -60;
    let heldAt = 0;
    let clipT = 0;
    return recorder.onLevel((peak) => {
      const el = ref.current;
      if (!el) return;
      const db = 20 * Math.log10(Math.max(peak, 1e-5));
      el.firstChild.style.transform = `scaleX(${clamp((db + 60) / 60, 0, 1)})`;
      const now = performance.now();
      if (db >= hold || now - heldAt > 1000) {
        hold = db;
        heldAt = now;
      }
      const pk = el.lastChild;
      pk.style.opacity = hold > -58 ? '1' : '0';
      pk.style.transform = `translateX(${clamp((hold + 60) / 60, 0, 1) * (el.clientWidth - 3)}px)`;
      if (peak >= 0.995) {
        el.classList.add('clip');
        clearTimeout(clipT);
        clipT = setTimeout(() => el.classList.remove('clip'), 1500);
      }
    });
  }, []);
  return html`<div class="meter" ref=${ref} title=${title || t('Mikrofon seviyesi')}><div></div><i class="peak"></i></div>`;
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

export function BusMeter({ bus, horizontal = true, title }) {
  const ref = useRef(null);
  useEffect(() => {
    const m = { bus, el: ref.current, v: 0, h: horizontal };
    meters.add(m);
    if (player.playing && !meterRaf) meterRaf = requestAnimationFrame(meterLoop);
    return () => meters.delete(m);
  }, [bus]);
  return html`<span class=${cls('vu', horizontal && 'h')} title=${title || t('Seviye')}><i ref=${ref}></i></span>`;
}

export function Empty({ icon = 'film', title, children }) {
  return html`<div class="empty"><${Icon} name=${icon} size=${32} /><h3>${title}</h3><div>${children}</div></div>`;
}

export function Kbd({ children }) {
  return html`<kbd>${children}</kbd>`;
}
