import { html, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P } from '../api.js';
import { Btn, Field, Icon, JobPanel, Range, Select, Toggle } from '../components.js';
import { jobOf, patchLocal, toastError, useStore } from '../state.js';
import { cls, fmtBytes, fmtTime, timeAgo } from '../util.js';

const FONTS = ['Arial Black', 'Impact', 'Arial', 'Segoe UI', 'Verdana', 'Comic Sans MS', 'Trebuchet MS', 'Georgia'];
const FORMAT_SHAPES = { vertical_blur: [9, 16], vertical_crop: [9, 16], square: [1, 1] };

function FramePreview({ p, ex }) {
  const [vw, vh] = FORMAT_SHAPES[ex.format] || [p.clip.width || 16, p.clip.height || 9];
  const thumb = fileUrl(p.id, p.clip.thumb, p.clip.ver);
  const first = p.lines.find((l) => (l.text || '').trim());
  const sample = ex.subs === 'orig' ? (first || {}).orig : (first || {}).text;
  // fit the frame into the stage: tall formats are bounded by height, wide ones by width
  const W = vh > vw ? (380 * vw) / vh : Math.min(380, 340 * (vw / vh));
  const H = (W * vh) / vw;
  const srcAspect = (p.clip.width || 16) / (p.clip.height || 9);
  let fgH = H;
  let fgW = H * srcAspect;
  if (fgW > W) {
    fgW = W;
    fgH = W / srcAspect;
  }
  let pos = ex.subPos;
  if (pos == null) pos = ex.format === 'vertical_blur' && fgH < H * 0.8 ? Math.min(0.86, (H + fgH) / 2 / H + 0.07) : ex.format === 'vertical_crop' ? 0.74 : 0.93;
  const size = Math.max(7, Math.min(W, H) * 0.058 * (ex.subSize || 1));
  const charColor = ex.subColor === 'character' && first ? (p.characters.find((c) => c.id === first.char) || {}).color : '#fff';
  return html`<div class="frame" style=${{ width: W + 'px', height: H + 'px' }}>
    <img src=${thumb} class="frame-blur" alt="" style=${{ opacity: ex.format === 'vertical_blur' || ex.format === 'square' ? 1 : 0 }} />
    ${ex.format === 'vertical_crop'
      ? html`<img src=${thumb} class="frame-fill" alt="" />`
      : html`<img src=${thumb} class="frame-fg" alt="" style=${{ width: fgW + 'px', height: fgH + 'px' }} />`}
    ${ex.subs !== 'none' && sample && html`<div class="frame-sub" style=${{ bottom: (1 - pos) * H + 'px', fontFamily: ex.subFont, fontSize: size + 'px', color: charColor }}>
      ${ex.subs === 'both' && html`<div class="frame-sub-orig" style=${{ fontSize: size * 0.62 + 'px' }}>${first.orig}</div>`}${sample}</div>`}
  </div>`;
}

export function ExportView({ p }) {
  const s = useStore();
  const sys = s.system || {};
  const ex = p.export;
  const job = jobOf('export');
  const running = job && (job.status === 'running' || job.status === 'queued');
  const [autoPos, setAutoPos] = useState(ex.subPos == null);
  const patch = (body) => {
    patchLocal((pp) => Object.assign(pp.export, body));
    api.patch(P(p.id), { export: body }).catch(toastError);
  };
  const recorded = p.lines.filter((l) => l.take).length;
  const latest = (p.exports || [])[0];
  const make = () => api.post(P(p.id, '/export'), {}).catch(toastError);
  const reveal = (file) => api.post('/api/open-folder', { file }).catch(toastError);

  return html`<div class="page export">
    <div class="export-grid">
      <section class="pane">
        <div class="pane-head"><h3>Video ayarları</h3></div>
        <div class="pane-body">
          <div class="section-label">Biçim</div>
          <div class="formats" role="radiogroup">${Object.entries(sys.formats || {}).map(
            ([k, label]) => html`<button key=${k} role="radio" aria-checked=${ex.format === k} class=${cls('formatcard', ex.format === k && 'on')} onClick=${() => patch({ format: k })}>
              <span class=${'shape shape-' + k}></span><span>${label}</span></button>`
          )}</div>
          <${Field} label="Altyazı"><${Select} value=${ex.subs} onChange=${(v) => patch({ subs: v })} options=${Object.entries(sys.subs || {})} /></${Field}>
          ${ex.subs !== 'none' && html`
            <div class="row2">
              <${Field} label="Yazı tipi"><${Select} value=${ex.subFont} onChange=${(v) => patch({ subFont: v })} options=${FONTS.map((f) => [f, f])} /></${Field}>
              <${Field} label="Renk"><${Select} value=${ex.subColor || 'white'} onChange=${(v) => patch({ subColor: v })} options=${[['white', 'Beyaz (klasik)'], ['character', 'Karakter renginde']]} /></${Field}>
            </div>
            <${Field} label=${`Yazı boyutu: %${Math.round((ex.subSize || 1) * 100)}`}>
              <${Range} min=${0.6} max=${1.8} step=${0.05} value=${ex.subSize || 1} onInput=${(v) => patch({ subSize: v })} />
            </${Field}>
            <${Toggle} checked=${autoPos} onChange=${(v) => { setAutoPos(v); patch({ subPos: v ? null : 0.8 }); }} label="Altyazı konumunu otomatik ayarla" />
            ${!autoPos && html`<${Field} label="Altyazı yüksekliği">
              <${Range} min=${0.3} max=${0.97} step=${0.01} value=${ex.subPos ?? 0.8} onInput=${(v) => patch({ subPos: v })} />
            </${Field}>`}`}
          <${Toggle} checked=${ex.credits} onChange=${(v) => patch({ credits: v })} label="Sonda seslendirenleri göster" />
          ${ex.credits && html`<${Field} label="Jenerik yazısı" hint="Boş bırakırsan kayıtlardan otomatik yazılır (ör. Polat: Ahmet).">
            <input class="input" value=${ex.creditsText || ''} placeholder="ör. Dublaj: @kankalar" onChange=${(e) => patch({ creditsText: e.target.value })} />
          </${Field}>`}
          <${Field} label="Kalite"><${Select} value=${ex.quality} onChange=${(v) => patch({ quality: v })} options=${[['high', 'Yüksek (önerilen)'], ['normal', 'Normal (daha küçük dosya)']]} /></${Field}>
        </div>
      </section>
      <section class="pane export-side">
        <div class="pane-head"><h3>Önizleme</h3><span class="grow"></span><span class="muted small">${recorded}/${p.lines.length} satır dublajlı</span></div>
        <div class="pane-body">
          <div class="stage"><${FramePreview} p=${p} ex=${ex} /></div>
          ${recorded < p.lines.length && html`<p class="muted small">Kaydı olmayan satırlarda orijinal ses çalar (Mikser'den kapatabilirsin).</p>`}
          <${Btn} kind="primary big" icon="film" onClick=${make} disabled=${running}>${running ? 'Oluşturuluyor…' : 'Videoyu oluştur'}</${Btn}>
          ${job && (running || job.status === 'error') && html`<div style=${{ marginTop: '12px' }}><${JobPanel} bare job=${job} /></div>`}
        </div>
      </section>
    </div>
    ${latest && html`<section class="panel result" key=${latest.file}>
      <div class="panel-head"><h2>Son video</h2><span class="muted small">${timeAgo(latest.created)}</span></div>
      <div class="result-grid">
        <video class=${'result-video ' + (latest.height > latest.width ? 'tall' : '')} src=${'/api/exports/' + encodeURIComponent(latest.file)} controls playsinline preload="metadata"></video>
        <div>
          <div class="tc muted small" style=${{ marginBottom: '12px' }}>${latest.width}×${latest.height} · ${fmtTime(latest.duration, 0)} · ${fmtBytes(latest.size)}</div>
          <div class="toolbar">
            <a class="btn btn-primary" href=${'/api/exports/' + encodeURIComponent(latest.file) + '?dl=1'}><${Icon} name="download" size=${16} /><span>İndir</span></a>
            <${Btn} icon="folder" onClick=${() => reveal(latest.file)}>Klasörde göster</${Btn}>
          </div>
          <p class="muted small" style=${{ marginTop: '12px' }}>TikTok'a yüklemek için videoyu telefonuna at (WhatsApp, Google Drive, kablo…) ya da TikTok'un web sitesinden doğrudan yükle.</p>
          <details><summary class="muted small">Diğer dosyalar</summary>
            <div class="toolbar" style=${{ marginTop: '8px' }}>
              <a class="btn btn-sm" href=${P(p.id, '/srt?which=dub')}>Altyazı (.srt)</a>
              <a class="btn btn-sm" href=${P(p.id, '/srt?which=orig')}>Orijinal altyazı (.srt)</a>
              <a class="btn btn-sm" href=${P(p.id, '/audio?mode=dub')}>Sadece ses (.wav)</a>
            </div>
          </details>
          ${(p.exports || []).length > 1 && html`<details><summary class="muted small">Önceki videolar (${p.exports.length - 1})</summary>
            ${p.exports.slice(1).map((e) => html`<div class="row small" style=${{ padding: '4px 0' }}><span class="grow mono">${e.file}</span><a href=${'/api/exports/' + encodeURIComponent(e.file) + '?dl=1'}>indir</a></div>`)}
          </details>`}
        </div>
      </div>
    </section>`}
  </div>`;
}
