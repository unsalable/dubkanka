import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P, upload } from '../api.js';
import { Btn, BusMeter, CharDot, Field, GainSlider, Icon, JobPanel, Modal, PlayButton, Range, Segmented, Select, Swatch, TimeReadout, Toggle, usePlaying, VideoPane } from '../components.js';
import { buildMix, loadMixBuffers, player } from '../engine.js';
import { jobOf, patchLocal, toast, toastError, useStore } from '../state.js';
import { fitZoom, Timeline } from '../timeline.js';
import { cls, db2gain, readyTake, selectedTake } from '../util.js';

function MuteBtn({ muted, onClick, title = 'Sessize al' }) {
  return html`<button class=${cls('mutebtn', muted && 'on')} title=${title} aria-pressed=${!!muted} onClick=${onClick}>M</button>`;
}

const trackTitle = (color, label, bus) => html`<${Swatch} color=${color} /><span>${label}</span>${bus && html`<${BusMeter} bus=${bus} />`}`;

function TakeInspector({ p, line, onChanged }) {
  const s = useStore();
  const effects = Object.entries((s.system || {}).effects || { none: 'Efekt yok' });
  const t = selectedTake(line);
  const c = p.characters.find((x) => x.id === line.char) || {};
  const url = (tid) => P(p.id, `/lines/${line.id}/takes/${tid}`);
  const patch = (body, local = true) => {
    if (local) patchLocal((pp) => Object.assign(pp.lines.find((l) => l.id === line.id).takes.find((x) => x.id === t.id), body));
    api.patch(url(t.id), body).then(onChanged).catch(toastError);
  };
  const nudge = (d) => patch({ nudge: Math.round(((t.nudge || 0) + d) * 1000) / 1000 });
  return html`<div>
    <div class="inspector-head"><${Swatch} color=${c.color} /> <strong>${p.lines.indexOf(line) + 1}. satır · ${c.name}</strong></div>
    <div class="inspector-text" key=${line.id}>${line.text || line.orig}</div>
    ${line.takes.length > 0 && html`<${Field} label="Hangi kayıt?">
      <${Select} value=${line.take || ''} onChange=${(v) => api.post(P(p.id, `/lines/${line.id}/select`), { take: v || null }).then(onChanged).catch(toastError)}
        options=${[...line.takes.map((x, i) => [x.id, `Kayıt ${i + 1}: ${x.by}${x.source === 'tts' ? ' (yapay zeka)' : ''}`]), ['', 'Hiçbiri (orijinal ses)']]} />
    </${Field}>`}
    ${!t
      ? html`<p class="muted small">Bu satırda seçili kayıt yok${p.mix.fillMissing ? ', orijinal ses çalıyor' : ''}.</p>`
      : t.status !== 'ready'
      ? html`<p class="muted small">${t.status === 'error' ? 'Kayıt işlenemedi: ' + t.error : 'Kayıt işleniyor…'}</p>`
      : html`
        <${GainSlider} label="Ses" value=${t.gain || 0} onCommit=${(v) => patch({ gain: v })} />
        <div class="field" style=${{ marginTop: '14px' }}><span class="field-label">Zamanlama: <span class="tc">${((t.nudge || 0) * 1000).toFixed(0)} ms</span> kaydırıldı</span>
          <div class="row nudges">
            <button class="btn btn-sm" onClick=${() => nudge(-0.1)}>-100</button><button class="btn btn-sm" onClick=${() => nudge(-0.02)}>-20</button>
            <button class="btn btn-sm" onClick=${() => nudge(0.02)}>+20</button><button class="btn btn-sm" onClick=${() => nudge(0.1)}>+100</button>
            <button class="btn btn-sm btn-ghost" onClick=${() => patch({ nudge: 0 })}>Sıfırla</button>
          </div>
          <span class="field-hint">Zaman çizelgesinde kutuyu sürükleyerek de kaydırabilirsin.</span>
        </div>
        ${t.recStart != null && html`<${Toggle} checked=${t.align !== 'recorded'} onChange=${(v) => patch({ align: v ? 'auto' : 'recorded' })} label="Başlangıcı orijinale otomatik hizala" />`}
        <${Toggle} checked=${!!t.fit} onChange=${(v) => patch({ fit: v })} label="Satır süresine sığdır (hızlandır / yavaşlat)" />
        ${t.fit && t.tempo && t.tempo !== 1 && html`<span class="field-hint">Hız: x${t.tempo}</span>`}
        <${Toggle} checked=${t.matchLevel !== false} onChange=${(v) => patch({ matchLevel: v })} label="Ses seviyesini orijinale eşitle" />
        <${Field} label="Ses efekti (troll modu)">
          <${Select} value=${t.effect || ''} onChange=${(v) => patch({ effect: v || null })} options=${[['', `Karakter ayarı (${(s.system?.effects || {})[c.effect || 'none'] || 'yok'})`], ...effects]} />
        </${Field}>
        <${Field} label=${`Ses inceliği: ${t.pitch > 0 ? '+' : ''}${t.pitch || 0} yarım ton`}>
          <${Range} min=${-12} max=${12} step=${1} value=${t.pitch || 0} onChange=${(v) => patch({ pitch: v })} />
        </${Field}>`}
  </div>`;
}

function SfxInspector({ p, sfx, onChanged }) {
  const patch = (body) => {
    patchLocal((pp) => Object.assign(pp.mix.sfx.find((x) => x.id === sfx.id), body));
    api.patch(P(p.id, `/sfx/${sfx.id}`), body).then(onChanged).catch(toastError);
  };
  return html`<div>
    <div class="inspector-head"><${Icon} name="music" size=${16} /> <strong>${sfx.name}</strong></div>
    <${GainSlider} label="Ses" value=${sfx.gain || 0} onCommit=${(v) => patch({ gain: v })} />
    <${Toggle} checked=${!!sfx.mute} onChange=${(v) => patch({ mute: v })} label="Sessize al" />
    <${Btn} small icon="trash" class="btn-danger" onClick=${() => api.del(P(p.id, `/sfx/${sfx.id}`)).then(onChanged).catch(toastError)}>Efekti sil</${Btn}>
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
  return html`<${Modal} title="Eksik satırları yapay zeka sesiyle doldur" onClose=${onClose}>
    <p class="muted">Kaydı olmayan ${missing.length} satır için geçici yapay zeka sesi oluşturulur ve satır süresine sığdırılır.
      Arkadaşın kaydedince onun kaydı seçilir. (İnternet gerekir.)</p>
    ${p.characters.map((c) => html`<${Field} label=${html`<${CharDot} color=${c.color} /> ${c.name}`}>
      <${Select} value=${pick[c.id]} onChange=${(v) => setPick({ ...pick, [c.id]: v })} options=${voices} />
    </${Field}>`)}
    ${job && html`<${JobPanel} job=${job} />`}
    <div class="modal-actions"><${Btn} onClick=${onClose}>Kapat</${Btn}>
      <${Btn} kind="primary" icon="wand" disabled=${!missing.length || runningJob} onClick=${go_}>${missing.length} satırı seslendir</${Btn}></div>
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
  const wrap = useRef(null);
  const sfxIn = useRef(null);
  const dur = p.clip.duration;
  const mix = p.mix;
  const bufKey = [p.stems.ver, ...p.lines.map((l) => (readyTake(l) || {}).file || ''), ...(mix.sfx || []).map((x) => x.id)].join('|');

  useEffect(() => {
    let alive = true;
    loadMixBuffers(p, { original: true }).then((b) => alive && setBufs(b)).catch(toastError);
    return () => (alive = false);
  }, [bufKey]);
  useEffect(() => {
    if (zoom == null && wrap.current) setZoom(fitZoom(wrap.current.clientWidth, dur));
  }, [wrap.current]);

  const start = (from = Math.max(0, player.time), m = mode) => {
    if (!bufs) return;
    if (from >= dur - 0.05) from = 0;
    player.play({ from, to: dur, ...buildMix(p, bufs, m) });
  };
  const toggle = () => (player.playing ? player.stop() : start());
  const restartIfPlaying = () => player.playing && setTimeout(() => start(player.time), 60);
  useEffect(() => {
    if (player.playing && bufs) start(player.time);
  }, [bufs]);

  useEffect(() => {
    const key = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || e.repeat) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const patchMix = (body) => {
    patchLocal((pp) => Object.assign(pp.mix, body));
    api.patch(P(p.id), { mix: body }).catch(toastError);
  };
  const busGain = (bus, gain) => player.setBusGain(bus, gain);
  const setMode_ = (m) => {
    setMode(m);
    if (player.playing) start(player.time, m);
  };
  const patchChar = (cid, body) => {
    patchLocal((pp) => Object.assign(pp.characters.find((c) => c.id === cid), body));
    api.patch(P(p.id, `/characters/${cid}`), body).catch(toastError);
  };
  const addSfx = async (file) => {
    if (!file) return;
    try {
      await upload(P(p.id, `/sfx?start=${Math.max(0, player.time).toFixed(3)}&filename=${encodeURIComponent(file.name)}`), file);
      toast('Ses oynatma çizgisine eklendi, sürükleyerek taşıyabilirsin', 'ok');
    } catch (e) {
      toastError(e);
    }
  };

  const chars = p.characters;
  const dubbed = new Set(p.lines.filter((l) => readyTake(l)).map((l) => l.id));
  const ambJob = jobOf('ambience');
  const ambRunning = ambJob && (ambJob.status === 'running' || ambJob.status === 'queued');
  const tracks = [
    {
      id: 'bg', label: trackTitle('#5d8fd6', 'Fon: müzik ve efektler', 'bg'), height: 52, buffer: bufs && bufs.bg, muted: mix.bgMute, waveColor: 'rgba(110,160,230,0.5)',
      controls: html`<div class="tl-ctrl"><${MuteBtn} muted=${mix.bgMute} onClick=${() => { patchMix({ bgMute: !mix.bgMute }); restartIfPlaying(); }} />
        <${GainSlider} value=${mix.bgGain} onInput=${(v) => busGain('bg', db2gain(v))} onCommit=${(v) => patchMix({ bgGain: v })} /></div>`,
    },
    {
      // birds, wind, crowd: what the voice separation took along with the dialogue, given back on its own fader
      id: 'amb', label: trackTitle('#58b57a', 'Ortam: kuş, rüzgar, kalabalık', p.stems.ambience && 'amb'), height: 52, buffer: bufs && bufs.amb, muted: mix.ambMute, waveColor: 'rgba(110,200,140,0.5)',
      controls: p.stems.ambience
        ? html`<div class="tl-ctrl"><${MuteBtn} muted=${mix.ambMute} onClick=${() => { patchMix({ ambMute: !mix.ambMute }); restartIfPlaying(); }} />
          <${GainSlider} value=${mix.ambGain || 0} onInput=${(v) => busGain('amb', db2gain(v))} onCommit=${(v) => patchMix({ ambGain: v })} /></div>`
        : html`<div class="tl-ctrl">${ambRunning
          ? html`<span class="muted small">Ayrılıyor… %${Math.round((ambJob.progress || 0) * 100)}</span>`
          : html`<${Btn} small icon="wand" onClick=${() => api.post(P(p.id, '/ambience')).catch(toastError)}
              title="Konuşmayla birlikte silinen kuş, rüzgar, kalabalık seslerini geri getirir">Geri getir</${Btn}>`}</div>`,
    },
    {
      id: 'orig', label: trackTitle('#8b8b93', 'Orijinal konuşmalar', 'fill'), height: 52, buffer: bufs && bufs.voices, waveColor: 'rgba(200,200,210,0.28)',
      clips: p.lines.map((l, i) => ({ id: 'o' + l.id, start: l.start, end: l.end, color: (chars.find((c) => c.id === l.char) || {}).color,
        label: `${i + 1}`, dim: dubbed.has(l.id) || !mix.fillMissing, className: 'origclip', title: l.orig })),
      controls: html`<div class="tl-ctrl"><${Toggle} checked=${mix.fillMissing} onChange=${(v) => { patchMix({ fillMissing: v }); restartIfPlaying(); }} label="Boş satırlarda çalsın" /></div>`,
    },
    ...chars.map((c) => ({
      id: 'c' + c.id, label: trackTitle(c.color, c.name, 'char:' + c.id), color: c.color, height: 62, muted: c.mute,
      clips: p.lines.filter((l) => l.char === c.id && readyTake(l)).map((l) => {
        const t = readyTake(l);
        return { id: l.id, start: t.start + (t.nudge || 0), end: t.start + (t.nudge || 0) + t.duration, at: t.start + (t.nudge || 0),
          color: c.color, label: `${p.lines.indexOf(l) + 1} · ${t.by}`, buffer: bufs && bufs.takes[t.id], draggable: true, title: l.text };
      }),
      controls: html`<div class="tl-ctrl"><${MuteBtn} muted=${c.mute} onClick=${() => { patchChar(c.id, { mute: !c.mute }); restartIfPlaying(); }} />
        <${GainSlider} value=${c.gain || 0} onInput=${(v) => busGain('char:' + c.id, db2gain(v + (mix.dubGain || 0)))} onCommit=${(v) => patchChar(c.id, { gain: v })} /></div>`,
    })),
    {
      id: 'sfx', label: trackTitle('#d8b53c', 'Ekstra sesler', 'sfx'), height: 46,
      clips: (mix.sfx || []).map((x) => ({ id: 's' + x.id, start: x.start, end: x.start + x.duration, at: x.start, color: '#d8b53c',
        label: x.name, buffer: bufs && bufs.sfx[x.id], draggable: true, dim: x.mute })),
      controls: html`<div class="tl-ctrl"><input type="file" hidden ref=${sfxIn} accept="audio/*,.mp3,.wav,.ogg,.m4a" onChange=${(e) => { addSfx(e.target.files[0]); e.target.value = ''; }} />
        <${Btn} small icon="plus" onClick=${() => sfxIn.current.click()} title="Meme sesi, müzik vb. ekle (oynatma çizgisine)">Ses ekle</${Btn}></div>`,
    },
  ];

  const onMove = (clip, dt) => {
    if (clip.id.startsWith('s')) {
      const sid = clip.id.slice(1);
      const sx = mix.sfx.find((x) => x.id === sid);
      const start = Math.max(0, +(sx.start + dt).toFixed(3));
      patchLocal((pp) => (pp.mix.sfx.find((x) => x.id === sid).start = start));
      api.patch(P(p.id, `/sfx/${sid}`), { start }).then(restartIfPlaying).catch(toastError);
      return;
    }
    const l = p.lines.find((x) => x.id === clip.id);
    const t = readyTake(l);
    if (!t) return;
    const nudge = Math.round(((t.nudge || 0) + dt) * 1000) / 1000;
    patchLocal((pp) => (pp.lines.find((x) => x.id === l.id).takes.find((x) => x.id === t.id).nudge = nudge));
    api.patch(P(p.id, `/lines/${l.id}/takes/${t.id}`), { nudge }).then(restartIfPlaying).catch(toastError);
  };
  const onSelect = (clip) => {
    setSel(clip.id.startsWith('o') ? clip.id.slice(1) : clip.id);
    if (!player.playing) player.seek(clip.start);
  };
  const selLine = p.lines.find((l) => l.id === sel);
  const selSfx = sel && sel.startsWith('s') ? (mix.sfx || []).find((x) => 's' + x.id === sel) : null;
  const missing = p.lines.filter((l) => !l.take).length;

  return html`<div class="page mixer" ref=${wrap}>
    <div class="ws mixer-ws">
      <section class="pane viewer-pane">
        <${VideoPane} src=${fileUrl(p.id, p.clip.preview, p.clip.ver)} poster=${fileUrl(p.id, p.clip.thumb, p.clip.ver)} class="mixer-video" />
        <div class="transport">
          <${PlayButton} playing=${playing} onClick=${toggle} disabled=${!bufs} />
          <${TimeReadout} duration=${dur} />
          <span class="vsep"></span>
          <${Segmented} value=${mode} onChange=${setMode_} options=${[['dub', 'Dublaj'], ['original', 'Orijinal']]} />
          <span class="muted small">Karşılaştırmak için oynatırken geçiş yap</span>
          <span class="grow"></span>
          <div class="master" title="Çıkış seviyesi"><span class="muted small">Çıkış</span><${BusMeter} bus="master" /></div>
        </div>
      </section>
      <aside class="pane mixer-side">
        <div class="pane-head"><h3>${selLine ? 'Seçili satır' : selSfx ? 'Seçili ses' : 'İnceleme'}</h3><span class="grow"></span>
          ${(selLine || selSfx) && html`<button class="iconbtn" title="Seçimi kaldır" onClick=${() => setSel(null)}><${Icon} name="x" size=${15} /></button>`}</div>
        <div class="pane-body">
          ${selLine ? html`<${TakeInspector} p=${p} line=${selLine} onChanged=${restartIfPlaying} />`
            : selSfx ? html`<${SfxInspector} p=${p} sfx=${selSfx} onChanged=${restartIfPlaying} />`
            : html`<div class="inspector-empty"><${Icon} name="info" size=${16} /><span>Ayarlamak için zaman çizelgesinde bir kayda tıkla. Kutuları sürükleyerek zamanlamayı kaydırabilirsin.</span></div>`}
        </div>
        <div class="pane-body">
          <div class="section-label">Miks</div>
          <${Field} label=${`Konuşurken fonu kıs: ${mix.duck || 0} dB`} hint="Dublaj seslerini öne çıkarır, ortam seslerini de birlikte kısar.">
            <${Range} min=${0} max=${15} step=${1} value=${mix.duck || 0} onChange=${(v) => { patchMix({ duck: v }); restartIfPlaying(); }} />
          </${Field}>
          <${GainSlider} label="Tüm dublaj" value=${mix.dubGain || 0} onCommit=${(v) => { patchMix({ dubGain: v }); restartIfPlaying(); }} />
          <div class="toolbar" style=${{ marginTop: '14px' }}>
            ${missing > 0 && html`<${Btn} small icon="wand" onClick=${() => setModal('tts')}>${missing} boş satırı yapay zekayla doldur</${Btn}>`}
            <a class="btn btn-primary btn-sm" href=${`#/p/${p.id}/export`}><${Icon} name="share" size=${14} /><span>Videoyu oluştur</span></a>
          </div>
        </div>
        <div class="pane-body">
          <div class="section-label">Karakter sesleri</div>
          ${chars.map((c) => html`<div class="charfx"><${Swatch} color=${c.color} /> <span class="grow">${c.name}</span>
            <select class="input" value=${c.effect || 'none'} onChange=${(e) => patchChar(c.id, { effect: e.target.value })}>
              ${effects.map(([k, v]) => html`<option value=${k} selected=${(c.effect || 'none') === k}>${v}</option>`)}
            </select></div>`)}
          <span class="field-hint">Efekt değişince o karakterin kayıtları yeniden işlenir (birkaç saniye).</span>
        </div>
      </aside>
    </div>
    ${zoom != null && html`<${Timeline} duration=${dur} tracks=${tracks} zoom=${zoom} onZoom=${setZoom} selectedId=${sel} headW=${204}
      onSeek=${(t) => (player.playing ? start(t) : player.seek(t))} onSelect=${onSelect} onMove=${onMove} />`}
    ${modal === 'tts' && html`<${TtsModal} p=${p} onClose=${() => setModal(null)} />`}
  </div>`;
}
