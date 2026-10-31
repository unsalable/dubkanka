import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Field, Icon, Select } from '../components.js';
import { closeProject, setState, toast, toastError, useStore } from '../state.js';

export function SettingsView() {
  const s = useStore();
  const sys = s.system;
  const [key, setKey] = useState('');
  useEffect(() => closeProject(), []);
  if (!sys) return html`<div class="page narrow"><div class="skel" style=${{ height: '240px' }}></div></div>`;
  const st = sys.settings;
  const save = async (patch, msg = 'Kaydedildi') => {
    try {
      const settings = await api.post('/api/settings', patch);
      setState({ system: { ...sys, settings } });
      toast(msg, 'ok');
    } catch (e) {
      toastError(e);
    }
  };
  return html`<div class="page narrow settings">
    <header class="page-head"><div><h1>Ayarlar</h1><p>Bu bilgisayardaki DubKanka için geçerli.</p></div></header>
    <section class="panel">
      <h3>Yapay zeka</h3>
      <${Field} label="Konuşma tanıma modeli" hint="Değiştirirsen yeni model ilk kullanımda indirilir.">
        <${Select} value=${st.whisperModel} onChange=${(v) => save({ whisperModel: v })} options=${sys.whisperModels} />
      </${Field}>
      <${Field} label="Konuşma / fon ayırma kalitesi">
        <${Select} value=${st.separationModel} onChange=${(v) => save({ separationModel: v })} options=${[['htdemucs_ft', 'En iyi (önerilen)'], ['htdemucs', 'Hızlı']]} />
      </${Field}>
      <${Field} label="İşlemci" hint=${sys.gpu && sys.gpu.available ? `Bulunan ekran kartı: ${sys.gpu.name} (${sys.gpu.memoryGB} GB)` : 'Ekran kartı bulunamadı.'}>
        <${Select} value=${st.device} onChange=${(v) => save({ device: v })} options=${[['auto', 'Otomatik (ekran kartı varsa kullan)'], ['cpu', 'Sadece işlemci (CPU)']]} />
      </${Field}>
    </section>
    <section class="panel">
      <h3>Çeviri</h3>
      <${Field} label="Varsayılan çeviri">
        <${Select} value=${st.translator} onChange=${(v) => save({ translator: v })} options=${[['google', 'Google Çeviri (ücretsiz)'], ['claude', 'Claude (dublaja uygun)']]} />
      </${Field}>
      <${Field} label="Anthropic API anahtarı (Claude için)" hint=${html`Anahtar sadece bu bilgisayarda (settings.json) saklanır. Almak için: <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>`}>
        <div class="row" style=${{ flexWrap: 'nowrap' }}>
          <input class="input grow" type="password" autocomplete="off" placeholder=${st.hasAnthropicKey ? '•••••••• (kayıtlı)' : 'sk-ant-…'} value=${key} onInput=${(e) => setKey(e.target.value)} />
          <${Btn} kind="primary" disabled=${!key.trim()} onClick=${() => { save({ anthropicKey: key.trim() }, 'API anahtarı kaydedildi'); setKey(''); }}>Kaydet</${Btn}>
          ${st.hasAnthropicKey && html`<${Btn} kind="ghost" onClick=${() => save({ anthropicKey: '' }, 'API anahtarı silindi')}>Sil</${Btn}>`}
        </div>
      </${Field}>
      <${Field} label="Claude modeli">
        <${Select} value=${st.claudeModel} onChange=${(v) => save({ claudeModel: v })} options=${sys.claudeModels} />
      </${Field}>
    </section>
    <section class="panel">
      <h3>Sistem</h3>
      <div class="kv"><span>Sürüm</span><span class="tc">${sys.version}</span></div>
      <div class="kv"><span>ffmpeg</span><span>${sys.ffmpeg ? 'hazır' : 'BULUNAMADI'}${sys.caps && sys.caps.nvenc ? ' · ekran kartıyla video kodlama' : ''}${sys.caps && sys.caps.rubberband ? ' · yüksek kaliteli hız/perde' : ''}</span></div>
      <div class="kv"><span>Ekran kartı</span><span>${sys.gpu && sys.gpu.available ? `${sys.gpu.name} (${sys.gpu.memoryGB} GB)` : 'yok'}</span></div>
      <div class="kv"><span>Videoların klasörü</span><span class="mono small">${sys.exportsDir}</span></div>
      <div style=${{ marginTop: '12px' }}><${Btn} small icon="folder" onClick=${() => api.post('/api/open-folder', {}).catch(toastError)}>Videolar klasörünü aç</${Btn}></div>
    </section>
    <p class="muted small row"><${Icon} name="mic" size=${14} /> Mikrofon ayarları her bilgisayarda ayrı tutulur: Kayıt ekranı, Kabin ayarları.</p>
  </div>`;
}
