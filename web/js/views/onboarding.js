// First run: one question, "what do you want to do?". The studio itself is ready and ticked; every AI part is an extra,
// unticked, downloaded in the background while the studio is already usable (features.py on the server). Whatever is
// left out is offered again where it would be used, and in Ayarlar → Özellikler.
import { html, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Icon, Segmented } from '../components.js';
import { LANGS, t } from '../i18n.js';
import { changeLang, featureOf, installFeatures, setState, store, toastError, useStore } from '../state.js';
import { cls, fmtSize } from '../util.js';

// titles and lines are translated where they are shown (t())
const EXTRAS = [
  { id: 'speech', icon: 'text', title: 'Yazıya dök ve çevir', text: 'Satırlar kendiliğinden yazılır ve çevrilir.' },
  { id: 'separate', icon: 'music', title: 'Müziği ve efektleri koru', text: 'Orijinal konuşmalar çıkar, müzik kalır.' },
  { id: 'room', icon: 'users', title: 'Arkadaşlarla kaydet', text: 'Arkadaşların linkle telefondan katılır.' },
  { id: 'cleanup', icon: 'wave', title: 'Kayıt temizleme', text: 'Kayıtlardaki gürültü yapay zekayla silinir.' },
];

/** "4-12 dk" at roughly 2.5 to 8 MB/s. */
function eta(mb) {
  const lo = Math.max(1, Math.round(mb / 8 / 60));
  const hi = Math.max(lo + 1, Math.round(mb / 2.5 / 60));
  return t('{a}-{b} dk', { a: lo, b: hi });
}

export function Onboarding() {
  const s = useStore();
  const [pick, setPick] = useState(() => new Set());
  const [busy, setBusy] = useState(false);
  const toggle = (id) => setPick((s) => {
    const n = new Set(s);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });
  const chosen = EXTRAS.filter((i) => pick.has(i.id) && featureOf(i.id) && featureOf(i.id).state !== 'ready');
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
    <div class="onboard-lang"><${Segmented} value=${s.lang} onChange=${changeLang} options=${LANGS} /></div>
    <div class="onboard-inner">
      <img class="onboard-mark" src="/web/icon.svg" alt="" />
      <h1>${t("DubKanka'yla ne yapmak istiyorsun?")}</h1>
      <p class="onboard-lead">${t('Stüdyo hazır. Ek özellikleri istersen şimdi seç, istersen sonra kullanırken indir.')}</p>
      <h2 class="onboard-group">${t('Temel')}</h2>
      <div class="picklist" role="group" aria-label=${t('Temel')}>
        <div class="pick on locked" role="checkbox" aria-checked="true" aria-disabled="true">
          <span class="pick-ico"><${Icon} name="mic" size=${19} /></span>
          <span class="pick-text"><b>${t('Kendi sesinle dublaj')}</b><small>${t('Kayıt, canlı gürültü engelleme, miks ve paylaşım.')}</small></span>
          <span class="pick-size">${t('Dahil')}</span><span class="pick-check"></span>
        </div>
      </div>
      <h2 class="onboard-group">${t('Ek özellikler')}</h2>
      <div class="picklist" role="group" aria-label=${t('Ek özellikler')}>
        ${EXTRAS.map((it, i) => {
          const f = featureOf(it.id);
          const ready = f && f.state === 'ready';
          const on = ready || pick.has(it.id);
          return html`<button key=${it.id} class=${cls('pick', on && 'on', ready && 'locked')} role="checkbox" aria-checked=${on} disabled=${ready || !f}
            style=${{ '--i': i + 1 }} onClick=${() => toggle(it.id)}>
            <span class="pick-ico"><${Icon} name=${it.icon} size=${19} /></span>
            <span class="pick-text"><b>${t(it.title)}</b><small>${t(it.text)}</small></span>
            <span class="pick-size">${!f ? '' : ready ? t('Hazır') : fmtSize(f.mb)}</span><span class="pick-check"></span>
          </button>`;
        })}
      </div>
      <div class="onboard-foot">
        <div class="onboard-sum">${mb
          ? html`<b>${fmtSize(mb)}</b> ${t('indirilecek')} <span class="dim">· ${t('yaklaşık {t}', { t: eta(mb) })}</span>`
          : html`<b>${t('Ek indirme yok.')}</b>`}</div>
        <${Btn} kind="primary" class="onboard-go" disabled=${busy} onClick=${() => start(chosen.map((i) => i.id))}>${busy ? t('Hazırlanıyor…') : t('Başla')}</${Btn}>
      </div>
    </div>
  </div>`;
}
