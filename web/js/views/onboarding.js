// First run: one question, "what do you want to do?". Dubbing with your own voice is always there; every AI part is a
// choice, downloaded in the background while the studio is already usable (features.py on the server).
import { html, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Icon } from '../components.js';
import { featureOf, installFeatures, setState, store, toastError, useStore } from '../state.js';
import { cls, fmtSize } from '../util.js';

const INTENTS = [
  { id: 'speech', icon: 'text', title: 'Yazıya dök ve çevir',
    text: 'Kim ne zaman ne diyor bulunur; satırlar kendiliğinden yazılır ve istediğin dile çevrilir.' },
  { id: 'separate', icon: 'music', title: 'Müziği ve efektleri koru',
    text: 'Orijinal konuşmalar çıkarılır, fon müziği ve efektler dublajın altında kalır.' },
  { id: 'room', icon: 'users', title: 'Arkadaşlarla kaydet',
    text: 'Arkadaşların bir linkle telefondan katılır, her biri kendi rolünü kaydeder.' },
];

/** "4-12 dk" at roughly 2.5 to 8 MB/s. */
function eta(mb) {
  const lo = Math.max(1, Math.round(mb / 8 / 60));
  const hi = Math.max(lo + 1, Math.round(mb / 2.5 / 60));
  return `${lo}-${hi} dk`;
}

export function Onboarding() {
  useStore();
  const [pick, setPick] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setPick((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const chosen = INTENTS.filter((i) => pick.has(i.id) && featureOf(i.id) && featureOf(i.id).state !== 'ready');
  const mb = chosen.reduce((a, i) => a + (featureOf(i.id).mb || 0), 0);

  const start = async (ids) => {
    setBusy(true);
    try {
      const settings = await api.post('/api/settings', { onboarded: true });
      setState({ system: { ...store.system, settings } });
      if (ids.length) await installFeatures(ids);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return html`<div class="page onboard">
    <div class="onboard-inner">
      <img class="onboard-mark" src="/web/icon.svg" alt="" />
      <h1>DubKanka'yla ne yapmak istiyorsun?</h1>
      <p class="onboard-lead">Seçtiklerin arka planda iner, beklemeden başlayabilirsin. Gerisini istediğin zaman Ayarlar → Özellikler'den eklersin.</p>
      <div class="picklist" role="group" aria-label="Özellikler">
        <div class="pick on locked" role="checkbox" aria-checked="true" aria-disabled="true">
          <span class="pick-ico"><${Icon} name="mic" size=${19} /></span>
          <span class="pick-text"><b>Kendi sesinle dublaj</b><small>Sahneyi kes, replikleri yaz, herkes kendi satırını kaydetsin, altyazılı videoyu paylaş.</small></span>
          <span class="pick-size">Dahil</span><span class="pick-check"></span>
        </div>
        ${INTENTS.map((it, i) => {
          const f = featureOf(it.id);
          const ready = f && f.state === 'ready';
          const on = ready || pick.has(it.id);
          return html`<button key=${it.id} class=${cls('pick', on && 'on', ready && 'locked')} role="checkbox" aria-checked=${on} disabled=${ready || !f}
            style=${{ '--i': i + 1 }} onClick=${() => toggle(it.id)}>
            <span class="pick-ico"><${Icon} name=${it.icon} size=${19} /></span>
            <span class="pick-text"><b>${it.title}</b><small>${it.text}</small></span>
            <span class="pick-size">${!f ? '' : ready ? 'Hazır' : fmtSize(f.mb)}</span><span class="pick-check"></span>
          </button>`;
        })}
      </div>
      <div class="onboard-foot">
        <div class="onboard-sum">${mb
          ? html`<b>${fmtSize(mb)}</b> indirilecek <span class="dim">· internet hızına göre ${eta(mb)}</span>`
          : html`<b>Ek indirme yok.</b> <span class="dim">İstediğin zaman ekleyebilirsin.</span>`}</div>
        <${Btn} kind="primary" class="onboard-go" disabled=${busy} onClick=${() => start(chosen.map((i) => i.id))}>${busy ? 'Hazırlanıyor…' : 'Başla'}</${Btn}>
      </div>
    </div>
  </div>`;
}
