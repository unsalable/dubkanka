import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P, upload } from '../api.js';
import { Btn, BusMeter, Field, GainSlider, HelpTip, Icon, JobPanel, Modal, PlayButton, Range, Segmented, Select, TimeReadout, Toggle, usePlaying, VideoPane, VolumeControl } from '../components.js';
import { buildMix, FILL_POST, FILL_PRE, loadMixBuffers, player, takeSpan } from '../engine.js';
import { FeatureOffer } from '../feature-ui.js';
import { getLang, t } from '../i18n.js';
import { featureReady, go, jobOf, patchLocal, toast, toastError, useStore } from '../state.js';
import { fitZoom, Timeline } from '../timeline.js';
import { cls, db2gain, fmtTime, readyTake, selectedTake } from '../util.js';

function MuteBtn({ muted, onClick, title }) {
  return html`<button class=${cls('mutebtn', muted && 'on')} title=${title || t('Sessize al')} aria-pressed=${!!muted} onClick=${onClick}>M</button>`;
}

const trackTitle = (label, bus) => html`<span>${label}</span>${bus && html`<${BusMeter} bus=${bus} />`}`;
const ms = (s) => `${Math.round(s * 1000)} ms`;
const TRACK_NAMES = { bg: 'Fon', amb: 'Ortam' };
const newMuteId = () => 'm' + Math.random().toString(36).slice(2, 9);

/** The muted stretches of a track that sit under a line: the ones made for it from the line's inspector. */
const lineMute = (mix, track, line) => (mix.mutes || []).find((m) => m.track === track && m.line === line.id);

function TakeInspector({ p, line, onChanged, toggleLineMute }) {
  const s = useStore();
  const effects = Object.entries((s.system || {}).effects || { none: t('Efekt yok') });
  const tk = selectedTake(line);
  const c = p.characters.find((x) => x.id === line.char) || {};
  const url = (tid) => P(p.id, `/lines/${line.id}/takes/${tid}`);
  const patch = (body, local = true) => {
    if (local) patchLocal((pp) => Object.assign(pp.lines.find((l) => l.id === line.id).takes.find((x) => x.id === tk.id), body));
    api.patch(url(tk.id), body).then(onChanged).catch(toastError);
  };
  const nudge = (d) => patch({ nudge: Math.round(((tk.nudge || 0) + d) * 1000) / 1000 });
  const trimmed = tk && ((tk.trimIn || 0) > 0 || (tk.trimOut || 0) > 0);
  const separated = !(p.stems && p.stems.separated === false);
  // under this line: silence the ambience or the background where a voice slipped into them
  const under = separated && html`<div class="seclabel">${t('Bu satırın altında')}</div>
    ${p.stems.ambience && html`<${Toggle} checked=${!!lineMute(p.mix, 'amb', line)} onChange=${() => toggleLineMute('amb', line)} label=${t('Ortam sesini sustur')} />`}
    <${Toggle} checked=${!!lineMute(p.mix, 'bg', line)} onChange=${() => toggleLineMute('bg', line)} label=${t('Fonu sustur')} />`;
  return html`<div>
    <div class="inspector-head"><span class="hl" style=${{ '--c': c.color }}>${c.name}</span><span class="tc dim">${t('{n}. satır', { n: p.lines.indexOf(line) + 1 })}</span></div>
    <div class="inspector-text" key=${line.id}>${line.text || line.orig}</div>
    ${line.takes.length > 0 && html`<${Field} label=${t('Kullanılan kayıt')}>
      <${Select} value=${line.take || ''} onChange=${(v) => api.post(P(p.id, `/lines/${line.id}/select`), { take: v || null }).then(onChanged).catch(toastError)}
        options=${[...line.takes.map((x, i) => [x.id, `${String(i + 1).padStart(2, '0')} · ${x.by}${x.source === 'tts' ? ' ' + t('(yapay zeka)') : ''}`]), ['', t('Hiçbiri (orijinal ses)')]]} />
    </${Field}>`}
    ${!tk
      ? html`<p class="muted small">${t('Bu satırın kaydı yok.')}</p>
          <${Btn} small icon="mic" onClick=${() => go(`p/${p.id}/record/${line.id}`)}>${t('Bu satırı kaydet')}</${Btn}>
          ${under}`
      : tk.status !== 'ready'
      ? html`<p class="muted small">${tk.status === 'error' ? t('Kayıt işlenemedi: {e}', { e: tk.error }) : t('Kayıt işleniyor…')}</p>`
      : html`
        <${GainSlider} label=${t('vol|Ses')} value=${tk.gain || 0} onCommit=${(v) => patch({ gain: v })} />
        ${under}
        <div class="seclabel">${t('Zamanlama')}</div>
        <div class="kv"><span>${t('Kaydırma')}</span><span class="tc">${ms(tk.nudge || 0)}</span></div>
        <div class="row nudges">
          <button class="btn btn-sm" onClick=${() => nudge(-0.1)}>−100</button><button class="btn btn-sm" onClick=${() => nudge(-0.02)}>−20</button>
          <button class="btn btn-sm" onClick=${() => nudge(0.02)}>+20</button><button class="btn btn-sm" onClick=${() => nudge(0.1)}>+100</button>
          <button class="btn btn-sm btn-ghost" onClick=${() => patch({ nudge: 0 })}>${t('Sıfırla')}</button>
        </div>
        <div class="kv"><span>${t('Baştan / sondan kırpılan')}</span><span class="tc">${ms(tk.trimIn || 0)} / ${ms(tk.trimOut || 0)}</span></div>
        ${trimmed && html`<${Btn} small kind="ghost" icon="trim" onClick=${() => patch({ trimIn: 0, trimOut: 0 })}>${t('Kırpmayı geri al')}</${Btn}>`}
        <div class="seclabel">${t('İşlem')}</div>
        ${tk.recStart != null && html`<${Toggle} checked=${tk.align !== 'recorded'} onChange=${(v) => patch({ align: v ? 'auto' : 'recorded' })} label=${t('Başlangıcı orijinale hizala')} />`}
        <${Toggle} checked=${!!tk.fit} onChange=${(v) => patch({ fit: v })} label=${`${t('Satır süresine sığdır')}${tk.fit && tk.tempo && tk.tempo !== 1 ? ` (x${tk.tempo})` : ''}`} />
        <${Toggle} checked=${tk.matchLevel !== false} onChange=${(v) => patch({ matchLevel: v })} label=${t('Seviyeyi orijinale eşitle')} />
        <${Toggle} checked=${!!tk.hpf} onChange=${(v) => patch({ hpf: v })} label=${t('Alçak kesme 80 Hz')} />
        ${denoiseReady()
          ? html`<${Toggle} checked=${!!tk.denoise} onChange=${(v) => patch({ denoise: v })} label=${t('Gürültü temizleme (DPDFNet)')} />`
          : html`<${FeatureOffer} id="cleanup" text=${t('Bu kaydı yapay zekayla temizlemek için indir.')} class="inspector-offer" />`}
        <${Field} label=${t('Ses efekti')}>
          <${Select} value=${tk.effect || ''} onChange=${(v) => patch({ effect: v || null })} options=${[['', t('Karakterinki ({e})', { e: (s.system?.effects || {})[c.effect || 'none'] || t('yok') })], ...effects]} />
        </${Field}>
        <${Field} label=${html`${t('Perde')} <span class="tc">${t('{n} yarım ton', { n: `${tk.pitch > 0 ? '+' : ''}${tk.pitch || 0}` })}</span>`}>
          <${Range} min=${-12} max=${12} step=${1} value=${tk.pitch || 0} onChange=${(v) => patch({ pitch: v })} />
        </${Field}>`}
  </div>`;
}

// DPDFNet comes with "Kayıt temizleme" (or with "Müziği koru", which needs it too)
const denoiseReady = () => featureReady('cleanup') || featureReady('separate');

function SfxInspector({ p, sfx, onChanged }) {
  const patch = (body) => {
    patchLocal((pp) => Object.assign(pp.mix.sfx.find((x) => x.id === sfx.id), body));
    api.patch(P(p.id, `/sfx/${sfx.id}`), body).then(onChanged).catch(toastError);
  };
  return html`<div>
    <div class="inspector-head"><${Icon} name="music" size=${16} /> <strong>${sfx.name}</strong></div>
    <${GainSlider} label=${t('vol|Ses')} value=${sfx.gain || 0} onCommit=${(v) => patch({ gain: v })} />
    <${Toggle} checked=${!!sfx.mute} onChange=${(v) => patch({ mute: v })} label=${t('Sessize al')} />
    <${Btn} small icon="trash" class="btn-danger" onClick=${() => api.del(P(p.id, `/sfx/${sfx.id}`)).then(onChanged).catch(toastError)}>${t('Sesi sil')}</${Btn}>
  </div>`;
}

/** A muted stretch of the background or the ambience: where it is, and the way to bring the sound back. */
function MuteInspector({ region, onRemove, onPlay }) {
  return html`<div>
    <div class="inspector-head"><${Icon} name="mute" size=${16} /><strong>${t('{track} burada sessiz', { track: t(TRACK_NAMES[region.track]) })}</strong></div>
    <div class="kv"><span>${t('Başlangıç')}</span><span class="tc">${fmtTime(region.start, 2)}</span></div>
    <div class="kv"><span>${t('Bitiş')}</span><span class="tc">${fmtTime(region.end, 2)}</span></div>
    <div class="toolbar mute-acts">
      <${Btn} small icon="play" onClick=${onPlay}>${t('Dinle')}</${Btn}>
      <${Btn} small icon="speaker" onClick=${onRemove}>${t('Sesi geri aç')}</${Btn}>
    </div>
  </div>`;
}

function TtsModal({ p, onClose }) {
  const s = useStore();
  const voicesAll = (s.system || {}).ttsVoices || {};
  const voices = voicesAll[p.settings.dstLang] || voicesAll.en || [];
  const missing = p.lines.filter((l) => !l.take && (l.text || '').trim());
  const [pick, setPick] = useState(() => Object.fromEntries(p.characters.map((c, i) => [c.id, c.voice || (voices[i % Math.max(1, voices.length)] || [''])[0]])));
  const job = jobOf('tts');
  const runningJob = job && (job.status === 'running' || job.status === 'queued');
  const go_ = async () => {
    for (const c of p.characters) if (pick[c.id] !== c.voice) api.patch(P(p.id, `/characters/${c.id}`), { voice: pick[c.id] }).catch(() => {});
    await api.post(P(p.id, '/tts'), { voices: pick }).catch(toastError);
  };
  return html`<${Modal} title=${t('Boş satırları yapay zeka sesiyle doldur')} onClose=${onClose}>
    <p class="muted">${t('Kaydı olmayan {n} satır geçici bir yapay zeka sesiyle doldurulur. Biri kaydedince onun kaydı kullanılır.', { n: missing.length })}</p>
    ${p.characters.map((c) => html`<${Field} label=${html`<span class="hl" style=${{ '--c': c.color }}>${c.name}</span>`}>
      <${Select} value=${pick[c.id]} onChange=${(v) => setPick({ ...pick, [c.id]: v })} options=${voices} />
    </${Field}>`)}
    ${job && html`<${JobPanel} job=${job} />`}
    <div class="modal-actions"><${Btn} onClick=${onClose}>${t('Kapat')}</${Btn}>
      <${Btn} kind="primary" icon="wave" disabled=${!missing.length || runningJob} onClick=${go_}>${t('{n} satırı seslendir', { n: missing.length })}</${Btn}></div>
  </${Modal}>`;
}

export function MixerView({ p }) {
  const s = useStore();
  const effects = Object.entries((s.system || {}).effects || {});
  const playing = usePlaying();
  const [bufs, setBufs] = useState(null);
  const [mode, setMode] = useState('dub');
  const [zoom, setZoom] = useState(null);
  const [sel, setSel] = useState(null);
  const [modal, setModal] = useState(null);
  const [range, setRange] = useState(null); // a stretch marked on the background or ambience lane: {track, start, end}
  const wrap = useRef(null);
  const sfxIn = useRef(null);
  const dur = p.clip.duration;
  const mix = p.mix;
  const mutes = mix.mutes || [];
  const bufKey = [p.stems.ver, ...p.lines.map((l) => (readyTake(l) || {}).file || ''), ...(mix.sfx || []).map((x) => x.id)].join('|');

  useEffect(() => {
    let alive = true;
    loadMixBuffers(p, { original: true }).then((b) => alive && setBufs(b)).catch(toastError);
    return () => (alive = false);
  }, [bufKey]);
  useEffect(() => {
    if (zoom == null && wrap.current) setZoom(fitZoom(wrap.current.clientWidth, dur));
  }, [wrap.current]);

  const start = (from = Math.max(0, player.time), m = mode, to = dur) => {
    if (!bufs) return;
    if (from >= dur - 0.05) from = 0;
    player.play({ from, to, ...buildMix(p, bufs, m) });
  };
  const toggle = () => (player.playing ? player.stop() : start());
  const restartIfPlaying = () => player.playing && setTimeout(() => start(player.time), 60);
  useEffect(() => {
    if (player.playing && bufs) start(player.time);
  }, [bufs]);

  const patchMix = (body) => {
    patchLocal((pp) => Object.assign(pp.mix, body));
    api.patch(P(p.id), { mix: body }).catch(toastError);
  };
  const setMutes = (list) => {
    patchMix({ mutes: list });
    restartIfPlaying();
  };
  const muteRange = (r) => {
    const id = newMuteId();
    setMutes([...mutes, { id, track: r.track, start: +r.start.toFixed(3), end: +r.end.toFixed(3) }]);
    setRange(null);
    setSel('m' + id);
  };
  const removeMute = (id) => {
    setMutes(mutes.filter((m) => m.id !== id));
    if (sel === 'm' + id) setSel(null);
  };
  // the line's own muted stretch: a little before it starts to a little after it ends, like the original voice it covers
  const toggleLineMute = (track, line) => {
    const had = lineMute(mix, track, line);
    if (had) return setMutes(mutes.filter((m) => m !== had));
    setMutes([...mutes, { id: newMuteId(), track, line: line.id,
      start: +Math.max(0, line.start - FILL_PRE).toFixed(3), end: +Math.min(dur, line.end + FILL_POST).toFixed(3) }]);
  };

  useEffect(() => {
    const key = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || e.repeat || document.querySelector('.popover, .modal-bg, .dialog-bg')) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel && sel.startsWith('m')) {
        e.preventDefault();
        removeMute(sel.slice(1));
      } else if (e.key === 'Escape' && range) setRange(null);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const busGain = (bus, gain) => player.setBusGain(bus, gain);
  const setMode_ = (m) => {
    setMode(m);
    if (player.playing) start(player.time, m);
  };
  const patchChar = (cid, body) => {
    patchLocal((pp) => Object.assign(pp.characters.find((c) => c.id === cid), body));
    api.patch(P(p.id, `/characters/${cid}`), body).catch(toastError);
  };
  const patchLine = (lid, body) => {
    patchLocal((pp) => Object.assign(pp.lines.find((l) => l.id === lid), body));
    api.patch(P(p.id, `/lines/${lid}`), body).then(restartIfPlaying).catch(toastError);
  };
  const patchTake = (l, tk, body) => {
    patchLocal((pp) => Object.assign(pp.lines.find((x) => x.id === l.id).takes.find((x) => x.id === tk.id), body));
    api.patch(P(p.id, `/lines/${l.id}/takes/${tk.id}`), body).then(restartIfPlaying).catch(toastError);
  };
  const addSfx = async (file) => {
    if (!file) return;
    try {
      await upload(P(p.id, `/sfx?start=${Math.max(0, player.time).toFixed(3)}&filename=${encodeURIComponent(file.name)}`), file);
      toast(t('Ses eklendi'), 'ok');
    } catch (e) {
      toastError(e);
    }
  };

  const chars = p.characters;
  const dubbed = new Set(p.lines.filter((l) => readyTake(l)).map((l) => l.id));
  const ambJob = jobOf('ambience');
  // a scene prepared without voice separation: its own audio is the background, the original voices are in it
  const unsep = p.stems && p.stems.separated === false;
  const sepJob = jobOf('separate');
  const sepRunning = sepJob && (sepJob.status === 'running' || sepJob.status === 'queued');
  const ambRunning = ambJob && (ambJob.status === 'running' || ambJob.status === 'queued');
  const lineNo = (l) => p.lines.indexOf(l) + 1;
  // the muted stretches of a lane, drawn as hatched blocks that move and stretch like clips
  const muteClips = (track) => mutes.filter((m) => m.track === track).map((m) => ({ id: 'm' + m.id, start: m.start, end: m.end, color: '#8c897f',
    label: t('Sessiz'), className: 'muteclip', draggable: true, resizable: true, title: t('Burada {track} sessiz', { track: t(TRACK_NAMES[track]).toLocaleLowerCase(getLang() === 'tr' ? 'tr' : 'en') }) }));
  const ranged = (track) => ({
    onRange: (a, b) => setRange({ track, start: a, end: b }),
    range: range && range.track === track ? range : null,
    rangeActions: html`<button class="btn btn-sm btn-primary" onClick=${() => muteRange(range)}><${Icon} name="mute" size=${13} /><span>${t('Sustur')}</span></button>
      <button class="iconbtn sm range-x" title=${t('Vazgeç')} onClick=${() => setRange(null)}><${Icon} name="x" size=${13} /></button>`,
  });
  const howTo = html`<${HelpTip} title=${t('Bir yeri susturmak')}>${t('Konuşma bu ize karışmışsa izin üstünde o yeri sürükleyerek seç ve Sustur\'a bas. Sadece o bölge susar; diğer yerler olduğu gibi kalır. Bir satırın altını susturmak için satıra tıkla.')}</${HelpTip}>`;
  const tracks = [
    {
      id: 'bg', label: trackTitle(unsep ? t('Orijinal ses (ayrılmadı)') : t('Fon: müzik ve efekt'), 'bg'), color: '#7f9cbb', height: 50, buffer: bufs && bufs.bg, muted: mix.bgMute,
      waveColor: 'rgba(127,156,187,0.55)', clips: muteClips('bg'), ...ranged('bg'),
      controls: html`<div class="tl-ctrl"><${MuteBtn} muted=${mix.bgMute} onClick=${() => { patchMix({ bgMute: !mix.bgMute }); restartIfPlaying(); }} />
        <${GainSlider} value=${mix.bgGain} onInput=${(v) => busGain('bg', db2gain(v))} onCommit=${(v) => patchMix({ bgGain: v })} />${howTo}</div>`,
    },
    ...(unsep ? [] : [{
      // birds, wind, crowd: what the voice separation took along with the dialogue, given back on its own fader
      id: 'amb', label: trackTitle(t('Ortam: kuş, rüzgar, kalabalık'), p.stems.ambience && 'amb'), color: '#6bbf4e', height: 50, buffer: bufs && bufs.amb, muted: mix.ambMute,
      waveColor: 'rgba(107,191,78,0.5)', ...(p.stems.ambience ? { clips: muteClips('amb'), ...ranged('amb') } : {}),
      controls: p.stems.ambience
        ? html`<div class="tl-ctrl"><${MuteBtn} muted=${mix.ambMute} onClick=${() => { patchMix({ ambMute: !mix.ambMute }); restartIfPlaying(); }} />
          <${GainSlider} value=${mix.ambGain || 0} onInput=${(v) => busGain('amb', db2gain(v))} onCommit=${(v) => patchMix({ ambGain: v })} />${howTo}</div>`
        : html`<div class="tl-ctrl">${ambRunning
          ? html`<span class="muted small">${t('Ayrılıyor… %{n}', { n: Math.round((ambJob.progress || 0) * 100) })}</span>`
          : html`<${Btn} small icon="leaf" onClick=${() => api.post(P(p.id, '/ambience')).catch(toastError)}
              title=${t('Konuşmayla birlikte silinen kuş, rüzgar, kalabalık seslerini geri getirir')}>${t('Geri getir')}</${Btn}>`}</div>`,
    },
    {
      id: 'orig', label: trackTitle(t('Orijinal konuşma'), 'fill'), color: '#8c897f', height: 50, buffer: bufs && bufs.voices, waveColor: 'rgba(214,210,198,0.26)',
      clips: p.lines.map((l) => ({ id: 'o' + l.id, start: l.start, end: l.end, color: (chars.find((c) => c.id === l.char) || {}).color,
        label: `${lineNo(l)}`, dim: dubbed.has(l.id) || !mix.fillMissing, className: 'origclip', title: l.orig, resizable: true })),
      controls: html`<div class="tl-ctrl"><${Toggle} checked=${mix.fillMissing} onChange=${(v) => { patchMix({ fillMissing: v }); restartIfPlaying(); }} label=${t('Kaydı yoksa çalsın')} /></div>`,
    }]),
    ...chars.map((c) => ({
      id: 'c' + c.id, label: trackTitle(c.name, 'char:' + c.id), color: c.color, height: 60, muted: c.mute,
      clips: p.lines.filter((l) => l.char === c.id).map((l) => {
        const tk = readyTake(l);
        if (!tk) // nobody recorded it yet: an empty frame of the line itself, still movable and resizable
          return { id: l.id, start: l.start, end: l.end, color: c.color, label: `${lineNo(l)} · ${t('kayıt yok')}`, className: 'ghost',
            draggable: true, resizable: true, title: l.text || l.orig };
        const [at, a, b] = takeSpan(tk);
        return { id: l.id, start: a, end: b, at, color: c.color, label: `${lineNo(l)} · ${tk.by}`, buffer: bufs && bufs.takes[tk.id],
          draggable: true, trim: { min: at, max: at + tk.duration }, title: l.text };
      }),
      controls: html`<div class="tl-ctrl"><${MuteBtn} muted=${c.mute} onClick=${() => { patchChar(c.id, { mute: !c.mute }); restartIfPlaying(); }} />
        <${GainSlider} value=${c.gain || 0} onInput=${(v) => busGain('char:' + c.id, db2gain(v + (mix.dubGain || 0)))} onCommit=${(v) => patchChar(c.id, { gain: v })} /></div>`,
    })),
    {
      id: 'sfx', label: trackTitle(t('Ekstra sesler'), 'sfx'), color: '#e3a13b', height: 44,
      clips: (mix.sfx || []).map((x) => ({ id: 's' + x.id, start: x.start, end: x.start + x.duration, at: x.start, color: '#e3a13b',
        label: x.name, buffer: bufs && bufs.sfx[x.id], draggable: true, dim: x.mute })),
      controls: html`<div class="tl-ctrl"><input type="file" hidden ref=${sfxIn} accept="audio/*,.mp3,.wav,.ogg,.m4a,.opus,.flac" onChange=${(e) => { addSfx(e.target.files[0]); e.target.value = ''; }} />
        <${Btn} small icon="plus" onClick=${() => sfxIn.current.click()} title=${t('Meme sesi, müzik vb. (oynatma çizgisine eklenir)')}>${t('Ses ekle')}</${Btn}></div>`,
    },
  ];

  const lineOf = (clip) => p.lines.find((x) => x.id === (clip.id.startsWith('o') ? clip.id.slice(1) : clip.id));
  const muteOf = (clip) => mutes.find((m) => 'm' + m.id === clip.id);
  const moveMute = (m, body) => setMutes(mutes.map((x) => (x === m ? { ...x, ...body } : x)));
  const onMove = (clip, dt) => {
    if (clip.id.startsWith('s')) {
      const sid = clip.id.slice(1);
      const sx = mix.sfx.find((x) => x.id === sid);
      const st = Math.max(0, +(sx.start + dt).toFixed(3));
      patchLocal((pp) => (pp.mix.sfx.find((x) => x.id === sid).start = st));
      api.patch(P(p.id, `/sfx/${sid}`), { start: st }).then(restartIfPlaying).catch(toastError);
      return;
    }
    const m = muteOf(clip);
    if (m) {
      const d = Math.max(-m.start, Math.min(dur - m.end, dt));
      return moveMute(m, { start: +(m.start + d).toFixed(3), end: +(m.end + d).toFixed(3) });
    }
    const l = lineOf(clip);
    const tk = readyTake(l);
    if (!tk) {
      const d = Math.max(-l.start, Math.min(dur - l.end, dt));
      return patchLine(l.id, { start: +(l.start + d).toFixed(3), end: +(l.end + d).toFixed(3) });
    }
    patchTake(l, tk, { nudge: Math.round(((tk.nudge || 0) + dt) * 1000) / 1000 });
  };
  const onResize = (clip, edge, x) => {
    const m = muteOf(clip);
    if (m) return moveMute(m, { [edge]: +Math.max(0, Math.min(dur, x)).toFixed(3) });
    patchLine(lineOf(clip).id, { [edge]: +Math.max(0, Math.min(dur, x)).toFixed(3) });
  };
  const onTrim = (clip, side, x) => {
    const l = lineOf(clip);
    const tk = readyTake(l);
    if (!tk) return;
    const [at] = takeSpan(tk);
    if (side === 'in') patchTake(l, tk, { trimIn: Math.max(0, +(x - at).toFixed(4)) });
    else patchTake(l, tk, { trimOut: Math.max(0, +(at + tk.duration - x).toFixed(4)) });
  };
  const onSelect = (clip) => {
    setRange(null);
    setSel(clip.id.startsWith('o') ? clip.id.slice(1) : clip.id);
    if (!player.playing) player.seek(clip.start);
  };
  const selLine = p.lines.find((l) => l.id === sel);
  const selSfx = sel && sel.startsWith('s') ? (mix.sfx || []).find((x) => 's' + x.id === sel) : null;
  const selMute = sel && sel.startsWith('m') ? mutes.find((m) => 'm' + m.id === sel) : null;
  const missing = p.lines.filter((l) => !l.take).length;

  return html`<div class="page mixer" ref=${wrap}>
    <div class="ws mixer-ws">
      <section class="pane viewer-pane">
        <${VideoPane} src=${fileUrl(p.id, p.clip.preview, p.clip.ver)} poster=${fileUrl(p.id, p.clip.thumb, p.clip.ver)} class="mixer-video"
          onClick=${() => bufs && toggle()} title=${playing ? t('Durdur') : t('Oynat')} />
        <div class="transport">
          <${PlayButton} playing=${playing} onClick=${toggle} disabled=${!bufs} />
          <${TimeReadout} duration=${dur} />
          <span class="vsep"></span>
          <${Segmented} value=${mode} onChange=${setMode_} options=${[['dub', t('Dublaj')], ['original', t('Orijinal')], ...(unsep ? [] : [['clean', t('Konuşmasız')]])]} />
          <span class="grow"></span>
          <${VolumeControl} />
          <div class="master" title=${t('Miksin seviyesi (dinleme sesinden bağımsız)')}><span class="label">${t('Çıkış')}</span><${BusMeter} bus="master" /></div>
        </div>
      </section>
      <aside class="pane mixer-side">
        <div class="pane-head"><h3>${selLine ? t('Satır') : selSfx ? t('sfx|Ses') : selMute ? t('Sessiz bölge') : t('İnceleme')}</h3><span class="grow"></span>
          ${(selLine || selSfx || selMute) && html`<button class="iconbtn" title=${t('Seçimi kaldır')} onClick=${() => setSel(null)}><${Icon} name="x" size=${15} /></button>`}</div>
        <div class="pane-scroll">
          <div class="pane-body">
            ${selLine ? html`<${TakeInspector} p=${p} line=${selLine} onChanged=${restartIfPlaying} toggleLineMute=${toggleLineMute} />`
              : selSfx ? html`<${SfxInspector} p=${p} sfx=${selSfx} onChanged=${restartIfPlaying} />`
              : selMute ? html`<${MuteInspector} region=${selMute} onRemove=${() => removeMute(selMute.id)}
                  onPlay=${() => start(Math.max(0, selMute.start - 1.5), mode, Math.min(dur, selMute.end + 1.5))} />`
              : html`<div class="inspector-empty"><span>${t('Ayarlamak için zaman çizelgesinde bir kutuya tıkla.')}</span></div>`}
          </div>
          <div class="pane-body">
            <div class="seclabel">${t('Miks')}</div>
            ${unsep && html`<div class="unsep">
              <p class="small muted">${t('Bu sahnede konuşmalar fondan ayrılmadı.')}</p>
              ${featureReady('separate')
                ? sepRunning
                  ? html`<${JobPanel} bare job=${sepJob} />`
                  : html`<${Btn} small icon="music" onClick=${() => api.post(P(p.id, '/separate')).catch(toastError)}>${t('Konuşmaları fondan ayır')}</${Btn}>`
                : html`<${FeatureOffer} id="separate" text=${t('Ekleyince bu sahnede konuşmaları tek tıkla ayırırsın; satırlar ve kayıtlar olduğu gibi kalır.')} />`}
            </div>`}
            <${Field} label=${html`${unsep ? t('Konuşurken orijinali kıs') : t('Konuşurken fonu kıs')} <span class="tc">${mix.duck || 0} dB</span>`}>
              <${Range} min=${0} max=${15} step=${1} value=${mix.duck || 0} onChange=${(v) => { patchMix({ duck: v }); restartIfPlaying(); }} />
            </${Field}>
            <${GainSlider} label=${t('Tüm dublaj')} value=${mix.dubGain || 0} onCommit=${(v) => { patchMix({ dubGain: v }); restartIfPlaying(); }} />
            <div class="toolbar" style=${{ marginTop: '12px' }}>
              ${missing > 0 && html`<${Btn} small icon="wave" onClick=${() => setModal('tts')}>${t('{n} boş satırı yapay zekayla doldur', { n: missing })}</${Btn}>`}
              <a class="btn btn-primary btn-sm" href=${`#/p/${p.id}/export`}><${Icon} name="share" size=${14} /><span>${t('Videoyu oluştur')}</span></a>
            </div>
          </div>
          <div class="pane-body">
            <div class="seclabel">${t('Karakter sesleri')}</div>
            ${chars.map((c) => html`<div class="charfx" key=${c.id}><span class="hl" style=${{ '--c': c.color }}>${c.name}</span><span class="grow"></span>
              <${Select} value=${c.effect || 'none'} onChange=${(v) => patchChar(c.id, { effect: v })} options=${effects} /></div>`)}
          </div>
        </div>
      </aside>
    </div>
    ${zoom != null && html`<${Timeline} duration=${dur} tracks=${tracks} zoom=${zoom} onZoom=${setZoom} selectedId=${sel} headW=${210}
      onSeek=${(x) => { setRange(null); player.playing ? start(x) : player.seek(x); }} onSelect=${onSelect} onMove=${onMove} onResize=${onResize} onTrim=${onTrim} />`}
    ${modal === 'tts' && html`<${TtsModal} p=${p} onClose=${() => setModal(null)} />`}
  </div>`;
}
