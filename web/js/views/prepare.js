import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P } from '../api.js';
import { Btn, Field, Icon, JobPanel, Select } from '../components.js';
import { go, jobOf, toastError, useStore } from '../state.js';
import { clamp, fmtTime, parseTime } from '../util.js';

const running = (j) => j && (j.status === 'running' || j.status === 'queued');

function TimeInput({ value, onChange, label }) {
  const [txt, setTxt] = useState(fmtTime(value, 1));
  useEffect(() => setTxt(fmtTime(value, 1)), [value]);
  return html`<input class="input timeinput" value=${txt} aria-label=${label} onInput=${(e) => setTxt(e.target.value)}
    onBlur=${() => { const t = parseTime(txt); if (t != null) onChange(t); else setTxt(fmtTime(value, 1)); }}
    onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />`;
}

function RangeBar({ duration, range, setRange, current, onSeek }) {
  const ref = useRef(null);
  const toT = (x) => {
    const r = ref.current.getBoundingClientRect();
    return clamp(((x - r.left) / r.width) * duration, 0, duration);
  };
  const drag = (which) => (e) => {
    e.stopPropagation();
    const el = e.currentTarget;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {}
    const move = (ev) => {
      const t = toT(ev.clientX);
      setRange((r) => (which === 0 ? [Math.min(t, r[1] - 1), r[1]] : [r[0], Math.max(t, r[0] + 1)]));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', () => el.removeEventListener('pointermove', move), { once: true });
  };
  const pct = (t) => (t / duration) * 100 + '%';
  return html`<div class="rangebar" ref=${ref} onPointerDown=${(e) => onSeek(toT(e.clientX))}>
    <div class="rangebar-sel" style=${{ left: pct(range[0]), width: (100 * (range[1] - range[0])) / duration + '%' }}></div>
    <div class="rangebar-cur" style=${{ left: pct(current) }}></div>
    <div class="rangebar-h" style=${{ left: pct(range[0]) }} onPointerDown=${drag(0)} title="Başlangıç"></div>
    <div class="rangebar-h" style=${{ left: pct(range[1]) }} onPointerDown=${drag(1)} title="Bitiş"></div>
  </div>`;
}

export function PrepareView({ p }) {
  const s = useStore();
  const sys = s.system || {};
  const imp = jobOf('import');
  const prep = jobOf('prepare');
  const video = useRef(null);
  const info = p.source && p.source.info;
  const dur = info ? info.duration : 0;
  const [range, setRange] = useState(() => [p.trim ? p.trim.start : 0, p.trim ? p.trim.end : dur]);
  const [cur, setCur] = useState(0);
  const [opts, setOpts] = useState(() => ({ ...p.settings, translator: p.settings.translator || sys.settings?.translator || 'google' }));
  const stopAt = useRef(null);

  useEffect(() => {
    // the page can open while the video is still being read: take the selection once the duration is known
    if (!info) return;
    setRange((r) => (r[1] > 0 && r[1] <= dur + 0.01 ? r : [p.trim ? p.trim.start : 0, p.trim && p.trim.end > 0 ? p.trim.end : dur]));
  }, [dur]);

  if (running(imp) || (!p.source && !(imp && imp.status === 'error')))
    return html`<div class="page narrow"><${JobPanel} job=${imp || { title: 'Video okunuyor', status: 'running', progress: 0, message: 'Bekleniyor…' }} /></div>`;
  if (!p.source)
    return html`<div class="page narrow"><${JobPanel} job=${imp} /><${Btn} icon="back" onClick=${() => go('')}>Projelere dön</${Btn}></div>`;

  if (running(prep) || p.status === 'preparing')
    return html`<div class="page"><div class="processing">
      <div class="processing-head">
        <div class="processing-thumb">${p.clip && p.clip.thumb ? html`<img src=${fileUrl(p.id, p.clip.thumb, p.clip.ver)} alt="" />` : null}</div>
        <div><h1>Sahne hazırlanıyor</h1>
          <p>İlk seferde yapay zeka modelleri indiği için birkaç dakika sürebilir. Sonrakiler çok daha hızlı.</p></div>
      </div>
      <div class="panel"><${JobPanel} bare job=${prep} onCancel=${prep && (() => api.post(`/api/jobs/${prep.id}/cancel`))} /></div>
    </div></div>`;

  const src = fileUrl(p.id, p.source.proxy || p.source.file);
  const set = (k) => (v) => setOpts((o) => ({ ...o, [k]: v }));
  const seek = (t) => {
    if (video.current) video.current.currentTime = t;
    setCur(t);
  };
  const playSel = () => {
    const v = video.current;
    v.currentTime = range[0];
    stopAt.current = range[1];
    v.play();
  };
  const start = async () => {
    if (p.status === 'ready' && p.lines.some((l) => l.takes && l.takes.length) && !confirm('Yeniden hazırlarsan mevcut satırlar ve tüm kayıtlar silinir. Devam edilsin mi?')) return;
    try {
      await api.post(P(p.id, '/prepare'), { start: range[0], end: range[1], ...opts, speakers: Number(opts.speakers) || 0 });
    } catch (e) {
      toastError(e);
    }
  };
  const langs = sys.languages || [];
  const long = range[1] - range[0] > 300;

  return html`<div class="page prepare">
    ${prep && prep.status === 'error' && html`<${JobPanel} job=${prep} />`}
    ${p.status === 'ready' && html`<div class="alert ok"><${Icon} name="check" /> Sahne hazır. <a href=${`#/p/${p.id}/script`}>Senaryoya geç</a>
      <span class="muted">Farklı bir kısım seçip yeniden hazırlayabilirsin.</span></div>`}
    ${prep && prep.status === 'done' && prep.result && prep.result.warning && html`<div class="alert warn"><${Icon} name="alert" /> ${prep.result.warning}</div>`}
    <div class="prepare-grid">
      <section class="pane viewer-pane">
        <div class="videopane srcwrap">
          <video ref=${video} class="srcvideo" src=${src} controls preload="metadata"
            onTimeUpdate=${(e) => {
              setCur(e.target.currentTime);
              if (stopAt.current != null && e.target.currentTime >= stopAt.current) {
                e.target.pause();
                stopAt.current = null;
              }
            }}></video>
        </div>
        <div class="trim">
          <${RangeBar} duration=${dur} range=${range} setRange=${setRange} current=${cur} onSeek=${seek} />
          <div class="trimrow">
            <div class="trimcell"><span class="field-label">Başlangıç</span>
              <div class="row"><${TimeInput} label="Başlangıç" value=${range[0]} onChange=${(t) => setRange([clamp(t, 0, range[1] - 1), range[1]])} />
                <${Btn} small kind="ghost" onClick=${() => setRange([Math.min(cur, range[1] - 1), range[1]])} title="Başlangıcı oynatma noktasına al">Şu an</${Btn}></div></div>
            <div class="trimcell center"><${Btn} icon="play" onClick=${playSel}>Seçimi izle</${Btn}>
              <span class="tc">Süre ${fmtTime(range[1] - range[0])}</span></div>
            <div class="trimcell right"><span class="field-label">Bitiş</span>
              <div class="row"><${Btn} small kind="ghost" onClick=${() => setRange([range[0], Math.max(cur, range[0] + 1)])} title="Bitişi oynatma noktasına al">Şu an</${Btn}>
                <${TimeInput} label="Bitiş" value=${range[1]} onChange=${(t) => setRange([range[0], clamp(t, range[0] + 1, dur)])} /></div></div>
          </div>
          ${long && html`<div class="alert warn small" style=${{ margin: '12px 8px 0' }}><${Icon} name="alert" size=${16} />Seçim ${fmtTime(range[1] - range[0], 0)} uzunluğunda. TikTok için genelde 15 sn ile 3 dk arası bir sahne yeter; kısa sahne daha hızlı hazırlanır.</div>`}
        </div>
      </section>
      <section class="pane">
        <div class="pane-head"><h3>Sahne ayarları</h3></div>
        <div class="pane-body">
          <${Field} label="Videoda konuşulan dil">
            <${Select} value=${opts.srcLang || 'auto'} onChange=${set('srcLang')} options=${[['auto', 'Otomatik algıla'], ...langs]} />
          </${Field}>
          <${Field} label="Dublaj dili" hint="Aynı dili seçersen çeviri yapılmaz (Türkçe troll dublaj için ideal).">
            <${Select} value=${opts.dstLang || 'en'} onChange=${set('dstLang')} options=${langs} />
          </${Field}>
          <${Field} label="Sahnede kaç kişi konuşuyor?" hint="Biliyorsan seç; kim konuşuyor ayrımı daha doğru olur.">
            <${Select} value=${String(opts.speakers || 0)} onChange=${set('speakers')}
              options=${[['0', 'Bilmiyorum, otomatik bulsun'], ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), n + ' kişi'])]} />
          </${Field}>
          <${Field} label="Çeviri">
            <${Select} value=${opts.translator} onChange=${set('translator')} options=${[
              ['google', 'Google Çeviri (ücretsiz)'],
              ['claude', 'Claude: dublaja uygun, satır süresine sığan çeviri' + (sys.settings && !sys.settings.hasAnthropicKey ? ' (API anahtarı gerekli)' : '')],
            ]} />
          </${Field}>
          ${opts.translator === 'claude' && html`<${Field} label="Çeviri tarzı">
            <${Select} value=${opts.style || 'natural'} onChange=${set('style')} options=${Object.entries(sys.styles || {})} />
          </${Field}>`}
          ${opts.translator === 'claude' && sys.settings && !sys.settings.hasAnthropicKey && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />Claude için <a href="#/settings">Ayarlar</a>'dan API anahtarını gir. Girmezsen hazırlık yine çalışır, sadece çeviri boş kalır.</div>`}
          <div class="prep-cta">
            <${Btn} kind="primary big" icon="sparkle" onClick=${start}>${p.status === 'ready' ? 'Yeniden hazırla' : 'Sahneyi hazırla'}</${Btn}>
            <p>Konuşmalar fondan ayrılır (kuş, rüzgar gibi ortam sesleri korunur), yazıya dökülür, konuşmacılara bölünür ve çevrilir.</p>
          </div>
        </div>
      </section>
    </div>
  </div>`;
}
