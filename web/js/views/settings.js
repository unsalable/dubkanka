// Settings: one page per topic with a sidebar, like the system settings of an OS. The gear (an × here) or Esc goes
// back to where you came from.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Field, Icon, Lamp, Segmented, Select, Toggle, useIndicator } from '../components.js';
import { desktop, useUpdate } from '../desktop.js';
import { FeatureRow } from '../feature-ui.js';
import { ask, backFromSettings, closeProject, motion, MOTION_LEVELS, refreshFeatures, setMotion, setState, toast, toastError, useStore } from '../state.js';
import { cls } from '../util.js';

const PAGES = [
  ['general', 'Genel', 'sliders'],
  ['features', 'Özellikler', 'sparkle'],
  ['translate', 'Çeviri', 'globe'],
  ['folders', 'Klasörler', 'folder'],
  ['updates', 'Güncellemeler', 'refresh'],
  ['system', 'Sistem', 'cpu'],
];

const openLink = (url) => (desktop ? desktop.openExternal(url) : window.open(url, '_blank', 'noopener'));

/** A titled group of rows on a rounded card, the settings layout of every page. */
function Group({ title, note, children }) {
  return html`<section class="sgroup">
    ${title && html`<h3 class="sgroup-title">${title}</h3>`}
    <div class="sgroup-card">${children}</div>
    ${note && html`<p class="sgroup-note">${note}</p>`}
  </section>`;
}

/** Label (and a line of explanation) on the left, the control on the right. */
function Row({ label, hint, children, wide }) {
  return html`<div class=${cls('srow', wide && 'wide')}>
    <div class="srow-text"><span class="srow-label">${label}</span>${hint && html`<span class="srow-hint">${hint}</span>`}</div>
    <div class="srow-ctl">${children}</div>
  </div>`;
}

function ProviderRow({ t, open, onToggle, onSaved }) {
  const [key, setKey] = useState('');
  const [url, setUrl] = useState(t.url || '');
  const [model, setModel] = useState(t.model || '');
  const [models, setModels] = useState(null);
  const [loading, setLoading] = useState(false);
  const [test, setTest] = useState(null);
  useEffect(() => {
    setUrl(t.url || '');
    setModel(t.model || '');
  }, [t.url, t.model]);
  const loadModels = async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/translators/${t.id}/models`);
      setModels(r.models);
      if (!model && r.suggested) setModel(r.suggested);
    } catch (e) {
      setModels([]);
      toastError(e);
    }
    setLoading(false);
  };
  useEffect(() => {
    if (open && t.kind === 'llm' && models === null && (t.hasKey || !t.needsKey || t.id === 'anthropic')) loadModels();
  }, [open]);
  const save = async (patch, msg = 'Kaydedildi') => {
    try {
      await onSaved({ providers: { [t.id]: patch } }, msg);
      setKey('');
      if (t.kind === 'llm') loadModels();
    } catch {}
  };
  const runTest = async () => {
    setTest({ busy: true });
    try {
      setTest(await api.post(`/api/translators/${t.id}/test`, { key: key.trim(), url: url.trim(), model }));
    } catch (e) {
      setTest({ ok: false, message: e.message });
    }
  };
  const kind = t.kind === 'mt' ? 'Makine çevirisi' : t.local ? 'Dil modeli · bu bilgisayarda' : 'Dil modeli · dublaja uygun';
  return html`<div class=${cls('prov', open && 'open')}>
    <button class="prov-head" onClick=${onToggle} aria-expanded=${open}>
      <span class="prov-text"><span class="prov-name">${t.name}</span><span class="dim small">${kind}</span></span>
      ${t.id === 'google' ? html`<${Lamp} tone="ok">hazır</${Lamp}>` : t.configured ? html`<${Lamp} tone="ok">ayarlı${t.model ? ' · ' + t.model : ''}</${Lamp}>` : html`<${Lamp}>ayarlanmadı</${Lamp}>`}
      <${Icon} name="chevron" size=${14} class="chev" />
    </button>
    ${open && html`<div class="prov-body">
      <p class="small muted">${t.note}${t.keyUrl ? html` <a href=${t.keyUrl} onClick=${(e) => { e.preventDefault(); openLink(t.keyUrl); }}>Anahtar al <${Icon} name="external" size=${11} /></a>` : ''}</p>
      ${t.needsUrl && html`<${Field} label="Sunucu adresi"><input class="input mono" value=${url} placeholder="http://127.0.0.1:…" onInput=${(e) => setUrl(e.target.value)} onBlur=${() => url.trim() !== (t.url || '') && save({ url: url.trim() })} /></${Field}>`}
      ${(t.needsKey || t.id === 'libre' || t.id === 'custom') && html`<${Field} label="API anahtarı" hint="Sadece bu bilgisayarda saklanır, sayfaya hiç gönderilmez.">
        <div class="row nowrap">
          <input class="input mono grow" type="password" autocomplete="off" placeholder=${t.hasKey ? '•••••••• kayıtlı' : 'anahtarı yapıştır'} value=${key} onInput=${(e) => setKey(e.target.value)} />
          <${Btn} kind="primary" disabled=${!key.trim()} onClick=${() => save({ key: key.trim() }, 'Anahtar kaydedildi')}>Kaydet</${Btn}>
          ${t.hasKey && html`<${Btn} kind="ghost" onClick=${() => save({ key: '' }, 'Anahtar silindi')}>Sil</${Btn}>`}
        </div></${Field}>`}
      ${t.kind === 'llm' && html`<${Field} label="Model">
        <div class="row nowrap">
          ${models && models.length
            ? html`<${Select} class="grow" value=${model} onChange=${(m) => { setModel(m); save({ model: m }, 'Model seçildi'); }}
                options=${[...(model && !models.some((m) => m.id === model) ? [[model, model]] : []), ...models.map((m) => [m.id, m.label === m.id ? m.id : `${m.label} · ${m.id}`])]} />`
            : html`<input class="input mono grow" value=${model} placeholder=${loading ? 'modeller alınıyor…' : 'model adı'} onInput=${(e) => setModel(e.target.value)} onBlur=${() => model !== (t.model || '') && save({ model: model.trim() })} />`}
          <button class="iconbtn" title="Model listesini yenile" onClick=${loadModels} disabled=${loading}><${Icon} name="refresh" size=${15} /></button>
        </div></${Field}>`}
      <div class="row">
        <${Btn} small icon=${test && test.busy ? null : 'check'} onClick=${runTest} disabled=${test && test.busy}>${test && test.busy ? 'Deneniyor…' : 'Dene'}</${Btn}>
        ${test && !test.busy && html`<${Lamp} tone=${test.ok ? 'ok' : 'bad'}>${test.ok ? `“Merhaba, nasılsın?” → ${test.sample}` : test.message}</${Lamp}>`}
      </div>
    </div>`}
  </div>`;
}

function GeneralPage() {
  const [mot, setMot] = useState(motion());
  return html`
    <${Group} title="Görünüm">
      <${Row} label="Animasyonlar" hint=${mot === 'off' ? 'Zayıf bilgisayarlar için: hiçbir şey hareket etmez.' : null}>
        <${Segmented} value=${mot} onChange=${(v) => { setMotion(v); setMot(v); }} options=${MOTION_LEVELS} />
      </${Row}>
    </${Group}>`;
}

function FeaturesPage({ sys, save }) {
  const st = sys.settings;
  const gpu = sys.gpu || {};
  return html`
    <div class="feats">
      <${FeatureRow} id="speech">
        <div class="feat-opts"><${Row} label="Model" hint="Değiştirirsen yeni model ilk kullanımda iner.">
          <${Select} value=${st.whisperModel} onChange=${(v) => save({ whisperModel: v })} options=${sys.whisperModels || []} />
        </${Row}></div>
      </${FeatureRow}>
      <${FeatureRow} id="separate">
        <div class="feat-opts"><${Row} label="Model">
          <${Select} value=${st.separationModel} onChange=${(v) => save({ separationModel: v })} options=${[['htdemucs_ft', 'htdemucs_ft · en iyi'], ['htdemucs', 'htdemucs · hızlı']]} />
        </${Row}></div>
      </${FeatureRow}>
      <${FeatureRow} id="room" />
      <${FeatureRow} id="cleanup" />
    </div>
    <${Group} title="İşlemci" note=${gpu.available ? `Ekran kartı: ${gpu.name}${gpu.memoryGB ? ` (${gpu.memoryGB} GB)` : ''}` : 'Ekran kartı yok; yapay zeka işlemcide çalışır.'}>
      <${Row} label="Yapay zekayı nerede çalıştır">
        <${Select} value=${st.device} onChange=${(v) => save({ device: v })} options=${[['auto', 'Ekran kartı varsa onda'], ['cpu', 'Sadece işlemcide']]} />
      </${Row}>
    </${Group}>`;
}

function TranslatePage({ sys, save }) {
  const st = sys.settings;
  const [open, setOpen] = useState(null);
  const [found, setFound] = useState(null);
  const translators = sys.translators || [];
  const detect = async () => {
    setFound({ busy: true });
    try {
      setFound(await api.post('/api/translators/detect'));
    } catch (e) {
      toastError(e);
      setFound(null);
    }
  };
  const applyFound = async (ids) => {
    try {
      const r = await api.post('/api/translators/detect/apply', { ids });
      setState((s) => ({ system: { ...s.system, settings: r.settings, translators: r.translators } }));
      toast(r.applied.length ? 'Ayarlandı: ' + r.applied.join(', ') : 'Hiçbiri ayarlanamadı', r.applied.length ? 'ok' : 'error');
    } catch (e) {
      toastError(e);
    }
  };
  return html`
    <${Group}>
      <${Row} label="Yeni sahnelerde">
        <${Select} value=${st.translator} onChange=${(v) => save({ translator: v })} options=${translators.map((t) => [t.id, t.name + (t.configured ? '' : ' (ayarlanmadı)')])} />
      </${Row}>
      <${Row} label="Otomatik bul" hint="Ollama, LM Studio ve kayıtlı API anahtarları.">
        <${Btn} small icon="bolt" onClick=${detect} disabled=${found && found.busy}>${found && found.busy ? 'Aranıyor…' : 'Ara'}</${Btn}>
      </${Row}>
      ${found && !found.busy && html`<div class="found">${found.found.length === 0
        ? html`<span class="dim small">Hiçbir şey bulunamadı.</span>`
        : html`${found.found.map((f) => html`<div class="found-row" key=${f.id}><${Lamp} tone="ok">${(translators.find((t) => t.id === f.id) || {}).name || f.id}</${Lamp}>
            <span class="dim small grow">${f.detail}</span><${Btn} small onClick=${() => applyFound([f.id])}>Kullan</${Btn}></div>`)}
          ${found.found.length > 1 && html`<${Btn} small kind="primary" onClick=${() => applyFound(found.found.map((f) => f.id))}>Hepsini ayarla</${Btn}>`}`}</div>`}
    </${Group}>
    <${Group} title="Servisler">
      ${translators.map((t) => html`<${ProviderRow} key=${t.id} t=${t} open=${open === t.id} onToggle=${() => setOpen(open === t.id ? null : t.id)} onSaved=${save} />`)}
    </${Group}>`;
}

function FoldersPage({ sys, save }) {
  const pick = async (k, current) => {
    const path = desktop ? await desktop.pickFolder({ title: 'Klasör seç', defaultPath: current }) : await ask({ title: 'Klasör yolu', input: current, ok: 'Kaydet' });
    if (path == null) return;
    await save({ [k]: path.trim() }, 'Kaydedildi. Yeni klasör uygulama yeniden açılınca kullanılır.').catch(() => {});
  };
  const open = (target) => api.post('/api/open-folder', { target }).catch(toastError);
  const row = (label, dir, target, key) => html`<div class="srow folder">
    <div class="srow-text"><span class="srow-label">${label}</span><span class="srow-hint mono ellipsis" title=${dir}>${dir}</span></div>
    <div class="srow-ctl"><${Btn} small kind="ghost" icon="folder" onClick=${() => open(target)}>Aç</${Btn}>
      ${key && html`<${Btn} small onClick=${() => pick(key, dir)}>Değiştir</${Btn}>`}</div>
  </div>`;
  return html`
    <${Group} note="Değişiklik uygulama yeniden açılınca geçerli olur.">
      ${row('Videolar', sys.dirs.exports, 'exports', 'exportsDir')}
      ${row('Projeler', sys.dirs.projects, 'projects', 'projectsDir')}
      ${row('Yapay zeka modelleri', sys.dirs.models, 'models')}
    </${Group}>
    ${desktop && html`<${Btn} small kind="ghost" icon="refresh" onClick=${() => desktop.relaunch()}>Uygulamayı yeniden başlat</${Btn}>`}`;
}

function UpdatesPage() {
  const u = useUpdate();
  const [prefs, setPrefs] = useState(null);
  useEffect(() => {
    desktop.updates.getPrefs().then(setPrefs).catch(() => {});
  }, []);
  const state = {
    idle: 'Bekliyor', checking: 'Kontrol ediliyor…', available: `Yeni sürüm bulundu: ${u && u.version}`,
    downloading: `İndiriliyor… %${Math.round(((u && u.progress) || 0) * 100)}`, downloaded: `${u && u.version} indirildi, yeniden başlatınca kurulur`,
    none: 'Güncel', error: `Hata: ${u && u.error}`, disabled: 'Geliştirme sürümünde kapalı',
  }[(u && u.state) || 'idle'];
  return html`
    <${Group}>
      <${Row} label="Sürüm"><span class="tc">${desktop.version}</span></${Row}>
      <${Row} label="Durum"><span>${state}</span></${Row}>
      ${prefs && html`<${Row} label="Otomatik güncelle" hint="Her açılışta yeni sürüm varsa indirip kurar. Projelerin olduğu gibi kalır.">
        <${Toggle} checked=${prefs.auto} onChange=${(v) => desktop.updates.setPrefs({ auto: v }).then(setPrefs)} label="" /></${Row}>`}
    </${Group}>
    <div class="row">
      <${Btn} small icon="refresh" onClick=${() => desktop.updates.check()} disabled=${u && ['checking', 'downloading'].includes(u.state)}>Şimdi kontrol et</${Btn}>
      ${u && u.state === 'downloaded' && html`<${Btn} small kind="primary" onClick=${() => desktop.updates.install()}>Yeniden başlat ve güncelle</${Btn}>`}
      ${u && u.state === 'available' && prefs && !prefs.auto && html`<${Btn} small kind="primary" onClick=${() => desktop.updates.download()}>İndir</${Btn}>`}
    </div>`;
}

function SystemPage({ sys }) {
  const [rt, setRt] = useState(null);
  useEffect(() => {
    if (desktop) desktop.runtime.getInfo().then(setRt).catch(() => {});
  }, []);
  const enc = sys.encoders || [];
  const sep = (sys.features || []).find((f) => f.id === 'separate');
  return html`
    <${Group}>
      <${Row} label="DubKanka"><span class="tc">${sys.version}${desktop ? ' · masaüstü' : ''}</span></${Row}>
      <${Row} label="ffmpeg">${sys.ffmpeg ? html`<${Lamp} tone="ok">hazır</${Lamp}>` : html`<${Lamp} tone="bad">bulunamadı</${Lamp}>`}</${Row}>
      <${Row} label="Video kodlayıcılar"><span class="mono small">${enc.map((e) => e.id).join(' · ') || '—'}</span></${Row}>
      <${Row} label="Ekran kartı"><span>${sys.gpu && sys.gpu.available ? `${sys.gpu.name}${sys.gpu.memoryGB ? ` (${sys.gpu.memoryGB} GB)` : ''}` : 'yok'}</span></${Row}>
      ${rt && html`<${Row} label="Çalışma ortamı"><span class="mono small">Python ${rt.python || '?'}${sep && sep.state === 'ready' ? ` · PyTorch ${sep.build}` : ''}</span></${Row}>`}
    </${Group}>
    ${rt && html`<div class="row">
      <${Btn} small kind="ghost" icon="folder" onClick=${() => desktop.showItemInFolder(rt.logs)}>Günlükler</${Btn}>
      <${Btn} small onClick=${async () => (await ask({ title: 'Kurulum onarılsın mı?', text: 'Eksik parçalar yeniden kurulur ve uygulama yeniden başlar. Projelerin olduğu gibi kalır.', ok: 'Onar' })) && desktop.runtime.repair()}>Kurulumu onar</${Btn}>
    </div>`}`;
}

export function SettingsView({ page }) {
  const s = useStore();
  const sys = s.system;
  const nav = useRef(null);
  const ind = useRef(null);
  useEffect(() => closeProject(), []);
  useEffect(() => {
    // Esc leaves settings (unless it belongs to a field or an open menu)
    const k = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.popover, .modal, .dialog-bg')) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return document.activeElement.blur();
      location.hash = backFromSettings();
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  const pages = PAGES.filter(([id]) => id !== 'updates' || desktop);
  const cur = pages.find(([id]) => id === page) || pages[0];
  // the selection is a pill that slides to the new row, like the steps in the top bar
  useIndicator(nav, ind, '.set-link.on', [cur[0], !!sys], 'y');
  if (!sys) return html`<div class="page settings"><div class="skel" style=${{ height: '320px', gridColumn: '1 / -1' }}></div></div>`;
  const save = async (patch, msg = 'Kaydedildi') => {
    try {
      const settings = await api.post('/api/settings', patch);
      const translators = await api.get('/api/translators');
      setState((st) => ({ system: { ...st.system, settings, translators } }));
      if ('whisperModel' in patch || 'separationModel' in patch) refreshFeatures(); // a new model changes what is missing
      if (msg) toast(msg, 'ok', 2200);
    } catch (e) {
      toastError(e);
      throw e;
    }
  };
  const View = { general: GeneralPage, features: FeaturesPage, translate: TranslatePage, folders: FoldersPage, updates: UpdatesPage, system: SystemPage }[cur[0]];
  return html`<div class="page settings">
    <nav class="set-nav" aria-label="Ayarlar" ref=${nav}>
      <h1>Ayarlar</h1>
      <i class="set-ind" ref=${ind}></i>
      ${pages.map(([id, label, icon]) => html`<a key=${id} class=${cls('set-link', id === cur[0] && 'on')} href=${'#/settings/' + id}
        aria-current=${id === cur[0] ? 'page' : undefined}><span class="set-ico"><${Icon} name=${icon} size=${15} /></span>${label}</a>`)}
    </nav>
    <div class="set-body" key=${cur[0]}>
      <h2 class="spage-title">${cur[1]}</h2>
      <${View} sys=${sys} save=${save} />
    </div>
  </div>`;
}
