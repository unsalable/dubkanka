// Recording booth (ADR): streamer + 3 beeps, a big rhythm lane of the original line, karaoke dub text, sample-accurate
// takes, instant review. The side holds the roles, the line list and the booth settings (microphone, processing).
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P, upload } from '../api.js';
import { Btn, Field, Icon, Kbd, Lamp, LevelMeter, Modal, Range, Segmented, Select, Toggle, VideoPane } from '../components.js';
import { buildMix, engine, loadMixBuffers, player, stemUrls, takeUrl } from '../engine.js';
import { listMics, micPrefs, recorder, setMicPref } from '../recorder.js';
import { FeatureOffer } from '../feature-ui.js';
import { featureReady, toast, toastError, useStore } from '../state.js';
import { clamp, cls, db2gain, drawWave, encodeWav, LS, selectedTake, sleep, syllables, timeAgo } from '../util.js';

const DEFAULTS = { preroll: 2, beeps: true, streamer: true, bg: true, guide: 0, autoStop: true, tail: 1.0, autoReview: true, align: 'auto' };
const STATUS = { processing: ['busy', 'işleniyor'], error: ['bad', 'hata'] };
const RING = 2 * Math.PI * 60;

/** Dub text as words that light up in turn: each word gets a share of the line in proportion to its syllables. */
function CueText({ line }) {
  const words = (line.text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return html`<em class="dim">Dublaj metni boş. Orijinali okuyabilir ya da doğaçlama yapabilirsin.</em>`;
  const weights = words.map((w) => Math.max(1, syllables(w)));
  const total = weights.reduce((a, b) => a + b, 0);
  const dur = line.end - line.start;
  let acc = 0;
  return words.map((w, i) => {
    const s = line.start + (acc / total) * dur;
    acc += weights[i];
    return html`<span key=${i} class="cw" data-s=${s} data-e=${line.start + (acc / total) * dur}>${w} </span>`;
  });
}

/** The original line, big: its waveform, every word where it was really said, the punch-in and a moving playhead. */
function RhythmLane({ line, buffer, t0, t1, color }) {
  const cv = useRef(null);
  const box = useRef(null);
  useEffect(() => {
    const c = cv.current;
    const b = box.current;
    if (!c || !b) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, Math.floor(b.clientWidth * dpr));
      c.height = Math.max(1, Math.floor(b.clientHeight * dpr));
      if (buffer) drawWave(c, buffer, 0, t0, t1, 'rgba(214, 210, 198, 0.34)', 1.6);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(b);
    return () => ro.disconnect();
  }, [buffer, t0, t1]);
  const pct = (t) => ((t - t0) / (t1 - t0)) * 100 + '%';
  const words = line.words && line.words.length ? line.words : null;
  return html`<div class="rhythm" ref=${box} style=${{ '--c': color }}>
    <canvas ref=${cv}></canvas>
    <div class="rh-line" style=${{ left: pct(line.start), width: ((line.end - line.start) / (t1 - t0)) * 100 + '%' }}></div>
    ${words
      ? words.map((w, i) => html`<span key=${i} class="rw" data-s=${w[0]} data-e=${w[1]}
          style=${{ left: pct(w[0]), width: `max(${((w[1] - w[0]) / (t1 - t0)) * 100}%, 4px)` }}><b>${w[2].trim()}</b></span>`)
      : html`<span class="rw solo" data-s=${line.start} data-e=${line.end} style=${{ left: pct(line.start), width: ((line.end - line.start) / (t1 - t0)) * 100 + '%' }}><b>${line.orig}</b></span>`}
    <i class="rh-in" style=${{ left: pct(line.start) }}><span>GİRİŞ</span></i>
    <i class="rh-out" style=${{ left: pct(line.end) }}></i>
    <i class="rh-head"></i>
  </div>`;
}

function TakeList({ p, line, me, guest, onPlay }) {
  if (!line.takes || !line.takes.length) return html`<div class="takes-empty dim">Bu satır için henüz kayıt yok. <${Kbd}>Boşluk</${Kbd}> ile ilkini al.</div>`;
  const sel = (tid) => api.post(P(p.id, `/lines/${line.id}/select`), { take: tid }).catch(toastError);
  const del = (t) => confirm('Bu kayıt silinsin mi?') && api.del(P(p.id, `/lines/${line.id}/takes/${t.id}`)).catch(toastError);
  return html`<div class="takes">${[...line.takes].reverse().map((t, i) => {
    const n = line.takes.length - i;
    const mine = !guest || t.by === me;
    const [tone, label] = STATUS[t.status] || (t.silent ? ['warn', 'ses yok'] : ['', '']);
    return html`<div key=${t.id} class=${cls('take', line.take === t.id && 'sel', t.status)}>
      <button class="iconbtn" disabled=${t.status !== 'ready'} title="Dinle" onClick=${() => onPlay(t)}><${Icon} name="play" size=${14} /></button>
      <span class="take-n tc">${String(n).padStart(2, '0')}</span>
      <div class="take-info"><strong>${t.by}</strong><span class="dim small">${timeAgo(t.created)}${t.source === 'tts' ? ' · yapay zeka' : t.source === 'upload' ? ' · dosya' : ''}${t.denoise ? ' · temizlendi' : ''}</span></div>
      ${label && html`<${Lamp} tone=${tone}>${label}</${Lamp}>`}
      ${line.take === t.id ? html`<${Lamp} tone="ok">seçili</${Lamp}>` : html`<${Btn} small kind="ghost" onClick=${() => sel(t.id)} disabled=${t.status !== 'ready'}>Kullan</${Btn}>`}
      ${mine && html`<button class="iconbtn" title="Sil" onClick=${() => del(t)}><${Icon} name="trash" size=${15} /></button>`}
    </div>`;
  })}</div>`;
}

/** Who voices whom: everyone's claimed roles plus who is on which role right now in the room. */
function Roles({ p, filter, setFilter, room, guest }) {
  const live = {};
  if (room && room.status === 'on') {
    for (const g of room.guests || []) if (g.online && g.char) (live[g.char] = live[g.char] || []).push(g.name);
    if (room.host && room.host.online && room.host.char) (live[room.host.char] = live[room.host.char] || []).push(room.host.name);
  }
  return html`<div class="roles">
    <button class=${cls('role', !filter.length && 'on')} onClick=${() => setFilter([])}><span class="role-name">Hepsi</span>
      <span class="dim small">${p.lines.length} satır</span></button>
    ${p.characters.map((ch) => {
      const n = p.lines.filter((l) => l.char === ch.id).length;
      const done = p.lines.filter((l) => l.char === ch.id && l.take).length;
      const names = [...new Set([...(live[ch.id] || []), ...(ch.actor || '').split(',').map((x) => x.trim()).filter(Boolean)])];
      return html`<button key=${ch.id} class=${cls('role', filter.includes(ch.id) && 'on')} style=${{ '--c': ch.color }}
        onClick=${() => setFilter(filter.length === 1 && filter[0] === ch.id ? [] : [ch.id])}
        title=${guest ? 'Bu rolü al' : 'Bu rolü seslendiriyorum'}>
        <span class="role-name"><span class="hl" style=${{ '--c': ch.color }}>${ch.name}</span></span>
        <span class="role-who">${live[ch.id] ? html`<span class="lamp ok"></span>` : ''}${names.join(', ') || html`<span class="dim">boş</span>`}</span>
        <span class="tc dim small">${done}/${n}</span></button>`;
    })}
  </div>`;
}

function BoothSettings({ settings, set, guest, name, setName, onTestRec, testing }) {
  const [mics, setMics] = useState([]);
  const [pr, setPr] = useState(micPrefs);
  const [open, setOpen] = useState(recorder.ready);
  const [info, setInfo] = useState(recorder.info);
  useEffect(() => {
    const refresh = () => listMics().then(setMics);
    refresh();
    navigator.mediaDevices && navigator.mediaDevices.addEventListener('devicechange', refresh);
    const off = recorder.onState((r) => {
      setOpen(r.ready);
      setInfo(r.info);
      refresh();
    });
    return () => {
      off();
      navigator.mediaDevices && navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);
  // a capture setting changed: reopen the microphone so it applies right away
  const change = async (k, v, reopen = true) => {
    setMicPref(k, v);
    setPr(micPrefs());
    if (reopen && recorder.ready) await recorder.open(true).catch(toastError);
  };
  const toggleTest = () => (recorder.ready ? recorder.close() : recorder.open().catch(toastError));
  const options = mics.some((m) => m.id === '') ? mics.map((m) => [m.id, m.label]) : [['', 'Varsayılan mikrofon'], ...mics.map((m) => [m.id, m.label])];
  const headset = info ? info.headset : (mics.find((m) => m.id === pr.deviceId) || {}).headset;
  return html`<div class="boothsettings">
    <div class="seclabel">Mikrofon</div>
    ${!guest && html`<${Field} label="Kaydı yapan"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /></${Field}>`}
    <div class="row nowrap mic-pick">
      <${Select} class="grow" value=${pr.deviceId} onChange=${(v) => change('device', v)} options=${options} />
      <button class="iconbtn" title="Listeyi yenile" onClick=${() => listMics().then(setMics)}><${Icon} name="refresh" size=${15} /></button>
    </div>
    <div class="mic-test">
      <${Btn} small kind=${open ? 'primary' : ''} icon=${open ? 'stop' : 'mic'} onClick=${toggleTest}>${open ? 'Testi durdur' : 'Mikrofonu test et'}</${Btn}>
      <${LevelMeter} />
    </div>
    ${info && html`<div class="mic-info mono">${Math.round(info.sampleRate / 100) / 10} kHz · ${info.channels === 1 ? 'mono' : info.channels + ' kanal'} · ${info.echo || info.noise || info.agc ? [info.echo && 'yankı eng.', info.noise && 'gürültü bast.', info.agc && 'oto kazanç'].filter(Boolean).join(', ') : 'işlemsiz'}</div>`}
    ${headset && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />Bluetooth kulaklık mikrofonu telefon kalitesinde (16 kHz) kaydeder, ses boğuk çıkar. Kablolu ya da USB mikrofon seç.</div>`}
    <${Toggle} checked=${pr.monitor} onChange=${(v) => { setMicPref('monitor', v); setPr(micPrefs()); recorder.setMonitor(v); if (v && !recorder.ready) recorder.open().catch(toastError); }}
      label=${html`<span class="toggle-text">Kendimi duy<small>Sesin kulaklığına gelir. Hoparlörle açma, çınlar.</small></span>`} />
    ${pr.monitor && html`<${Field} label=${`Dinleme seviyesi: %${Math.round(pr.monitorGain * 100)}`}>
      <${Range} min=${0} max=${1.5} step=${0.05} value=${pr.monitorGain} onInput=${(v) => { setMicPref('monitorGain', v); setPr(micPrefs()); recorder.setMonitor(true, v); }} />
    </${Field}>`}
    <${Btn} small icon=${testing ? 'stop' : 'rec'} kind=${testing ? 'rec' : ''} onClick=${onTestRec} disabled=${testing}>${testing ? 'Kaydediliyor… 5 sn' : '5 sn deneme kaydı al ve dinle'}</${Btn}>

    <div class="seclabel">Ses işleme</div>
    <${Toggle} checked=${pr.raw} onChange=${(v) => change('raw', v)} label=${html`<span class="toggle-text">Saf ses<small>Tarayıcı sese dokunmaz. Kulaklıkla en temiz kayıt budur.</small></span>`} />
    <div class=${cls('subtoggles', pr.raw && 'off')}>
      <${Toggle} disabled=${pr.raw} checked=${!pr.raw && pr.echoCancellation} onChange=${(v) => change('echo', v)} label="Yankı engelleme (hoparlörle kayıtta)" />
      <${Toggle} disabled=${pr.raw} checked=${!pr.raw && pr.noiseSuppression} onChange=${(v) => change('noise', v)} label="Gürültü bastırma (tarayıcı)" />
      <${Toggle} disabled=${pr.raw} checked=${!pr.raw && pr.autoGainControl} onChange=${(v) => change('agc', v)} label="Otomatik kazanç" />
    </div>
    <${Toggle} checked=${pr.hpf} onChange=${(v) => change('hpf', v, false)} label=${html`<span class="toggle-text">Alçak kesme 80 Hz<small>Masa vuruşu, uğultu ve "p" patlamalarını alır, sesi boğmaz.</small></span>`} />
    ${guest || featureReady('cleanup') || featureReady('separate')
      ? html`<${Toggle} checked=${pr.denoise} onChange=${(v) => change('denoise', v, false)} label=${html`<span class="toggle-text">Yapay zeka gürültü temizleme<small>Kayıttan sonra DPDFNet ile oda gürültüsü ve fan sesi silinir.</small></span>`} />`
      : html`<${FeatureOffer} id="cleanup" text="Kayıttan sonra oda gürültüsü ve fan sesi yapay zekayla silinir." />`}

    <div class="seclabel">Kayıt</div>
    <div class="row2">
      <${Field} label="Geri sayım">
        <${Select} value=${String(settings.preroll)} onChange=${(v) => set('preroll', Number(v))} options=${[['1', '1 sn'], ['2', '2 sn'], ['3', '3 sn'], ['4', '4 sn']]} />
      </${Field}>
      <${Field} label="Rehber ses (orijinal)">
        <${Select} value=${String(settings.guide)} onChange=${(v) => set('guide', Number(v))} options=${[['0', 'Kapalı'], ['0.25', 'Kısık'], ['0.7', 'Normal']]} />
      </${Field}>
    </div>
    <${Toggle} checked=${settings.streamer} onChange=${(v) => set('streamer', v)} label="Akış çizgisi (ekranda girişe kayan çizgi)" />
    <${Toggle} checked=${settings.beeps} onChange=${(v) => set('beeps', v)} label="3 bip" />
    <${Toggle} checked=${settings.bg} onChange=${(v) => set('bg', v)} label="Kayıtta fon ve ortam sesi çalsın" />
    <${Toggle} checked=${settings.autoStop} onChange=${(v) => set('autoStop', v)} label="Satır bitince kaydı durdur" />
    <${Toggle} checked=${settings.autoReview} onChange=${(v) => set('autoReview', v)} label="Kayıttan sonra dinlet" />
    <${Toggle} checked=${settings.align === 'auto'} onChange=${(v) => set('align', v ? 'auto' : 'recorded')} label="Konuşmayı orijinal girişe hizala" />
    <${Field} label=${html`Gecikme düzeltme <span class="tc">${pr.latencyMs} ms</span>`} hint="Kayıtlar hep geç oturuyorsa artır (Bluetooth: 150-250 ms).">
      <${Range} min=${-200} max=${400} step=${10} value=${pr.latencyMs} onInput=${(v) => change('latency', v, false)} />
    </${Field}>
  </div>`;
}

const WHATSAPP = /^(PTT|AUD|VID|WA)[-_]|WA\d{4}/i;
/** Line number hidden in a file name: "3.m4a", "satır 3", "Ali 12"; WhatsApp's own names carry none. */
export function guessLine(name, count) {
  const base = name.replace(/\.[^.]+$/, '');
  if (WHATSAPP.test(base)) return null;
  const m = base.match(/^\s*(\d{1,3})(?!\d)/) || base.match(/(?:satır|satir|line|replik|#)\s*(\d{1,3})(?!\d)/i) || base.match(/(?:^|\D)(\d{1,3})\s*$/);
  const k = m ? Number(m[1]) : 0;
  return k >= 1 && k <= count ? k : null;
}

function BulkDialog({ p, files, name, onClose }) {
  const [plan, setPlan] = useState(() => files.map((f) => ({ file: f, line: guessLine(f.name, p.lines.length), state: '' })));
  const [busy, setBusy] = useState(false);
  const setLine = (i, v) => setPlan(plan.map((x, j) => (j === i ? { ...x, line: v ? Number(v) : null } : x)));
  const fillEmpty = () => {
    const free = p.lines.map((l, i) => i + 1).filter((n) => !p.lines[n - 1].take && !plan.some((x) => x.line === n));
    let k = 0;
    setPlan(plan.map((x) => (x.line ? x : { ...x, line: free[k++] || null })));
  };
  const go_ = async () => {
    setBusy(true);
    let ok = 0;
    for (let i = 0; i < plan.length; i++) {
      const x = plan[i];
      if (!x.line) continue;
      const l = p.lines[x.line - 1];
      setPlan((pl) => pl.map((y, j) => (j === i ? { ...y, state: 'up' } : y)));
      try {
        await upload(P(p.id, `/lines/${l.id}/takes?source=upload&by=${encodeURIComponent(name || 'Ben')}&filename=${encodeURIComponent(x.file.name)}`), x.file);
        ok++;
        setPlan((pl) => pl.map((y, j) => (j === i ? { ...y, state: 'ok' } : y)));
      } catch (e) {
        setPlan((pl) => pl.map((y, j) => (j === i ? { ...y, state: 'err', error: e.message } : y)));
      }
    }
    setBusy(false);
    if (ok) toast(`${ok} kayıt eklendi; sessizlikler kesilip her biri kendi yerine hizalanıyor.`, 'ok');
  };
  const opts = [['', 'Atla'], ...p.lines.map((l, i) => [String(i + 1), `${i + 1}. ${(p.characters.find((c) => c.id === l.char) || {}).name || ''} · ${(l.text || l.orig || '').slice(0, 40)}`])];
  const assigned = plan.filter((x) => x.line).length;
  return html`<${Modal} title="Toplu ses yükle" onClose=${busy ? null : onClose} wide>
    <p class="muted small">Dosya adındaki sayı satır numarası sayılır (ör. <span class="mono">3.m4a</span>). WhatsApp sesli mesajlarında numara olmadığı için satırı elle seç ya da boş satırlara sırayla dağıt.</p>
    <div class="bulk">${plan.map((x, i) => html`<div class="bulk-row" key=${i}>
      <span class="mono small ellipsis" title=${x.file.name}>${x.file.name}</span>
      <${Select} value=${x.line ? String(x.line) : ''} onChange=${(v) => setLine(i, v)} options=${opts} disabled=${busy} />
      <span class="bulk-state">${x.state === 'up' ? html`<${Lamp} tone="busy">yükleniyor</${Lamp}>` : x.state === 'ok' ? html`<${Lamp} tone="ok">eklendi</${Lamp}>` : x.state === 'err' ? html`<${Lamp} tone="bad" title=${x.error}>hata</${Lamp}>` : ''}</span>
    </div>`)}</div>
    <div class="modal-actions"><${Btn} kind="ghost" onClick=${fillEmpty} disabled=${busy}>Boş satırlara sırayla dağıt</${Btn}><span class="grow"></span>
      <${Btn} onClick=${onClose} disabled=${busy}>Kapat</${Btn}>
      <${Btn} kind="primary" icon="upload" onClick=${go_} disabled=${busy || !assigned}>${assigned} dosyayı yükle</${Btn}></div>
  </${Modal}>`;
}

export function BoothView({ p, guest = false }) {
  const s = useStore();
  const [settings, setSettings] = useState(() => ({ ...DEFAULTS, ...LS.get('booth.settings', {}) }));
  const set = (k, v) => {
    const n = { ...settings, [k]: v };
    setSettings(n);
    LS.set('booth.settings', n);
  };
  const [name, setNameState] = useState(() => (guest ? s.guestName : LS.get('booth.name', 'Ben')));
  const setName = (v) => {
    setNameState(v);
    LS.set('booth.name', v);
  };
  const fkey = (guest ? 'guest' : 'booth') + '.chars.' + p.id;
  const [filter, setFilter] = useState(() => LS.get(fkey, []) || []);
  const lines = p.lines.filter((l) => !filter.length || filter.includes(l.char));
  const [lineId, setLineId] = useState(() => s.route[3] || (lines[0] && lines[0].id));
  const line = lines.find((l) => l.id === lineId) || lines[0];
  const idx = line ? lines.indexOf(line) : -1;
  const globalIdx = line ? p.lines.indexOf(line) : -1;
  const [phase, setPhase] = useState('idle');
  const [bufs, setBufs] = useState(null);
  const [side, setSide] = useState(() => LS.get('booth.side', 'lines'));
  const [bulkFiles, setBulkFiles] = useState(null);
  const [testing, setTesting] = useState(false);
  const recInfo = useRef(null);
  const pending = useRef(null);
  const stage = useRef(null);
  const fileIn = useRef(null);
  const bulkIn = useRef(null);
  const claimed = useRef(null);
  const dur = p.clip.duration;
  const chars = Object.fromEntries(p.characters.map((c) => [c.id, c]));
  const c = line ? chars[line.char] : null;
  const roomOpen = s.room && s.room.status === 'on' && (guest || s.room.projectId === p.id);

  useEffect(() => {
    let alive = true;
    const u = stemUrls(p, guest);
    Promise.all([engine.load(u.bg), engine.load(u.amb), engine.load(u.voices), guest ? null : engine.load(u.original)])
      .then(([bg, amb, voices, original]) => alive && setBufs({ bg, amb, voices, original }))
      .catch(toastError);
    return () => (alive = false);
  }, [p.stems.ver]);

  useEffect(() => () => {
    if (recInfo.current) {
      recInfo.current = null;
      recorder.stop();
    }
    player.stop();
    recorder.close();
  }, []);

  // picking exactly one role claims it (and gives the previous one back); the room sees it live
  const pickRoles = (f) => {
    setFilter(f);
    LS.set(fkey, f);
    const want = f.length === 1 ? f[0] : null;
    const body = guest ? {} : { name: name || 'Ben' };
    if (claimed.current && claimed.current !== want) api.post(P(p.id, `/characters/${claimed.current}/unclaim`), body).catch(() => {});
    if (want && want !== claimed.current) api.post(P(p.id, `/characters/${want}/claim`), body).catch(() => {});
    claimed.current = want;
  };
  useEffect(() => {
    claimed.current = filter.length === 1 ? filter[0] : null;
  }, []);
  const myChar = filter.length === 1 ? filter[0] : null;
  useEffect(() => {
    if (!roomOpen) return;
    const beat = () => (guest
      ? api.post('/api/guest/heartbeat', { view: 'record', line: globalIdx + 1, char: myChar })
      : api.post('/api/room/presence', { projectId: p.id, name: name || 'Ben', char: myChar, line: globalIdx + 1, view: 'record' })).catch(() => {});
    beat();
    const t = setInterval(beat, 10000);
    return () => clearInterval(t);
  }, [roomOpen, line && line.id, myChar, name]);

  // what plays under a line: background + ambience (birds, wind...); guests' lite background already holds both
  const bed = (bus) => [{ buffer: bufs.bg, at: 0, bus }, { buffer: bufs.amb, at: 0, bus }];

  const stopAll = () => {
    if (recInfo.current) return finish(true);
    player.stop();
    if (phase !== 'upload' && phase !== 'process') setPhase('idle');
  };

  const listen = () => {
    if (!bufs || !line || recInfo.current) return;
    const items = bufs.original ? [{ buffer: bufs.original, at: 0 }] : [...bed(), { buffer: bufs.voices, at: 0 }];
    setPhase('listen');
    player.play({ from: Math.max(0, line.start - 0.8), to: Math.min(dur, line.end + 0.5), items, onEnd: () => setPhase('idle') });
  };

  const review = async (l = line, t = selectedTake(l)) => {
    if (!bufs || !l || !t || t.status !== 'ready' || recInfo.current) return;
    const buf = await engine.load(takeUrl(p, t)).catch(toastError);
    if (!buf) return;
    const at = t.start + (t.nudge || 0);
    const a = at + (t.trimIn || 0);
    const b = at + t.duration - (t.trimOut || 0);
    setPhase('review');
    player.play({
      from: Math.max(0, Math.min(l.start, a) - 0.6), to: Math.min(dur, Math.max(l.end, b) + 0.5),
      items: [...bed(), { buffer: buf, at, region: [a, b], gain: db2gain(t.gain || 0) }], onEnd: () => setPhase('idle'),
    });
  };

  const playScene = async () => {
    stopAll();
    const b = await loadMixBuffers(p, { lite: guest }).catch(toastError);
    if (!b) return;
    setPhase('listen');
    player.play({ from: 0, to: dur, ...buildMix(p, b, 'dub'), onEnd: () => setPhase('idle') });
  };

  const record = async () => {
    if (!line || !bufs) return;
    if (phase === 'rec') return finish(false);
    if (phase === 'upload' || testing) return;
    player.stop();
    try {
      await recorder.open();
    } catch (e) {
      toastError(e);
      return;
    }
    const from = line.start - settings.preroll;
    const to = settings.autoStop ? Math.min(dur + 1, line.end + settings.tail) : dur + 0.5;
    const items = [];
    if (settings.bg) items.push(...bed('bg'));
    if (settings.guide > 0) items.push({ buffer: bufs.voices, at: 0, gain: settings.guide, bus: 'guide' });
    const beeps = settings.beeps ? [line.start - 1.5, line.start - 1.0, line.start - 0.5] : [];
    recorder.start();
    recInfo.current = { lineId: line.id, from };
    setPhase('rec');
    player.play({ from, to, items, beeps, onEnd: () => finish(false) });
    recInfo.current.t0 = player.t0;
  };

  const finish = async (cancel) => {
    const info = recInfo.current;
    if (!info) return;
    recInfo.current = null;
    player.stop();
    const rec = await recorder.stop();
    if (cancel || !rec || rec.samples.length < rec.sampleRate * 0.3) {
      setPhase('idle');
      return;
    }
    const recStart = info.from + (rec.firstTime - info.t0) - recorder.roundTrip();
    const pr = micPrefs();
    setPhase('upload');
    try {
      const q = `?recStart=${recStart.toFixed(4)}&source=booth&align=${settings.align}&by=${encodeURIComponent(name || 'Ben')}` +
        `&hpf=${pr.hpf ? 1 : 0}&denoise=${pr.denoise ? 1 : 0}`;
      const r = await upload(P(p.id, `/lines/${info.lineId}/takes${q}`), encodeWav(rec.samples, rec.sampleRate));
      pending.current = { takeId: r.takeId, lineId: info.lineId };
      setPhase('process');
    } catch (e) {
      toastError(e);
      setPhase('idle');
    }
  };

  // five seconds of raw microphone, played straight back: how will I sound?
  const testRec = async () => {
    if (testing || recInfo.current) return;
    try {
      await recorder.open();
    } catch (e) {
      toastError(e);
      return;
    }
    player.stop();
    setTesting(true);
    recorder.start();
    await sleep(5000);
    const r = await recorder.stop();
    setTesting(false);
    if (!r || !r.samples.length) return;
    const ctx = engine.ensure();
    const b = ctx.createBuffer(1, r.samples.length, r.sampleRate);
    b.copyToChannel(r.samples, 0);
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.connect(engine.master);
    src.start();
    toast('Deneme kaydı çalıyor', 'info', 5000);
  };

  useEffect(() => {
    const pd = pending.current;
    if (!pd) return;
    const l = p.lines.find((x) => x.id === pd.lineId);
    const t = l && (l.takes || []).find((x) => x.id === pd.takeId);
    if (!t) return;
    if (t.status === 'ready') {
      pending.current = null;
      if (t.silent) toast('Kayıtta ses duyulmadı. Mikrofonun açık mı?', 'error');
      if (settings.autoReview && l.id === (line && line.id)) review(l, t);
      else setPhase('idle');
    } else if (t.status === 'error') {
      pending.current = null;
      toast('Kayıt işlenemedi: ' + (t.error || ''), 'error');
      setPhase('idle');
    }
  }, [p]);

  const goTo = (l) => {
    if (!l || recInfo.current) return;
    player.stop();
    setPhase(pending.current ? 'process' : 'idle');
    setLineId(l.id);
    player.seek(Math.max(0, l.start - 0.2));
    const el = document.getElementById('bl-' + l.id);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const next = () => idx + 1 < lines.length && goTo(lines[idx + 1]);
  const prev = () => idx > 0 && goTo(lines[idx - 1]);

  useEffect(() => {
    if (line) player.seek(Math.max(0, line.start - 0.2));
  }, [bufs]);

  useEffect(() => {
    const key = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || e.repeat || bulkFiles) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') {
        e.preventDefault();
        record();
      } else if (e.key === 'Escape') stopAll();
      else if (k === 'p') listen();
      else if (k === 'l') review();
      else if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        next();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        prev();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const lane = line ? { t0: line.start - Math.max(1.2, settings.preroll + 0.2), t1: line.end + 0.9 } : null;

  // countdown, streamer, rhythm playhead and word highlights follow the player clock without re-rendering
  useEffect(() => {
    if (!line) return;
    const root = stage.current;
    if (!root) return;
    const q = (sel) => root.querySelector(sel);
    const cd = q('.countdown');
    const num = cd && q('.cd-num');
    const ring = q('.cd-ring circle');
    const cue = q('.cue-go');
    const streamer = q('.streamer');
    const head = q('.rh-head');
    const rhythm = q('.rhythm');
    const rws = [...root.querySelectorAll('.rw')];
    const cws = [...root.querySelectorAll('.cw')];
    let shown = '';
    const upd = () => {
      const t = player.time;
      const playing = player.playing;
      const rec = phase === 'rec' && playing;
      const left = line.start - t;
      if (cd) {
        let txt = '';
        if (rec && left > 0) {
          const n = Math.ceil(left / 0.5 - 1e-6);
          txt = n <= 3 ? String(n) : 'Hazır';
          ring.style.strokeDashoffset = RING * (1 - clamp(left / Math.max(0.5, settings.preroll), 0, 1));
        }
        cd.classList.toggle('show', !!txt);
        if (txt !== shown) {
          shown = txt;
          num.classList.toggle('word', txt === 'Hazır');
          num.querySelector('.cd-txt').textContent = txt;
          if (txt && document.documentElement.dataset.motion !== 'off')
            num.animate([{ transform: 'scale(1.3)', opacity: 0.2 }, { transform: 'scale(1)', opacity: 1 }], { duration: 240, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
        }
      }
      if (cue) cue.hidden = !(rec && t >= line.start && t <= line.end);
      if (streamer) {
        const span = Math.max(1, settings.preroll);
        const on = rec && settings.streamer && left > 0 && left <= span;
        streamer.style.opacity = on ? '1' : '0';
        if (on) streamer.style.transform = `translateX(${(1 - left / span) * streamer.parentElement.clientWidth}px)`;
      }
      if (head && rhythm) {
        const x = (t - lane.t0) / (lane.t1 - lane.t0);
        head.style.opacity = x >= 0 && x <= 1 && (playing || t > lane.t0) ? '1' : '0';
        head.style.transform = `translateX(${clamp(x, 0, 1) * rhythm.clientWidth}px)`;
      }
      for (const w of rws) w.classList.toggle('on', playing && t >= +w.dataset.s && t <= +w.dataset.e + 0.04);
      for (const w of cws) {
        w.classList.toggle('on', playing && t >= +w.dataset.s && t < +w.dataset.e);
        w.classList.toggle('past', playing && t >= +w.dataset.e);
      }
    };
    upd();
    return player.on(upd);
  }, [line && line.id, line && line.start, line && line.end, line && line.text, phase, settings.preroll, settings.streamer, bufs]);

  const uploadFile = async (file, l = line) => {
    if (!file || !l) return;
    try {
      await upload(P(p.id, `/lines/${l.id}/takes?source=upload&by=${encodeURIComponent(name || 'Ben')}&filename=${encodeURIComponent(file.name)}`), file);
      toast(`${file.name}, ${p.lines.indexOf(l) + 1}. satıra eklendi`, 'ok');
    } catch (e) {
      toastError(e);
    }
  };

  if (!p.lines.length) return html`<div class="page narrow"><div class="empty"><${Icon} name="text" size=${32} /><h3>Kaydedilecek satır yok</h3><p class="muted">Önce Senaryo ekranında satır ekle.</p></div></div>`;

  const take = line ? selectedTake(line) : null;
  const recording = phase === 'rec';
  const busy = phase === 'upload' || phase === 'process';
  const doneCount = lines.filter((l) => l.take).length;

  return html`<div class=${cls('page booth', guest && 'guest', recording && 'is-rec')}>
    <div class="booth-main" ref=${stage}>
      <section class="pane booth-stage">
        <${VideoPane} src=${fileUrl(p.id, p.clip.preview, p.clip.ver)} poster=${fileUrl(p.id, p.clip.thumb, p.clip.ver)} class="booth-video">
          <i class="streamer"></i>
          <div class="countdown"><div class="cd-num"><svg class="cd-ring" viewBox="0 0 132 132"><circle cx="66" cy="66" r="60"
            style=${{ strokeDasharray: RING, strokeDashoffset: 0 }} /></svg><span class="cd-txt"></span></div></div>
          <div class="cue-go" hidden>Konuş</div>
          <span class=${cls('tally booth-tally', recording && 'on')}>Rec</span>
        </${VideoPane}>
        ${line && html`<div class="cue" style=${{ '--c': c ? c.color : '#8c897f' }}>
          <div class="cue-head">
            <span class="hl" style=${{ '--c': c ? c.color : '#8c897f' }}>${c ? c.name : ''}</span>
            <span class="tc dim">${globalIdx + 1}/${p.lines.length}</span>
            <span class="grow"></span>
            <span class="tc-lcd" title="Satırın süresi">${(line.end - line.start).toFixed(1)} sn</span>
          </div>
          <div class="cue-text" key=${line.id}><${CueText} line=${line} /></div>
          <div class="cue-orig dim small">${line.orig}</div>
        </div>`}
        ${line && lane && html`<${RhythmLane} line=${line} buffer=${bufs && bufs.voices} t0=${lane.t0} t1=${lane.t1} color=${c ? c.color : null} />`}
        <div class="booth-controls">
          <div class="bc-side">
            <${Btn} kind="ghost" icon="prev" onClick=${prev} disabled=${idx <= 0 || recording} title="Önceki satır (↑)" />
            <${Btn} icon="headphones" onClick=${listen} disabled=${!bufs || recording} title="Orijinali dinle (P)">Orijinal</${Btn}>
          </div>
          <div class="recwrap">
            <button class=${cls('recbtn', recording && 'on', busy && 'busy')} onClick=${record} disabled=${!bufs || busy || testing}
              title="Kaydet / durdur (Boşluk)" aria-label=${recording ? 'Kaydı durdur' : 'Kaydet'}><span class="recbtn-core"></span></button>
            <span class="reclabel">${recording ? 'Durdur' : phase === 'upload' ? 'Gönderiliyor' : phase === 'process' ? 'İşleniyor' : take ? 'Tekrar kaydet' : 'Kaydet'}</span>
          </div>
          <div class="bc-side right">
            <${Btn} icon="play" onClick=${() => review()} disabled=${!take || take.status !== 'ready' || recording} title="Kaydımı dinle (L)">Kaydım</${Btn}>
            <${Btn} kind="ghost" icon="next" onClick=${next} disabled=${idx >= lines.length - 1 || recording} title="Sonraki satır (Enter)" />
          </div>
        </div>
        <div class="booth-meter"><${Icon} name="mic" size=${14} /><${LevelMeter} /></div>
        <div class="booth-hint">
          <span><${Kbd}>Boşluk</${Kbd}> kaydet</span><span><${Kbd}>P</${Kbd}> orijinal</span><span><${Kbd}>L</${Kbd}> kaydım</span>
          <span><${Kbd}>Enter</${Kbd}> sonraki</span><span><${Kbd}>Esc</${Kbd}> iptal</span>
        </div>
      </section>
      ${line && html`<section class="pane takes-pane">
        <div class="pane-head"><h3>Kayıtlar</h3><span class="count">${(line.takes || []).length}</span><span class="grow"></span>
          <input type="file" hidden ref=${fileIn} accept="audio/*,video/*,.m4a,.opus,.ogg,.mp3,.wav,.aac,.amr,.webm,.flac"
            onChange=${(e) => { uploadFile(e.target.files[0]); e.target.value = ''; }} />
          <${Btn} small kind="ghost" icon="upload" onClick=${() => fileIn.current.click()} title="WhatsApp sesli mesajı ya da ses dosyası">Dosyadan</${Btn}>
        </div>
        <div class="pane-scroll"><${TakeList} p=${p} line=${line} me=${name} guest=${guest} onPlay=${(t) => review(line, t)} /></div>
      </section>`}
    </div>
    <aside class="booth-side pane">
      <div class="pane-head"><h3>Roller</h3><span class="grow"></span>${roomOpen && html`<${Lamp} tone="ok">oda açık</${Lamp}>`}</div>
      <${Roles} p=${p} filter=${filter} setFilter=${pickRoles} room=${s.room} guest=${guest} />
      <div class="side-tabs"><${Segmented} value=${side} onChange=${(v) => { setSide(v); LS.set('booth.side', v); }}
        options=${[['lines', `Satırlar ${doneCount}/${lines.length}`], ['booth', 'Kabin']]} /></div>
      ${side === 'lines'
        ? html`<div class="pane-scroll lineslist">${lines.map((l) => {
            const lc = chars[l.char];
            return html`<button key=${l.id} id=${'bl-' + l.id} class=${cls('lineitem', l.id === (line && line.id) && 'sel', l.take && 'done')} onClick=${() => goTo(l)}>
              <span class="lineitem-n tc">${p.lines.indexOf(l) + 1}</span><span class="swatch" style=${{ '--c': lc ? lc.color : '#8c897f' }}></span>
              <span class="lineitem-t">${l.text || l.orig}</span>
              ${l.take ? html`<${Icon} name="check" size=${14} />` : ''}
            </button>`;
          })}</div>`
        : html`<div class="pane-scroll"><${BoothSettings} settings=${settings} set=${set} guest=${guest} name=${name} setName=${setName} onTestRec=${testRec} testing=${testing} /></div>`}
      <div class="side-foot">
        <${Btn} small icon="play" onClick=${playScene}>Sahneyi dublajla dinle</${Btn}>
        ${!guest && html`<input type="file" hidden multiple ref=${bulkIn} accept="audio/*,video/*,.m4a,.opus,.ogg,.mp3,.wav,.aac,.amr,.webm,.flac"
            onChange=${(e) => { setBulkFiles([...e.target.files]); e.target.value = ''; }} />
          <${Btn} small icon="upload" onClick=${() => bulkIn.current.click()} title="Arkadaşlarının gönderdiği ses dosyalarını satırlara dağıt">Toplu yükle</${Btn}>`}
      </div>
    </aside>
    ${bulkFiles && html`<${BulkDialog} p=${p} files=${bulkFiles} name=${name} onClose=${() => setBulkFiles(null)} />`}
  </div>`;
}
