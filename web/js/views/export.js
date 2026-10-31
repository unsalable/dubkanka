// Share: four steps in the order they are decided (shape, sound, subtitles, quality), the technical encode options
// (or a bit-exact copy of the source picture) closed behind one button, and a playable preview of the framing, the
// subtitles and the real mix.
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P } from '../api.js';
import { Btn, Field, Icon, JobPanel, Lamp, PlayButton, Range, Segmented, Select, TimeReadout, Toggle, usePlaying } from '../components.js';
import { buildMix, loadMixBuffers, player, takeSpan } from '../engine.js';
import { jobOf, patchLocal, toastError, useStore } from '../state.js';
import { clamp, cls, fmtBytes, fmtTime, readyTake, timeAgo } from '../util.js';

const FONTS = ['Arial Black', 'Impact', 'Arial', 'Segoe UI', 'Verdana', 'Comic Sans MS', 'Trebuchet MS', 'Georgia'];
const FORMAT_NAMES = { vertical_blur: ['9:16', 'Bulanık arka plan'], vertical_crop: ['9:16', 'Ekranı doldur'], square: ['1:1', 'Kare'], original: ['Kaynak', 'Orijinal boyut'] };
const CODECS = [['h264', 'H.264 / AVC'], ['hevc', 'H.265 / HEVC'], ['av1', 'AV1']];
const ABITRATES = [96, 128, 160, 192, 256, 320];
const LUFS = [['-14', '-14 LUFS · TikTok, YouTube'], ['-16', '-16 LUFS · Apple, podcast'], ['-23', '-23 LUFS · EBU R128 yayın']];

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
function merged(def, ex) {
  const out = { ...def };
  for (const [k, v] of Object.entries(ex || {})) out[k] = isObj(v) && isObj(def[k]) ? merged(def[k], v) : v;
  return out;
}

/** Same timing as the server's subtitle_events: the dub take when there is one, the line otherwise. */
export function subtitleEvents(p) {
  const dur = p.clip.duration;
  const out = p.lines.map((l) => {
    const t = readyTake(l);
    let s, e;
    if (t) {
      const [, a, b] = takeSpan(t);
      s = a + (t.voiceOffset || 0) - 0.05;
      e = b + 0.15;
    } else {
      s = l.start - 0.05;
      e = l.end + 0.25;
    }
    return [Math.max(0, s), Math.min(dur, e), l];
  });
  out.sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < out.length - 1; i++) if (out[i][1] > out[i + 1][0] - 0.02 && out[i + 1][0] > out[i][0] + 0.3) out[i][1] = out[i + 1][0] - 0.02;
  return out;
}

function credits(p, ex) {
  if ((ex.creditsText || '').trim()) return ex.creditsText.trim();
  const names = {};
  for (const l of p.lines) {
    const t = readyTake(l);
    if (t && t.source !== 'tts' && t.by) (names[l.char] = names[l.char] || new Set()).add(t.by);
  }
  const parts = p.characters.filter((c) => names[c.id]).map((c) => `${c.name}: ${[...names[c.id]].join(', ')}`);
  return parts.length ? 'Seslendirenler — ' + parts.join('  •  ') : '';
}

/** Output size and where the scene sits in it (export._geometry). */
function geometry(fmt, w0, h0, height) {
  const even = (x) => Math.max(2, Math.round(x / 2) * 2);
  if (fmt === 'original') {
    const s = height === 'source' ? 1 : height / Math.min(w0, h0);
    return { W: even(w0 * s), H: even(h0 * s), box: [0, 0, even(w0 * s), even(h0 * s)] };
  }
  const short = height === 'source' ? 1080 : height;
  const W = short;
  const H = fmt === 'square' ? short : even((short * 16) / 9);
  if (fmt === 'vertical_crop') return { W, H, box: [0, 0, W, H] };
  const s = Math.min(W / w0, H / h0);
  const fw = Math.floor((w0 * s) / 2) * 2;
  const fh = Math.floor((h0 * s) / 2) * 2;
  return { W, H, box: [(W - fw) / 2, (H - fh) / 2, fw, fh] };
}

/** The finished video in miniature: the picture framed like the export, burned subtitles, the real mix. */
function FramePlayer({ p, ex }) {
  const stage = useRef(null);
  const canvas = useRef(null);
  const video = useRef(null);
  const sub = useRef(null);
  const cred = useRef(null);
  const [size, setSize] = useState({ w: 360, h: 640 });
  const [bufs, setBufs] = useState(null);
  const playing = usePlaying();
  const dur = p.clip.duration;
  const w0 = p.clip.width || 1280;
  const h0 = p.clip.height || 720;
  const g = geometry(ex.format, w0, h0, ex.video.height);
  const scale = size.w / g.W;
  const events = subtitleEvents(p);
  const creditText = ex.credits ? credits(p, ex) : '';
  const chars = Object.fromEntries(p.characters.map((c) => [c.id, c]));
  const copying = ex.video.mode === 'copy';

  // fit the output frame into the stage (before the first paint, so the frame does not animate in from a default)
  useLayoutEffect(() => {
    const el = stage.current;
    const fit = () => {
      const aw = el.clientWidth - 24;
      const ah = el.clientHeight - 24;
      const r = g.W / g.H;
      const w = Math.min(aw, ah * r);
      setSize({ w: Math.floor(w), h: Math.floor(w / r) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [g.W, g.H]);

  useEffect(() => {
    let alive = true;
    loadMixBuffers(p).then((b) => alive && setBufs(b)).catch(toastError);
    return () => (alive = false);
  }, [p.stems.ver, p.lines.map((l) => (readyTake(l) || {}).file || '').join('|')]);

  useEffect(() => {
    const v = video.current;
    const prev = player.video;
    player.attachVideo(v);
    return () => {
      player.stop();
      player.attachVideo(prev && prev.isConnected ? prev : null);
    };
  }, []);

  // draw the frame and place the subtitle for the current time
  useEffect(() => {
    const c = canvas.current;
    const v = video.current;
    if (!c || !v) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    const ctx = c.getContext('2d');
    const k = c.width / g.W;
    const draw = () => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, c.width, c.height);
      const vw = v.videoWidth;
      const vh = v.videoHeight;
      if (vw) {
        const fit = (cover) => {
          const s = cover ? Math.max(c.width / vw, c.height / vh) : Math.min(c.width / vw, c.height / vh);
          return [(c.width - vw * s) / 2, (c.height - vh * s) / 2, vw * s, vh * s];
        };
        if (ex.format === 'vertical_blur' || ex.format === 'square') {
          ctx.filter = `blur(${Math.max(1, 26 * k * (g.W / 1080))}px) brightness(0.86)`;
          ctx.drawImage(v, ...fit(true));
          ctx.filter = 'none';
          ctx.drawImage(v, g.box[0] * k, g.box[1] * k, g.box[2] * k, g.box[3] * k);
        } else ctx.drawImage(v, ...fit(ex.format === 'vertical_crop'));
      }
      const t = Math.max(0, player.time);
      const ev = events.find(([s, e]) => t >= s && t <= e);
      if (sub.current) {
        const l = ev && ev[2];
        const dub = l && (ex.subs === 'orig' ? l.orig : l.text);
        sub.current.hidden = !(ex.subs !== 'none' && dub);
        if (!sub.current.hidden) {
          sub.current.querySelector('.fs-main').textContent = dub;
          const o = sub.current.querySelector('.fs-orig');
          o.textContent = ex.subs === 'both' ? l.orig : '';
          o.hidden = ex.subs !== 'both';
          sub.current.style.color = ex.subColor === 'character' && chars[l.char] ? chars[l.char].color : '#fff';
        }
      }
      if (cred.current) cred.current.hidden = !(creditText && t >= dur - 3.5 && ex.subMode === 'burn' && !copying);
    };
    draw();
    const off = player.on(draw);
    v.addEventListener('seeked', draw);
    v.addEventListener('loadeddata', draw);
    return () => {
      off();
      v.removeEventListener('seeked', draw);
      v.removeEventListener('loadeddata', draw);
    };
  }, [size.w, size.h, ex.format, ex.subs, ex.subColor, ex.subMode, ex.video.height, creditText, events.length, p.rev]);

  const toggle = () => {
    if (player.playing) return player.stop();
    if (!bufs) return;
    const from = player.time >= dur - 0.05 ? 0 : Math.max(0, player.time);
    player.play({ from, to: dur, ...buildMix(p, bufs, ex.mix) });
  };
  useEffect(() => {
    if (player.playing && bufs) player.play({ from: player.time, to: dur, ...buildMix(p, bufs, ex.mix) });
  }, [ex.mix]);

  // subtitle size and height exactly like build_ass, scaled to the preview
  const fontPx = Math.max(24, Math.floor(Math.min(g.W, g.H) * 0.058 * (ex.subSize || 1)));
  let pos = ex.subPos;
  if (pos == null) {
    if (ex.format === 'vertical_blur' && g.box[3] < g.H * 0.8) pos = Math.min(0.86, (g.box[1] + g.box[3]) / g.H + (2.6 * fontPx) / g.H);
    else pos = ex.format === 'vertical_crop' ? 0.74 : 0.93;
  }
  const soft = ex.subMode === 'soft' || copying;
  const subStyle = soft
    ? { bottom: size.h * 0.06 + 'px', fontSize: Math.max(11, size.h * 0.035) + 'px' }
    : { bottom: Math.max(10, g.H * (1 - pos)) * scale + 'px', fontFamily: `'${ex.subFont}'`, fontSize: fontPx * scale + 'px',
        WebkitTextStroke: `${Math.max(1, fontPx * 0.09 * scale)}px #000` };

  const seek = (t) => player.playing ? player.play({ from: t, to: dur, ...buildMix(p, bufs, ex.mix) }) : player.seek(t);
  return html`<div class="fp">
    <div class="fp-stage" ref=${stage}>
      <div class="frame" style=${{ width: size.w + 'px', height: size.h + 'px' }}>
        <video ref=${video} src=${fileUrl(p.id, p.clip.preview, p.clip.ver)} muted playsinline preload="auto" crossorigin="anonymous"></video>
        <canvas ref=${canvas} style=${{ width: size.w + 'px', height: size.h + 'px' }}></canvas>
        <div class=${cls('frame-sub', soft && 'soft')} ref=${sub} style=${subStyle} hidden><div class="fs-orig" hidden></div><div class="fs-main"></div></div>
        <div class="frame-credits" ref=${cred} hidden style=${{ top: g.H * 0.06 * scale + 'px', fontSize: fontPx * 0.55 * scale + 'px' }}>${creditText}</div>
      </div>
    </div>
    <div class="transport">
      <${PlayButton} playing=${playing} onClick=${toggle} disabled=${!bufs} title="Önizlemeyi oynat (Boşluk)" />
      <${TimeReadout} duration=${dur} />
      <${Scrub} dur=${dur} onSeek=${seek} />
      <span class="tc dim small">${g.W}×${g.H}</span>
    </div>
  </div>`;
}

function Scrub({ dur, onSeek }) {
  const ref = useRef(null);
  useEffect(() => {
    const sync = () => {
      if (ref.current && document.activeElement !== ref.current) {
        ref.current.value = Math.max(0, player.time);
        ref.current.style.setProperty('--p', (clamp(player.time / dur, 0, 1) * 100) + '%');
      }
    };
    sync();
    return player.on(sync);
  }, [dur]);
  return html`<input ref=${ref} class="scrub grow" type="range" min="0" max=${dur} step="0.01" defaultValue="0"
    onInput=${(e) => { e.target.style.setProperty('--p', (e.target.value / dur) * 100 + '%'); onSeek(Number(e.target.value)); }} />`;
}

function SourceInfo({ info }) {
  if (!info || !info.source) return null;
  const s = info.source;
  const k = info.copy.keyframe;
  return html`<div class="srcinfo">
    <div class="seclabel">Kaynak dosya</div>
    <div class="mono small srcline">${s.width}×${s.height} · ${s.fps} fps · ${(s.vcodec || '').toUpperCase()} ${s.profile || ''} · ${s.pixfmt || ''}${s.bitrate ? ` · ${(s.bitrate / 1e6).toFixed(1)} Mb/s` : ''}</div>
    <div class="mono small srcline dim">${(s.acodec || 'ses yok').toUpperCase()}${s.abitrate ? ` ${Math.round(s.abitrate / 1000)}k` : ''}${s.sampleRate ? ` · ${s.sampleRate / 1000} kHz` : ''} · .${s.container}</div>
    ${k && html`<div class="small srcline">${k.exact
      ? html`<${Lamp} tone="ok">Kesim bir anahtar kareye denk geliyor: kopya birebir başlar.</${Lamp}>`
      : html`<${Lamp} tone="warn">Kopya ${k.offset.toFixed(2)} sn önceki anahtar kareden (${fmtTime(k.actual, 2)}) başlar; o kısımda orijinal ses çalar.</${Lamp}>`}</div>`}
  </div>`;
}

// Plain words for the presets; their technical summary stays in the tooltip and in "Teknik ayarlar".
const PRESET_TEXT = {
  tiktok: 'Telefonda net, hızlı yüklenir',
  high: 'En temiz görüntü, daha büyük dosya',
  small: "WhatsApp'tan göndermeye uygun",
  copy: 'Görüntü hiç değişmez, sadece ses eklenir',
};
const SUB_CHOICES = [['none', 'Yok'], ['dub', 'Dublaj'], ['orig', 'Orijinal'], ['both', 'İkisi']];

/** One numbered step of the share recipe: first the shape, then the sound, then the subtitles, then the quality. */
function Step({ n, title, hint, children }) {
  return html`<section class="xstep" style=${{ '--i': n }}>
    <div class="xstep-head"><span class="xstep-n">${n}</span><h3>${title}</h3>${hint && html`<span class="xstep-hint">${hint}</span>`}</div>
    <div class="xstep-body">${children}</div>
  </section>`;
}

export function ExportView({ p }) {
  const s = useStore();
  const sys = s.system || {};
  const ex = merged(sys.exportDefaults || {}, p.export);
  const v = ex.video || {};
  const a = ex.audio || {};
  const job = jobOf('export');
  const running = job && (job.status === 'running' || job.status === 'queued');
  const [info, setInfo] = useState(null);
  const [adv, setAdv] = useState(false); // technical settings stay closed until asked for
  const [style, setStyle] = useState(false);
  const encoders = (sys.encoders || []).filter((e) => e.codec === v.codec);
  const qr = (sys.qualityRange || {})[v.codec] || [10, 40, 20];
  const copying = v.mode === 'copy';
  const unseparated = p.stems && p.stems.separated === false;

  useEffect(() => {
    api.get(P(p.id, '/export/info')).then(setInfo).catch(() => {});
  }, [p.id, ex.container, ex.subs, ex.subMode]);
  useEffect(() => {
    if (unseparated && ex.mix === 'clean') patch({ mix: 'dub' }); // a scene without separation has no voice-free sound
  }, [unseparated]);

  const patch = (body) => {
    patchLocal((pp) => {
      pp.export = merged(merged(sys.exportDefaults || {}, pp.export), body);
    });
    api.patch(P(p.id), { export: body }).catch(toastError);
  };
  const tech = (body) => patch({ ...body, preset: 'custom' });
  const applyPreset = (id) => {
    const pr = (sys.exportPresets || {})[id];
    if (!pr) return;
    // TikTok means 9:16; the other presets keep the chosen framing (stream copy forces the original size itself)
    const framing = id === 'tiktok' && !ex.format.startsWith('vertical') ? { format: 'vertical_blur' } : {};
    patch({ ...pr.settings, ...framing, preset: id });
  };
  const setCodec = (c) => {
    const [, , q] = (sys.qualityRange || {})[c] || [0, 0, 20];
    tech({ video: { codec: c, encoder: 'auto', quality: q, pixfmt: c === 'h264' ? 'yuv420p' : v.pixfmt } });
  };
  const make = () => api.post(P(p.id, '/export'), {}).catch(toastError);
  const reveal = (file) => api.post('/api/open-folder', { file }).catch(toastError);
  const recorded = p.lines.filter((l) => l.take).length;
  const latest = (p.exports || [])[0];
  const problem = info && info.problem;
  const est = v.rc !== 'crf' && !copying ? ((v.bitrate * 1e6 + a.bitrate * 1000) * p.clip.duration) / 8 : null;
  const fpsOpts = (sys.fpsOptions || ['source']).map((f) => [String(f), f === 'source' ? `Kaynak (${Math.min(60, p.clip.fps || 30)} fps)` : `${f} fps`]);
  const hOpts = (sys.heightOptions || ['source']).map((h) => [String(h), h === 'source' ? (ex.format === 'original' ? `Kaynak (${Math.min(p.clip.width || 0, p.clip.height || 0)}p)` : 'Standart (1080p)') : `${h}p`]);
  const presets = sys.exportPresets || {};
  const burn = ex.subMode === 'burn' && !copying;
  const techLine = `${copying ? 'Görüntü: kaynaktan kopya' : `${(CODECS.find((c) => c[0] === v.codec) || [])[1]} · ${v.rc === 'crf' ? 'CRF ' + v.quality : v.bitrate + ' Mb/s ' + v.rc.toUpperCase()} · ${v.preset}`}`
    + ` · ${(sys.audioCodecs || {})[a.codec] || a.codec}${['aac', 'libopus'].includes(a.codec) ? ' ' + a.bitrate + 'k' : ''} · ${ex.container.toUpperCase()}${est ? ` · ~${fmtBytes(est)}` : ''}`;
  const plainLine = [FORMAT_NAMES[ex.format] ? `${FORMAT_NAMES[ex.format][0]} ${FORMAT_NAMES[ex.format][1].toLowerCase()}` : ex.format,
    { dub: 'dublaj sesi', clean: 'konuşmasız', original: 'orijinal ses' }[ex.mix],
    ex.subs === 'none' ? 'altyazısız' : `altyazı: ${(SUB_CHOICES.find((c) => c[0] === ex.subs) || [])[1].toLowerCase()}`,
    ex.preset === 'custom' ? 'özel ayar' : (presets[ex.preset] || {}).label].filter(Boolean).join(' · ');

  return html`<div class="page export">
    <div class="ws export-grid">
      <section class="pane export-settings">
        <div class="pane-scroll xsteps">
          <${Step} n=${1} title="Biçim" hint="Videonun şekli">
            <div class="choices formats" role="radiogroup">${Object.keys(FORMAT_NAMES).map((k) => html`<button key=${k} role="radio" aria-checked=${ex.format === k}
              class=${cls('choice formatcard', ex.format === k && 'on')} disabled=${copying && k !== 'original'} title=${copying && k !== 'original' ? 'Kaynak kopyasında görüntü değişmez' : ''}
              onClick=${() => patch({ format: k })}><span class=${'shape shape-' + k}></span><b>${FORMAT_NAMES[k][0]}</b><small>${FORMAT_NAMES[k][1]}</small></button>`)}</div>
          </${Step}>

          <${Step} n=${2} title="Ses">
            <${Segmented} value=${ex.mix} onChange=${(m) => patch({ mix: m })}
              options=${[['dub', 'Dublaj'], ...(unseparated ? [] : [['clean', 'Konuşmasız']]), ['original', 'Orijinal']]} />
            ${ex.mix === 'clean' && html`<p class="xnote">Sadece müzik, efekt ve ortam sesleri: kendi seslendirmen için.</p>`}
          </${Step}>

          <${Step} n=${3} title="Altyazı">
            <${Segmented} value=${ex.subs} onChange=${(x) => patch({ subs: x })} options=${SUB_CHOICES} />
            ${ex.subs !== 'none' && html`<div class="xsub">
              <${Toggle} checked=${burn} disabled=${copying} onChange=${(on) => patch({ subMode: on ? 'burn' : 'soft' })}
                label=${html`<span class="toggle-text">Videonun üstüne yazılsın<small>${burn ? 'TikTok ve her oynatıcıda görünür.' : 'Ayrı iz: oynatıcıda açılıp kapanır, TikTok göstermez.'}</small></span>`} />
              ${burn && html`<button class=${cls('xdisclose', style && 'open')} aria-expanded=${style} onClick=${() => setStyle(!style)}>
                <${Icon} name="chevron" size=${13} />Yazı stili <span class="dim">${ex.subFont} · %${Math.round((ex.subSize || 1) * 100)}</span></button>
                ${style && html`<div class="xstyle">
                  <div class="row2">
                    <${Field} label="Yazı tipi"><${Select} value=${ex.subFont} onChange=${(x) => patch({ subFont: x })} options=${FONTS.map((f) => [f, f])} /></${Field}>
                    <${Field} label="Renk"><${Select} value=${ex.subColor || 'white'} onChange=${(x) => patch({ subColor: x })} options=${[['white', 'Beyaz'], ['character', 'Karakter renginde']]} /></${Field}>
                  </div>
                  <${Field} label=${html`Boyut <span class="tc">%${Math.round((ex.subSize || 1) * 100)}</span>`}>
                    <${Range} min=${0.6} max=${1.8} step=${0.05} value=${ex.subSize || 1} onInput=${(x) => patch({ subSize: x })} />
                  </${Field}>
                  <${Toggle} checked=${ex.subPos == null} onChange=${(on) => patch({ subPos: on ? null : 0.8 })} label="Yüksekliği otomatik ayarla" />
                  ${ex.subPos != null && html`<${Field} label="Yükseklik"><${Range} min=${0.3} max=${0.97} step=${0.01} value=${ex.subPos} onInput=${(x) => patch({ subPos: x })} /></${Field}>`}
                </div>`}`}
            </div>`}
            ${burn && html`<div class="xsub"><${Toggle} checked=${ex.credits} onChange=${(x) => patch({ credits: x })} label="Sonda seslendirenler yazsın" />
              ${ex.credits && html`<input class="input" value=${ex.creditsText || ''} placeholder="Boş bırakırsan kayıtlardan yazılır (ör. Cengo: Melih)" onChange=${(e) => patch({ creditsText: e.target.value })} />`}</div>`}
          </${Step}>

          <${Step} n=${4} title="Kalite">
            <div class="choices presets" role="radiogroup">
              ${Object.entries(presets).map(([id, pr]) => html`<button key=${id} role="radio" aria-checked=${ex.preset === id} title=${pr.summary}
                class=${cls('choice', ex.preset === id && 'on')} onClick=${() => applyPreset(id)}>
                <b>${pr.label}${id === 'tiktok' ? html` <span class="xrec">önerilen</span>` : ''}</b><small>${PRESET_TEXT[id] || pr.summary}</small></button>`)}
            </div>
            ${ex.preset === 'custom' && html`<p class="xnote">Özel: teknik ayarlarda değiştirdiklerin kullanılıyor. Bir hazır ayar seçersen onlar geri gelir.</p>`}
          </${Step}>

          <section class=${cls('xadv', adv && 'open')}>
            <button class="xadv-head" aria-expanded=${adv} onClick=${() => setAdv(!adv)}>
              <${Icon} name="sliders" size=${16} /><span class="grow"><b>Teknik ayarlar</b><span class="small dim">Codec, kodlayıcı, bit hızı, ses yüksekliği, kapsayıcı</span></span>
              <${Icon} name="chevron" size=${15} class="chev" /></button>
            ${adv && html`<div class="xadv-body">
              <${Field} label="Görüntü akışı">
                <${Segmented} value=${v.mode} onChange=${(m) => tech(m === 'copy' ? { video: { mode: 'copy' }, format: 'original', subMode: 'soft' } : { video: { mode: 'encode' } })}
                  options=${[['encode', 'Yeniden kodla'], ['copy', 'Kaynaktan kopyala (-c:v copy)']]} />
              </${Field}>
              ${copying
                ? html`<p class="field-hint">Görüntü bitlerine dokunulmaz: kaynak videonun kendi kodlaması aynen kalır, sadece yeni ses eklenir. Çözünürlük, kare hızı ve codec kaynaktaki gibidir.</p>`
                : html`
                <div class="row2">
                  <${Field} label="Codec"><${Select} value=${v.codec} onChange=${setCodec} options=${CODECS} /></${Field}>
                  <${Field} label="Kodlayıcı"><${Select} value=${v.encoder} onChange=${(x) => tech({ video: { encoder: x } })}
                    options=${[['auto', 'Otomatik (en iyisi)'], ...encoders.map((e) => [e.id, `${e.label} · ${e.id}`])]} /></${Field}>
                </div>
                <${Field} label="Hız kontrolü" hint=${v.rc === 'crf' ? 'Sabit kalite: dosya boyutu sahneye göre değişir.' : v.rc === 'vbr' ? 'Ortalama bit hızı, karmaşık sahnelere daha fazla.' : 'Sabit bit hızı: boyut kesin, kalite değişir.'}>
                  <${Segmented} value=${v.rc} onChange=${(x) => tech({ video: { rc: x } })} options=${[['crf', 'CRF / CQ'], ['vbr', 'VBR'], ['cbr', 'CBR']]} />
                </${Field}>
                ${v.rc === 'crf'
                  ? html`<${Field} label=${html`Kalite <span class="tc">${v.codec === 'h264' ? 'CRF' : 'CRF/CQ'} ${v.quality}</span>`} hint="Düşük değer: daha kaliteli, daha büyük dosya. 18 gözle kayıpsıza yakındır.">
                      <${Range} min=${qr[0]} max=${qr[1]} step=${1} value=${v.quality} onChange=${(x) => tech({ video: { quality: x } })} />
                    </${Field}>`
                  : html`<${Field} label="Bit hızı (Mb/s)"><input class="input mono" type="number" min="0.5" max="200" step="0.5" value=${v.bitrate}
                      onChange=${(e) => tech({ video: { bitrate: Number(e.target.value) } })} /></${Field}>`}
                <div class="row2">
                  <${Field} label="Hız / verim (preset)" hint="Yavaş: aynı boyutta daha temiz görüntü.">
                    <${Select} value=${v.preset} onChange=${(x) => tech({ video: { preset: x } })} options=${(sys.encoderPresets || ['medium']).map((x) => [x, x])} />
                  </${Field}>
                  <${Field} label="Kare hızı"><${Select} value=${String(v.fps)} onChange=${(x) => tech({ video: { fps: x === 'source' ? 'source' : Number(x) } })} options=${fpsOpts} /></${Field}>
                </div>
                <div class="row2">
                  <${Field} label="Çözünürlük"><${Select} value=${String(v.height)} onChange=${(x) => tech({ video: { height: x === 'source' ? 'source' : Number(x) } })} options=${hOpts} /></${Field}>
                  <${Field} label="Renk derinliği"><${Select} value=${v.pixfmt} onChange=${(x) => tech({ video: { pixfmt: x } })}
                    options=${[['yuv420p', '8-bit · yuv420p'], ...(v.codec === 'h264' ? [] : [['yuv420p10le', '10-bit · yuv420p10le']])]} /></${Field}>
                </div>
                <${Field} label=${html`Anahtar kare aralığı (GOP) <span class="tc">${v.gop} sn</span>`} hint="Kısa aralık: videoda ileri sarma daha akıcı, dosya biraz büyür.">
                  <${Range} min=${0.5} max=${10} step=${0.5} value=${v.gop} onChange=${(x) => tech({ video: { gop: x } })} />
                </${Field}>`}
              <div class="seclabel">Ses kodlama</div>
              <div class="row2">
                <${Field} label="Codec"><${Select} value=${a.codec} onChange=${(x) => tech({ audio: { codec: x } })} options=${Object.entries(sys.audioCodecs || {})} /></${Field}>
                ${['aac', 'libopus'].includes(a.codec)
                  ? html`<${Field} label="Bit hızı"><${Select} value=${String(a.bitrate)} onChange=${(x) => tech({ audio: { bitrate: Number(x) } })} options=${ABITRATES.map((b) => [String(b), b + ' kb/s'])} /></${Field}>`
                  : html`<${Field} label="Örnekleme"><${Select} value=${String(a.sampleRate)} onChange=${(x) => tech({ audio: { sampleRate: Number(x) } })} options=${[['48000', '48 kHz'], ['44100', '44.1 kHz']]} /></${Field}>`}
              </div>
              <${Toggle} checked=${a.loudnorm} onChange=${(x) => tech({ audio: { loudnorm: x } })} label="Ses yüksekliğini normalize et (EBU R128, iki geçiş)" />
              ${a.loudnorm && html`<${Select} value=${String(a.lufs)} onChange=${(x) => tech({ audio: { lufs: Number(x) } })} options=${LUFS} />`}
              <div class="seclabel">Kapsayıcı</div>
              <${Segmented} value=${ex.container} onChange=${(x) => tech({ container: x })} options=${Object.keys(sys.containers || { mp4: 1 }).map((k) => [k, k.toUpperCase()])} />
              <p class="field-hint">${(sys.containers || {})[ex.container]}</p>
              <${SourceInfo} info=${info} />
            </div>`}
          </section>
        </div>
      </section>

      <section class="pane export-side">
        <div class="pane-head"><h3>Önizleme</h3><span class="grow"></span><span class="dim small">${recorded}/${p.lines.length} satır dublajlı</span></div>
        <${FramePlayer} p=${p} ex=${ex} />
        <div class="make">
          ${problem && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />${problem}</div>`}
          <div class="make-row">
            <div class="make-sum"><span>${plainLine}</span><span class="mono dim">${techLine}</span></div>
            <${Btn} kind="primary" class="make-go" icon="film" onClick=${make} disabled=${running || !!problem}>${running ? 'Oluşturuluyor…' : 'Videoyu oluştur'}</${Btn}>
          </div>
          ${job && (running || job.status === 'error') && html`<div class="make-job"><${JobPanel} bare job=${job} /></div>`}
        </div>
      </section>
    </div>
    ${latest && html`<section class="results" key=${latest.file}>
      <div class="results-head"><h2>Videolar</h2><span class="count tc">${p.exports.length}</span><span class="grow"></span>
        <${Btn} small kind="ghost" icon="folder" onClick=${() => reveal(latest.file)}>Klasörde göster</${Btn}></div>
      <div class="result-grid">
        <video class=${'result-video ' + (latest.height > latest.width ? 'tall' : '')} src=${'/api/exports/' + encodeURIComponent(latest.file)} controls playsinline preload="metadata"></video>
        <div class="result-list">${p.exports.map((e, i) => html`<div class=${cls('result-row', i === 0 && 'new')} key=${e.file}>
          <div class="grow"><div class="ellipsis" title=${e.file}>${e.file}</div>
            <div class="mono small dim">${e.summary || `${e.width}×${e.height}`} · ${fmtTime(e.duration, 0)} · ${fmtBytes(e.size)} · ${timeAgo(e.created)}</div>
            ${e.keyframe && html`<div class="small dim">Kopya ${e.keyframe.offset.toFixed(2)} sn önce, anahtar karede başlıyor.</div>`}</div>
          <a class="btn btn-sm" href=${'/api/exports/' + encodeURIComponent(e.file) + '?dl=1'}><${Icon} name="download" size=${14} /><span>İndir</span></a>
          <button class="iconbtn" title="Klasörde göster" onClick=${() => reveal(e.file)}><${Icon} name="folder" size=${15} /></button>
        </div>`)}</div>
      </div>
      <details class="extras"><summary class="muted small">Diğer dosyalar</summary>
        <div class="toolbar" style=${{ marginTop: '8px' }}>
          <a class="btn btn-sm" href=${P(p.id, '/srt?which=dub')}>Altyazı (.srt)</a>
          <a class="btn btn-sm" href=${P(p.id, '/srt?which=orig')}>Orijinal altyazı (.srt)</a>
          <a class="btn btn-sm" href=${P(p.id, '/audio?mode=dub')}>Sadece ses (.wav)</a>
        </div>
      </details>
    </section>`}
  </div>`;
}
