// Features in the interface: a row per feature in Ayarlar → Özellikler, and a small inline offer wherever a screen
// would use a feature that is not downloaded yet ("Yazıya dökme ve çeviri · İndir 1.7 GB"), right where it is needed.
import { html, useRef, useState } from '../vendor/preact-htm.js';
import { api } from './api.js';
import { Btn, Icon, Popover, Progress } from './components.js';
import { desktop } from './desktop.js';
import { t } from './i18n.js';
import { ask, featureOf, installFeatures, setState, toast, toastError, useStore } from './state.js';
import { cls, fmtSize } from './util.js';

export const FEATURE_ICON = { speech: 'text', separate: 'music', room: 'users', cleanup: 'wave' };

async function act(id, action) {
  try {
    const r = await api.post(`/api/features/${id}/${action}`);
    setState((s) => ({ system: s.system && { ...s.system, features: r.features } }));
    return r;
  } catch (e) {
    toastError(e);
    return null;
  }
}

async function removeFeature(f) {
  if (!(await ask({ title: t('{name} kaldırılsın mı?', { name: f.name }), text: t('İndirilen dosyaları silinir. İstediğin zaman yeniden indirebilirsin.'), ok: t('Kaldır'), danger: true }))) return;
  const r = await act(f.id, 'remove');
  if (r && r.restart) toast(t('Kullanımda olduğu için uygulama yeniden başlayınca kaldırılacak.'), 'info', 7000);
}

/** Download progress of a running install, or the action that fits the feature's state. */
function FeatureAction({ f, compact }) {
  const more = useRef(null);
  const [menu, setMenu] = useState(false);
  const j = f.job;
  if (f.state === 'installing' || f.state === 'queued') {
    const pct = Math.round(((j && j.progress) || 0) * 100);
    return html`<div class="feat-progress">
      <div class="row nowrap"><span class="small muted grow ellipsis">${f.state === 'queued' ? t('Sırada bekliyor') : (j && j.message) || t('İndiriliyor')}</span>
        <span class="tc small">%${pct}</span>
        <button class="iconbtn sm" title=${t('İptal')} onClick=${() => act(f.id, 'cancel')}><${Icon} name="x" size=${14} /></button></div>
      <${Progress} value=${(j && j.progress) || 0} live />
    </div>`;
  }
  if (f.state === 'removing')
    return f.restartToRemove
      ? html`<div class="row feat-acts"><span class="small muted">${t('Yeniden başlayınca kaldırılacak')}</span>
          ${desktop && html`<${Btn} small onClick=${() => desktop.relaunch()}>${t('Şimdi yeniden başlat')}</${Btn}>`}
          <${Btn} small kind="ghost" onClick=${() => act(f.id, 'keep')}>${t('Vazgeç')}</${Btn}></div>`
      : html`<span class="feat-state"><span class="spinner"></span>${t('Kaldırılıyor')}</span>`;
  // installed: a quiet tick and the word, the rest behind "…" (a coloured dot read like a warning light)
  if (f.state === 'ready')
    return html`<div class="row nowrap feat-acts"><span class="feat-state done"><${Icon} name="check" size=${14} />${t('Yüklü')}</span>
      ${!compact && html`<button class="iconbtn sm" ref=${more} title=${t('Diğer')} onClick=${() => setMenu(!menu)}><${Icon} name="dots" size=${16} /></button>`}
      ${menu && html`<${Popover} anchor=${more.current} onClose=${() => setMenu(false)}>
        <button class="popitem danger" onClick=${() => { setMenu(false); removeFeature(f); }}><${Icon} name="trash" size=${14} />${t('Kaldır')}</button>
      </${Popover}>`}</div>`;
  const label = f.state === 'partial' ? t('Modeli indir') : f.state === 'error' ? t('Tekrar dene') : t('İndir');
  return html`<div class="row nowrap feat-acts">
    ${f.state === 'error' && !compact && html`<span class="small feat-err" title=${(j && j.error) || ''}>${t('İndirilemedi')}</span>`}
    <${Btn} small kind=${compact ? 'primary' : ''} icon="download" onClick=${() => installFeatures([f.id])}>${label} · ${fmtSize(f.mb)}</${Btn}>
  </div>`;
}

/** A feature in one line (Ayarlar → Genel): its icon, its name, and its state or the button that adds it. */
export function FeatureLine({ id }) {
  useStore();
  const f = featureOf(id);
  if (!f) return null;
  return html`<div class=${cls('srow', 'featline', 'feat-' + f.state)}>
    <span class="feat-ico sm"><${Icon} name=${FEATURE_ICON[id] || 'bolt'} size=${16} /></span>
    <div class="srow-text"><span class="srow-label">${f.name}</span></div>
    <div class="srow-ctl featline-act"><${FeatureAction} f=${f} /></div>
  </div>`;
}

/** One feature in Ayarlar → Özellikler: what it does, its size, its state; `children` are its options. */
export function FeatureRow({ id, children }) {
  useStore();
  const f = featureOf(id);
  if (!f) return null;
  const err = f.state === 'error' && f.job && f.job.error;
  return html`<div class=${cls('feat', 'feat-' + f.state)}>
    <div class="feat-main">
      <span class="feat-ico"><${Icon} name=${FEATURE_ICON[id] || 'bolt'} size=${20} /></span>
      <div class="feat-text">
        <b>${f.name}</b>
        <span class="small muted">${f.summary}</span>
        ${err && html`<span class="small feat-err">${err}</span>`}
      </div>
      <div class="feat-side"><${FeatureAction} f=${f} /></div>
    </div>
    ${f.state === 'ready' || f.state === 'partial' ? children : null}
  </div>`;
}

/** Where a screen would use a missing feature: say what it adds and offer it in place. */
export function FeatureOffer({ id, text, class: c }) {
  useStore();
  const f = featureOf(id);
  if (!f || f.state === 'ready' || f.state === 'partial') return null; // partial: usable, its model comes on first use
  return html`<div class=${cls('offer', c)}>
    <span class="offer-ico"><${Icon} name=${FEATURE_ICON[id] || 'bolt'} size=${18} /></span>
    <div class="offer-text"><b>${f.name}</b><span class="small muted">${text || f.summary}</span></div>
    <div class="offer-act"><${FeatureAction} f=${f} compact /></div>
  </div>`;
}
