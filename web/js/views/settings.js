import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Field, Icon, Lamp, Segmented, Select, Toggle } from '../components.js';
import { desktop, useUpdate } from '../desktop.js';
import { closeProject, motion, MOTION_LEVELS, setMotion, setState, toast, toastError, useStore } from '../state.js';
import { cls } from '../util.js';

const SECTIONS = [['translate', 'Çeviri'], ['look', 'Görünüm'], ['auto', 'Otomatik hazırlık'], ['ai', 'Yapay zeka'], ['folders', 'Klasörler'],
  ['updates', 'Güncellemeler'], ['system', 'Sistem']];

const openLink = (url) => (desktop ? desktop.openExternal(url) : window.open(url, '_blank', 'noopener'));

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
      <${Icon} name="chevron" size=${12} class="chev" />
      <span class="prov-name">${t.name}</span><span class="dim small">${kind}</span><span class="grow"></span>
      ${t.id === 'google' ? html`<${Lamp} tone="ok">hazır</${Lamp}>` : t.configured ? html`<${Lamp} tone="ok">ayarlı${t.model ? ' · ' + t.model : ''}</${Lamp}>` : html`<${Lamp}>ayarlanmadı</${Lamp}>`}
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

function UpdatesSection() {
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
    <div class="kv"><span>Sürüm</span><span class="tc">${desktop.version}</span></div>
    <div class="kv"><span>Durum</span><span>${state}</span></div>
    ${prefs && html`<${Toggle} checked=${prefs.auto} onChange=${(v) => desktop.updates.setPrefs({ auto: v }).then(setPrefs)} label="Yeni sürümü arka planda indir" />`}
    <div class="row">
      <${Btn} small icon="refresh" onClick=${() => desktop.updates.check()} disabled=${u && ['checking', 'downloading'].includes(u.state)}>Şimdi kontrol et</${Btn}>
      ${u && u.state === 'downloaded' && html`<${Btn} small kind="primary" onClick=${() => desktop.updates.install()}>Yeniden başlat ve güncelle</${Btn}>`}
      ${u && u.state === 'available' && prefs && !prefs.auto && html`<${Btn} small kind="primary" onClick=${() => desktop.updates.download()}>İndir</${Btn}>`}
    </div>
    <p class="field-hint">Güncellemeler GitHub'daki DubKanka sürümlerinden gelir; projelerin ve modellerin olduğu gibi kalır.</p>`;
}

export function SettingsView() {
  const s = useStore();
  const sys = s.system;
  const [open, setOpen] = useState(null);
  const [found, setFound] = useState(null);
  const [mot, setMot] = useState(motion());
  const [rt, setRt] = useState(null);
  const body = useRef(null);
  useEffect(() => closeProject(), []);
  useEffect(() => {
    if (desktop) desktop.runtime.getInfo().then(setRt).catch(() => {});
  }, []);
  if (!sys) return html`<div class="page narrow"><div class="skel" style=${{ height: '240px' }}></div></div>`;
  const st = sys.settings;
  const save = async (patch, msg = 'Kaydedildi') => {
    try {
      const settings = await api.post('/api/settings', patch);
      const translators = await api.get('/api/translators');
      setState({ system: { ...s.system, settings, translators } });
      if (msg) toast(msg, 'ok');
    } catch (e) {
      toastError(e);
      throw e;
    }
  };
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
      setState({ system: { ...s.system, settings: r.settings, translators: r.translators } });
      toast(r.applied.length ? 'Ayarlandı: ' + r.applied.join(', ') : 'Hiçbiri ayarlanamadı', r.applied.length ? 'ok' : 'error');
    } catch (e) {
      toastError(e);
    }
  };
  const pickFolder = async (k, current) => {
    const path = desktop ? await desktop.pickFolder({ title: 'Klasör seç', defaultPath: current }) : prompt('Klasör yolu', current);
    if (path == null) return;
    await save({ [k]: path.trim() }, 'Kaydedildi. Yeni klasör uygulama yeniden açılınca kullanılır.').catch(() => {});
  };
  const translators = sys.translators || [];
  const jump = (id) => body.current && body.current.querySelector('#set-' + id).scrollIntoView({ behavior: motion() === 'off' ? 'auto' : 'smooth', block: 'start' });
  const enc = sys.encoders || [];
  return html`<div class="page settings">
    <nav class="set-nav">
      <h1>Ayarlar</h1>
      ${SECTIONS.filter(([id]) => id !== 'updates' || desktop).map(([id, label]) => html`<button key=${id} class="set-link" onClick=${() => jump(id)}>${label}</button>`)}
    </nav>
    <div class="set-body" ref=${body}>
      <section id="set-translate" class="set-sec">
        <h2>Çeviri</h2>
        <p class="muted">Google Çeviri ücretsizdir ve anahtar istemez. Dil modelleri satırları süresine sığacak, doğal ya da troll tarzında uyarlar; anahtarlı olanlar kendi hesabından ücretlendirilir.</p>
        <${Field} label="Yeni sahnelerde kullanılacak">
          <${Select} value=${st.translator} onChange=${(v) => save({ translator: v })} options=${translators.map((t) => [t.id, t.name + (t.configured ? '' : ' (ayarlanmadı)')])} />
        </${Field}>
        <div class="row detect">
          <${Btn} small icon="bolt" onClick=${detect} disabled=${found && found.busy}>${found && found.busy ? 'Aranıyor…' : 'Otomatik bul'}</${Btn}>
          <span class="dim small">Bu bilgisayarda çalışan Ollama / LM Studio'yu ve ortam değişkenlerindeki API anahtarlarını bulur.</span>
        </div>
        ${found && !found.busy && html`<div class="found">${found.found.length === 0
          ? html`<span class="dim small">Hiçbir şey bulunamadı.</span>`
          : html`${found.found.map((f) => html`<div class="found-row" key=${f.id}><${Lamp} tone="ok">${(translators.find((t) => t.id === f.id) || {}).name || f.id}</${Lamp}>
              <span class="dim small">${f.detail}</span><span class="grow"></span><${Btn} small onClick=${() => applyFound([f.id])}>Kullan</${Btn}></div>`)}
            ${found.found.length > 1 && html`<${Btn} small kind="primary" onClick=${() => applyFound(found.found.map((f) => f.id))}>Hepsini ayarla</${Btn}>`}`}</div>`}
        <div class="provs">${translators.map((t) => html`<${ProviderRow} key=${t.id} t=${t} open=${open === t.id} onToggle=${() => setOpen(open === t.id ? null : t.id)} onSaved=${save} />`)}</div>
      </section>

      <section id="set-look" class="set-sec">
        <h2>Görünüm</h2>
        <${Field} label="Animasyonlar" hint=${mot === 'full' ? 'Sayfa geçişleri, kayan göstergeler ve kayıt animasyonları açık.' : mot === 'reduced' ? 'Süreler kısalır, kayma ve büyüme yerine kısa solma.' : 'Hiçbir şey hareket etmez; sadece yükleme ve kayıt lambası çalışır. Zayıf bilgisayarlar için.'}>
          <${Segmented} value=${mot} onChange=${(v) => { setMotion(v); setMot(v); }} options=${MOTION_LEVELS} />
        </${Field}>
      </section>

      <section id="set-auto" class="set-sec">
        <h2>Otomatik hazırlık</h2>
        <${Toggle} checked=${st.autoPrepare !== false} onChange=${(v) => save({ autoPrepare: v })}
          label=${html`<span class="toggle-text">Video bırakılınca hemen hazırla<small>15 dakikadan kısa videolar baştan sona hazırlanır, bitince senaryo açılır.</small></span>`} />
        <${Field} label="Dublaj dili"><${Select} value=${st.defaultDstLang || 'en'} onChange=${(v) => save({ defaultDstLang: v })} options=${sys.languages || []} /></${Field}>
      </section>

      <section id="set-ai" class="set-sec">
        <h2>Yapay zeka</h2>
        <${Field} label="Konuşma tanıma (Whisper)" hint="Değiştirirsen yeni model ilk kullanımda indirilir.">
          <${Select} value=${st.whisperModel} onChange=${(v) => save({ whisperModel: v })} options=${sys.whisperModels} />
        </${Field}>
        <${Field} label="Konuşma / fon ayırma (Demucs)">
          <${Select} value=${st.separationModel} onChange=${(v) => save({ separationModel: v })} options=${[['htdemucs_ft', 'htdemucs_ft · en iyi'], ['htdemucs', 'htdemucs · hızlı']]} />
        </${Field}>
        <${Field} label="İşlemci" hint=${sys.gpu && sys.gpu.available ? `Ekran kartı: ${sys.gpu.name} (${sys.gpu.memoryGB} GB)` : 'Ekran kartı bulunamadı; işlemler işlemcide yapılır.'}>
          <${Select} value=${st.device} onChange=${(v) => save({ device: v })} options=${[['auto', 'Otomatik (ekran kartı varsa)'], ['cpu', 'Sadece işlemci (CPU)']]} />
        </${Field}>
      </section>

      <section id="set-folders" class="set-sec">
        <h2>Klasörler</h2>
        ${[['exportsDir', 'Videolar', sys.dirs.exports, 'exports'], ['projectsDir', 'Projeler', sys.dirs.projects, 'projects']].map(([k, label, dir, target]) => html`<div class="folder" key=${k}>
          <div class="grow"><div class="field-label">${label}</div><div class="mono small ellipsis" title=${dir}>${dir}</div></div>
          <${Btn} small kind="ghost" icon="folder" onClick=${() => api.post('/api/open-folder', { target }).catch(toastError)}>Aç</${Btn}>
          <${Btn} small onClick=${() => pickFolder(k, dir)}>Değiştir</${Btn}>
        </div>`)}
        <div class="folder"><div class="grow"><div class="field-label">Yapay zeka modelleri</div><div class="mono small ellipsis">${sys.dirs.models}</div></div>
          <${Btn} small kind="ghost" icon="folder" onClick=${() => api.post('/api/open-folder', { target: 'models' }).catch(toastError)}>Aç</${Btn}></div>
        ${desktop && html`<${Btn} small kind="ghost" icon="refresh" onClick=${() => desktop.relaunch()}>Uygulamayı yeniden başlat</${Btn}>`}
      </section>

      ${desktop && html`<section id="set-updates" class="set-sec"><h2>Güncellemeler</h2><${UpdatesSection} /></section>`}

      <section id="set-system" class="set-sec">
        <h2>Sistem</h2>
        <div class="kv"><span>DubKanka</span><span class="tc">${sys.version}${desktop ? ' · masaüstü' : ''}</span></div>
        <div class="kv"><span>ffmpeg</span><span>${sys.ffmpeg ? html`<${Lamp} tone="ok">hazır</${Lamp}>` : html`<${Lamp} tone="bad">bulunamadı</${Lamp}>`}</span></div>
        <div class="kv"><span>Video kodlayıcılar</span><span class="mono small">${enc.map((e) => e.id).join(' · ') || '—'}</span></div>
        <div class="kv"><span>Ekran kartı</span><span>${sys.gpu && sys.gpu.available ? `${sys.gpu.name} (${sys.gpu.memoryGB} GB)` : 'yok'}</span></div>
        ${rt && html`<div class="kv"><span>Çalışma ortamı</span><span class="mono small">Python ${rt.python || '?'} · PyTorch ${rt.torch || '?'}</span></div>
          <div class="row" style=${{ marginTop: '10px' }}>
            <${Btn} small kind="ghost" icon="folder" onClick=${() => desktop.showItemInFolder(rt.logs)}>Günlükler</${Btn}>
            <${Btn} small onClick=${() => confirm('Python ve yapay zeka paketleri kontrol edilip eksikler yeniden kurulacak. Uygulama yeniden başlar. Devam?') && desktop.runtime.repair()}>Kurulumu onar</${Btn}>
          </div>`}
      </section>
    </div>
  </div>`;
}
