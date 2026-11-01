// Recording booth (ADR): streamer + 3 beeps, a big rhythm lane of the original line, karaoke dub text, sample-accurate
// takes, instant review. The side holds the roles, the line list and the booth settings (microphone, processing).
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P, upload } from '../api.js';
import { Btn, Field, Icon, Lamp, LevelMeter, Modal, PlayButton, Range, Segmented, Select, Toggle, VideoPane, VolumeControl } from '../components.js';
import { bedItems, buildMix, engine, loadMixBuffers, player, stemUrls, takeUrl } from '../engine.js';
import { listMics, micPrefs, NOISE_ENGINES, onMicPrefs, recorder, setMicPref } from '../recorder.js';
import { FeatureOffer } from '../feature-ui.js';
import { t } from '../i18n.js';
import { ask, featureReady, toast, toastError, useStore } from '../state.js';
import { clamp, cls, db2gain, drawWave, encodeWav, LS, revealInList, selectedTake, sleep, syllables, timeAgo } from '../util.js';

// bed: level of the background (music, effects, ambience) under everything the booth plays; guide: the original
// dialogue in your ears while you record. Both 0..1, set from the listening strip under the controls.
const DEFAULTS = { preroll: 2, beeps: true, streamer: true, bed: 1, guide: 0, autoStop: true, tail: 1.0, autoReview: true, align: 'auto' };
const STATUS = { processing: ['busy', 'işleniyor'], error: ['bad', 'hata'] };
const RING = 2 * Math.PI * 60;

/** Dub text as words that light up in turn: each word gets a share of the line in proportion to its syllables. */
function CueText({ line }) {
  const words = (line.text || '').split(/\s+/).filter(Boolean);
  if (!words.length) return html`<em class="dim">${t('Dublaj metni boş.')}</em>`;
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
    <i class="rh-in" style=${{ left: pct(line.start) }}><span>${t('GİRİŞ')}</span></i>
    <i class="rh-out" style=${{ left: pct(line.end) }}></i>
    <i class="rh-head"></i>
  </div>`;
}

function TakeList({ p, line, me, guest, onPlay }) {
  if (!line.takes || !line.takes.length) return html`<div class="takes-empty dim">${t('Henüz kayıt yok.')}</div>`;
  const sel = (tid) => api.post(P(p.id, `/lines/${line.id}/select`), { take: tid }).catch(toastError);
  const del = async (tk, n) => {
    if (await ask({ title: t('{n}. kayıt silinsin mi?', { n }), text: `${tk.by} · ${timeAgo(tk.created)}`, ok: t('Sil'), danger: true }))
      api.del(P(p.id, `/lines/${line.id}/takes/${tk.id}`)).catch(toastError);
  };
  return html`<div class="takes">${[...line.takes].reverse().map((tk, i) => {
    const n = line.takes.length - i;
    const mine = !guest || tk.by === me;
    const [tone, label] = STATUS[tk.status] || (tk.silent ? ['warn', 'ses yok'] : ['', '']);
    // only a take that just arrived drops into the list; the ones already there do not move when the page opens
    const fresh = Date.now() / 1000 - tk.created < 12;
    return html`<div key=${tk.id} class=${cls('take', line.take === tk.id && 'sel', tk.status, fresh && 'fresh')}>
      <button class="iconbtn" disabled=${tk.status !== 'ready'} title=${t('Dinle')} onClick=${() => onPlay(tk)}><${Icon} name="play" size=${14} /></button>
      <span class="take-n tc">${String(n).padStart(2, '0')}</span>
      <div class="take-info"><strong>${tk.by}</strong><span class="dim small">${timeAgo(tk.created)}${tk.source === 'tts' ? ' · ' + t('yapay zeka') : tk.source === 'upload' ? ' · ' + t('dosya') : ''}${tk.denoise ? ' · ' + t('temizlendi') : ''}</span></div>
      ${label && html`<${Lamp} tone=${tone}>${t(label)}</${Lamp}>`}
      ${line.take === tk.id ? html`<${Lamp} tone="ok">${t('seçili')}</${Lamp}>` : html`<${Btn} small kind="ghost" onClick=${() => sel(tk.id)} disabled=${tk.status !== 'ready'}>${t('Kullan')}</${Btn}>`}
      ${mine && html`<button class="iconbtn" title=${t('Sil')} onClick=${() => del(tk, n)}><${Icon} name="trash" size=${15} /></button>`}
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
    <button class=${cls('role', !filter.length && 'on')} onClick=${() => setFilter([])}><span class="role-name">${t('Hepsi')}</span>
      <span class="dim small">${t('{n} satır', { n: p.lines.length })}</span></button>
    ${p.characters.map((ch) => {
      const n = p.lines.filter((l) => l.char === ch.id).length;
      const done = p.lines.filter((l) => l.char === ch.id && l.take).length;
      const names = [...new Set([...(live[ch.id] || []), ...(ch.actor || '').split(',').map((x) => x.trim()).filter(Boolean)])];
      return html`<button key=${ch.id} class=${cls('role', filter.includes(ch.id) && 'on')} style=${{ '--c': ch.color }}
        onClick=${() => setFilter(filter.length === 1 && filter[0] === ch.id ? [] : [ch.id])}
        title=${guest ? t('Bu rolü al') : t('Bu rolü seslendiriyorum')}>
        <span class="role-name"><span class="hl" style=${{ '--c': ch.color }}>${ch.name}</span></span>
        <span class="role-who">${live[ch.id] ? html`<span class="lamp ok"></span>` : ''}${names.join(', ') || html`<span class="dim">${t('boş')}</span>`}</span>
        <span class="tc dim small">${done}/${n}</span></button>`;
    })}
  </div>`;
}

function useMics() {
  const [mics, setMics] = useState([]);
  useEffect(() => {
    const refresh = () => listMics().then(setMics);
    refresh();
    navigator.mediaDevices && navigator.mediaDevices.addEventListener('devicechange', refresh);
    const off = recorder.onState(refresh); // names show up once the microphone was allowed
    return () => {
      off();
      navigator.mediaDevices && navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);
  return mics.some((m) => m.id === '') ? mics.map((m) => [m.id, m.label]) : [['', t('Varsayılan mikrofon')], ...mics.map((m) => [m.id, m.label])];
}

/** The microphone, right where you record: switching reopens it at once. */
function MicSelect() {
  const options = useMics();
  const [dev, setDev] = useState(() => micPrefs().deviceId);
  useEffect(() => onMicPrefs(() => setDev(micPrefs().deviceId)), []);
  const pick = async (v) => {
    setMicPref('device', v);
    if (recorder.ready) await recorder.open(true).catch(toastError);
  };
  return html`<${Select} class="mon-mic" value=${dev} onChange=${pick} options=${options} label=${t('Mikrofon')} />`;
}

/** What you hear in the booth: the listening volume, the background and the original dialogue while recording. The
 *  microphone row ends in the way to its settings, where people look for them. */
function Listening({ settings, setLevel, onMicSettings, micOpen }) {
  return html`<div class="booth-mon">
    <div class="mon mon-mic-row">
      <${Icon} name="mic" size=${15} /><${MicSelect} /><${LevelMeter} />
      <button class=${cls('btn btn-sm btn-ghost mon-set', micOpen && 'active')} onClick=${onMicSettings} aria-pressed=${!!micOpen}>
        <${Icon} name="gear" size=${14} /><span>${t('Mikrofon ayarları')}</span></button>
    </div>
    <div class="mon mon-levels">
      <${VolumeControl} />
      <label class="mon-lvl" title=${t('Fon müziği, efektler ve ortam sesleri: dinlerken ve kayıtta')}><span>${t('Fon')}</span>
        <${Range} min=${0} max=${1} step=${0.05} value=${settings.bed} onInput=${(v) => setLevel('bed', v)} /></label>
      <label class="mon-lvl" title=${t('Kayıt sırasında kulağına gelen orijinal konuşma (rehber ses)')}><span>${t('Orijinal')}</span>
        <${Range} min=${0} max=${1} step=${0.05} value=${settings.guide} onInput=${(v) => setLevel('guide', v)} /></label>
    </div>
  </div>`;
}

function BoothSettings({ settings, set, guest, name, setName, onTestRec, testing }) {
  const options = useMics();
  const [mics, setMics] = useState([]);
  const [pr, setPr] = useState(micPrefs);
  const [open, setOpen] = useState(recorder.ready);
  const [info, setInfo] = useState(recorder.info);
  useEffect(() => {
    listMics().then(setMics);
    const off = recorder.onState((r) => {
      setOpen(r.ready);
      setInfo(r.info);
      listMics().then(setMics);
    });
    const offPrefs = onMicPrefs(() => setPr(micPrefs()));
    return () => {
      off();
      offPrefs();
    };
  }, []);
  // a capture setting changed: reopen the microphone so it applies right away
  const change = async (k, v, reopen = true) => {
    setMicPref(k, v);
    setPr(micPrefs());
    if (reopen && recorder.ready) await recorder.open(true).catch(toastError);
  };
  const toggleTest = () => (recorder.ready ? recorder.close() : recorder.open().catch(toastError));
  const headset = info ? info.headset : (mics.find((m) => m.id === pr.deviceId) || {}).headset;
  const cleanOk = canClean(guest);
  return html`<div class="boothsettings">
    <div class="seclabel">${t('Mikrofon')}</div>
    ${!guest && html`<${Field} label=${t('Kaydı yapan')}><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /></${Field}>`}
    <div class="row nowrap mic-pick">
      <${Select} class="grow" value=${pr.deviceId} onChange=${(v) => change('device', v)} options=${options} label=${t('Mikrofon')} />
      <button class="iconbtn" title=${t('Listeyi yenile')} onClick=${() => navigator.mediaDevices && navigator.mediaDevices.dispatchEvent(new Event('devicechange'))}><${Icon} name="refresh" size=${15} /></button>
    </div>
    <div class="mic-test">
      <${Btn} small kind=${open ? 'primary' : ''} icon=${open ? 'stop' : 'mic'} onClick=${toggleTest}>${open ? t('Testi durdur') : t('Mikrofonu test et')}</${Btn}>
      <${LevelMeter} />
    </div>
    ${headset && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />${t('Bluetooth kulaklık mikrofonu sesi boğuk kaydeder. Kablolu ya da USB mikrofon seç.')}</div>`}
    <${Toggle} checked=${pr.monitor} onChange=${(v) => { setMicPref('monitor', v); setPr(micPrefs()); recorder.setMonitor(v); if (v && !recorder.ready) recorder.open().catch(toastError); }}
      label=${html`<span class="toggle-text">${t('Kendimi duy')}<small>${t('Sadece kulaklıkla.')}</small></span>`} />
    ${pr.monitor && html`<${Field} label=${t('Dinleme seviyesi: %{n}', { n: Math.round(pr.monitorGain * 100) })}>
      <${Range} min=${0} max=${1.5} step=${0.05} value=${pr.monitorGain} onInput=${(v) => { setMicPref('monitorGain', v); setPr(micPrefs()); recorder.setMonitor(true, v); }} />
    </${Field}>`}
    <${Btn} small icon=${testing ? 'stop' : 'rec'} kind=${testing ? 'rec' : ''} onClick=${onTestRec} disabled=${testing}>${testing ? t('Kaydediliyor… 5 sn') : t('5 sn deneme kaydı al ve dinle')}</${Btn}>

    <div class="seclabel">${t('Gürültü engelleme')}</div>
    <div class="noise-pick"><${Segmented} value=${pr.noise} onChange=${(v) => change('ns', v)} options=${NOISE_ENGINES.map(([k, l]) => [k, t(l)])} /></div>
    <p class="noise-note">${t(NOISE_NOTE[pr.noise])}</p>
    ${pr.noise === 'dpdfnet' && !cleanOk && html`<${FeatureOffer} id="cleanup" text=${t('DPDFNet için bunu indirmen gerekiyor. O zamana kadar Standart kullanılır.')} />`}
    ${pr.noise === 'rnnoise' && open && info && info.noise !== 'rnnoise' && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />
      ${info.noise === 'standard' ? t('RNNoise açılamadı; Standart kullanılıyor.') : t('RNNoise açılamadı; ses işlenmeden kaydediliyor.')}</div>`}
    <${Toggle} checked=${pr.echoCancellation} onChange=${(v) => change('ec', v)} label=${t('Yankı engelleme')} />
    <${Toggle} checked=${pr.autoGainControl} onChange=${(v) => change('agc', v)} label=${t('Otomatik kazanç')} />
    <${Toggle} checked=${pr.hpf} onChange=${(v) => change('hpf', v, false)} label=${t('Alçak kesme 80 Hz')} />

    <div class="seclabel">${t('rec|Kayıt')}</div>
    <${Field} label=${t('Geri sayım')}>
      <${Select} value=${String(settings.preroll)} onChange=${(v) => set('preroll', Number(v))} options=${[1, 2, 3, 4].map((n) => [String(n), t('{n} sn', { n })])} />
    </${Field}>
    <${Toggle} checked=${settings.streamer} onChange=${(v) => set('streamer', v)} label=${t('Akış çizgisi')} />
    <${Toggle} checked=${settings.beeps} onChange=${(v) => set('beeps', v)} label=${t('3 bip')} />
    <${Toggle} checked=${settings.autoStop} onChange=${(v) => set('autoStop', v)} label=${t('Satır bitince kaydı durdur')} />
    <${Toggle} checked=${settings.autoReview} onChange=${(v) => set('autoReview', v)} label=${t('Kayıttan sonra dinlet')} />
    <${Toggle} checked=${settings.align === 'auto'} onChange=${(v) => set('align', v ? 'auto' : 'recorded')} label=${t('Konuşmayı orijinal girişe hizala')} />
    <${Field} label=${html`${t('Gecikme düzeltme')} <span class="tc">${pr.latencyMs} ms</span>`} hint=${t('Kayıtlar hep geç oturuyorsa artır.')}>
      <${Range} min=${-200} max=${400} step=${10} value=${pr.latencyMs} onInput=${(v) => change('latency', v, false)} />
    </${Field}>
  </div>`;
}

// the notes are translated where they are shown (t())
const NOISE_NOTE = {
  standard: 'Tarayıcının kendi gürültü bastırması.',
  rnnoise: 'Canlı yapay zeka: fan ve uğultu kayıt sırasında silinir.',
  dpdfnet: 'En temiz sonuç: kayıt bitince yapay zekayla temizlenir.',
  off: 'Ses olduğu gibi kaydedilir.',
};
// DPDFNet comes with "Kayıt temizleme" (or "Müziği koru", which uses it too); a guest's takes are cleaned by the host
const canClean = (guest) => guest || featureReady('cleanup') || featureReady('separate');

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
        await upload(P(p.id, `/lines/${l.id}/takes?source=upload&by=${encodeURIComponent(name || t('Ben'))}&filename=${encodeURIComponent(x.file.name)}`), x.file);
        ok++;
        setPlan((pl) => pl.map((y, j) => (j === i ? { ...y, state: 'ok' } : y)));
      } catch (e) {
        setPlan((pl) => pl.map((y, j) => (j === i ? { ...y, state: 'err', error: e.message } : y)));
      }
    }
    setBusy(false);
    if (ok) toast(t('{n} kayıt eklendi', { n: ok }), 'ok');
  };
  const opts = [['', t('Atla')], ...p.lines.map((l, i) => [String(i + 1), `${i + 1}. ${(p.characters.find((c) => c.id === l.char) || {}).name || ''} · ${(l.text || l.orig || '').slice(0, 40)}`])];
  const assigned = plan.filter((x) => x.line).length;
  return html`<${Modal} title=${t('Toplu ses yükle')} onClose=${busy ? null : onClose} wide>
    <p class="muted small">${t('Dosya adındaki sayı satır numarası sayılır (ör. 3.m4a). WhatsApp sesli mesajlarında numara olmadığı için satırı elle seç ya da boş satırlara sırayla dağıt.')}</p>
    <div class="bulk">${plan.map((x, i) => html`<div class="bulk-row" key=${i}>
      <span class="mono small ellipsis" title=${x.file.name}>${x.file.name}</span>
      <${Select} value=${x.line ? String(x.line) : ''} onChange=${(v) => setLine(i, v)} options=${opts} disabled=${busy} />
      <span class="bulk-state">${x.state === 'up' ? html`<${Lamp} tone="busy">${t('yükleniyor')}</${Lamp}>` : x.state === 'ok' ? html`<${Lamp} tone="ok">${t('eklendi')}</${Lamp}>` : x.state === 'err' ? html`<${Lamp} tone="bad" title=${x.error}>${t('hata')}</${Lamp}>` : ''}</span>
    </div>`)}</div>
    <div class="modal-actions"><${Btn} kind="ghost" onClick=${fillEmpty} disabled=${busy}>${t('Boş satırlara sırayla dağıt')}</${Btn}><span class="grow"></span>
      <${Btn} onClick=${onClose} disabled=${busy}>${t('Kapat')}</${Btn}>
      <${Btn} kind="primary" icon="upload" onClick=${go_} disabled=${busy || !assigned}>${t('{n} dosyayı yükle', { n: assigned })}</${Btn}></div>
  </${Modal}>`;
}

export function BoothView({ p, guest = false }) {
  const s = useStore();
  const [settings, setSettings] = useState(() => {
    const st = { ...DEFAULTS, ...LS.get('booth.settings', {}) };
    if ('bg' in st) {
      if (st.bg === false) st.bed = 0; // 1.2 and older had the background on or off
      delete st.bg;
    }
    return st;
  });
  const set = (k, v) => {
    const n = { ...settings, [k]: v };
    setSettings(n);
    LS.set('booth.settings', n);
  };
  const [name, setNameState] = useState(() => (guest ? s.guestName : LS.get('booth.name', t('Ben'))));
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
  const showSide = (v) => {
    setSide(v);
    LS.set('booth.side', v);
  };
  const [bulkFiles, setBulkFiles] = useState(null);
  const [testing, setTesting] = useState(false);
  const recInfo = useRef(null);
  const pending = useRef(null);
  const stage = useRef(null);
  const fileIn = useRef(null);
  const bulkIn = useRef(null);
  const claimed = useRef(null);
  const sceneBuses = useRef(null);
  const dur = p.clip.duration;
  const chars = Object.fromEntries(p.characters.map((c) => [c.id, c]));
  const c = line ? chars[line.char] : null;
  const roomOpen = s.room && s.room.status === 'on' && (guest || s.room.projectId === p.id);
  // DPDFNet picked but not downloaded: the microphone uses the browser's suppression until it is
  const cleanOk = canClean(guest);
  useEffect(() => {
    if (recorder.canClean === cleanOk) return;
    recorder.canClean = cleanOk;
    if (recorder.ready && micPrefs().noise === 'dpdfnet') recorder.open(true).catch(() => {});
  }, [cleanOk]);

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
    const body = guest ? {} : { name: name || t('Ben') };
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
      : api.post('/api/room/presence', { projectId: p.id, name: name || t('Ben'), char: myChar, line: globalIdx + 1, view: 'record' })).catch(() => {});
    beat();
    const t = setInterval(beat, 10000);
    return () => clearInterval(t);
  }, [roomOpen, line && line.id, myChar, name]);

  // what plays under a line: background + ambience (birds, wind...), their muted stretches silent; guests' lite
  // background already holds both
  const bed = (bus) => bedItems(p, bufs, bus, bus);

  const stopAll = () => {
    if (recInfo.current) return finish(true);
    player.stop();
    if (phase !== 'upload' && phase !== 'process') setPhase('idle');
  };
  const playing = ['orig', 'scene', 'review'].includes(phase);

  // a level slider moved: what is playing follows at once
  const setLevel = (k, v) => {
    set(k, v);
    if (k === 'bed') {
      const base = sceneBuses.current;
      if (phase === 'scene' && base) {
        player.setBusGain('bg', base.bg * v);
        player.setBusGain('amb', base.amb * v);
      } else player.setBusGain('bg', v);
    } else if (k === 'guide') player.setBusGain('guide', v);
  };

  const listen = () => {
    if (!bufs || !line || recInfo.current) return;
    if (phase === 'orig') return stopAll();
    const items = bufs.original ? [{ buffer: bufs.original, at: 0 }] : [...bed('bg'), { buffer: bufs.voices, at: 0 }];
    setPhase('orig');
    player.play({ from: Math.max(0, line.start - 0.8), to: Math.min(dur, line.end + 0.5), items, buses: { bg: settings.bed },
      onEnd: () => setPhase('idle') });
  };

  const review = async (l = line, tk = selectedTake(l)) => {
    if (!bufs || !l || !tk || tk.status !== 'ready' || recInfo.current) return;
    const buf = await engine.load(takeUrl(p, tk)).catch(toastError);
    if (!buf) return;
    const at = tk.start + (tk.nudge || 0);
    const a = at + (tk.trimIn || 0);
    const b = at + tk.duration - (tk.trimOut || 0);
    setPhase('review');
    player.play({
      from: Math.max(0, Math.min(l.start, a) - 0.6), to: Math.min(dur, Math.max(l.end, b) + 0.5),
      items: [...bed('bg'), { buffer: buf, at, region: [a, b], gain: db2gain(tk.gain || 0) }], buses: { bg: settings.bed },
      onEnd: () => setPhase('idle'),
    });
  };
  const toggleReview = () => (phase === 'review' ? stopAll() : review());

  /** The scene with every recorded take, from `from` on; the background follows the Fon slider. */
  const playScene = async (from) => {
    if (phase === 'scene') return stopAll();
    if (recInfo.current || phase === 'upload') return;
    const b = await loadMixBuffers(p, { lite: guest }).catch(toastError);
    if (!b) return;
    const mix = buildMix(p, b, 'dub');
    const base = { bg: mix.buses.bg ?? 1, amb: mix.buses.amb ?? 1 };
    sceneBuses.current = base;
    mix.buses.bg = base.bg * settings.bed;
    mix.buses.amb = base.amb * settings.bed;
    setPhase('scene');
    player.play({ from: clamp(from, 0, Math.max(0, dur - 0.2)), to: dur, ...mix, onEnd: () => setPhase('idle') });
  };
  const fromLine = () => (line ? line.start - 1 : 0);
  // the picture works like any player: a click stops what plays, or plays the scene from this line
  const clickVideo = () => {
    if (phase === 'rec' || phase === 'upload') return; // a click on the picture never ends a take
    if (playing) stopAll();
    else playScene(fromLine());
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
    // both are always there, at their slider's level: moving a slider mid-take is heard right away
    const items = [...bed('bg'), { buffer: bufs.voices, at: 0, bus: 'guide' }];
    const beeps = settings.beeps ? [line.start - 1.5, line.start - 1.0, line.start - 0.5] : [];
    recorder.start();
    recInfo.current = { lineId: line.id, from };
    setPhase('rec');
    player.play({ from, to, items, beeps, buses: { bg: settings.bed, guide: settings.guide }, onEnd: () => finish(false) });
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
      const q = `?recStart=${recStart.toFixed(4)}&source=booth&align=${settings.align}&by=${encodeURIComponent(name || t('Ben'))}` +
        `&hpf=${pr.hpf ? 1 : 0}&denoise=${recorder.noiseEngine(pr) === 'dpdfnet' ? 1 : 0}`;
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
    toast(t('Deneme kaydı çalıyor'), 'info', 5000);
  };

  useEffect(() => {
    const pd = pending.current;
    if (!pd) return;
    const l = p.lines.find((x) => x.id === pd.lineId);
    const tk = l && (l.takes || []).find((x) => x.id === pd.takeId);
    if (!tk) return;
    if (tk.status === 'ready') {
      pending.current = null;
      if (tk.silent) toast(t('Kayıtta ses duyulmadı. Mikrofonun açık mı?'), 'error');
      if (settings.autoReview && l.id === (line && line.id)) review(l, tk);
      else setPhase('idle');
    } else if (tk.status === 'error') {
      pending.current = null;
      toast(t('Kayıt işlenemedi: {e}', { e: tk.error || '' }), 'error');
      setPhase('idle');
    }
  }, [p]);

  const goTo = (l) => {
    if (!l || recInfo.current) return;
    player.stop();
    setPhase(pending.current ? 'process' : 'idle');
    setLineId(l.id);
    player.seek(Math.max(0, l.start - 0.2));
    revealInList(document.getElementById('bl-' + l.id));
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
      else if (k === 'l') toggleReview();
      else if (k === 'k') playScene(fromLine());
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
          txt = n <= 3 ? String(n) : t('Hazır');
          ring.style.strokeDashoffset = RING * (1 - clamp(left / Math.max(0.5, settings.preroll), 0, 1));
        }
        cd.classList.toggle('show', !!txt);
        if (txt !== shown) {
          shown = txt;
          num.classList.toggle('word', !!txt && !/^\d$/.test(txt));
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
      await upload(P(p.id, `/lines/${l.id}/takes?source=upload&by=${encodeURIComponent(name || t('Ben'))}&filename=${encodeURIComponent(file.name)}`), file);
      toast(t('{file}, {n}. satıra eklendi', { file: file.name, n: p.lines.indexOf(l) + 1 }), 'ok');
    } catch (e) {
      toastError(e);
    }
  };

  if (!p.lines.length) return html`<div class="page narrow"><div class="empty"><${Icon} name="text" size=${32} /><h3>${t('Kaydedilecek satır yok')}</h3><p class="muted">${t('Önce Senaryo ekranında satır ekle.')}</p></div></div>`;

  const take = line ? selectedTake(line) : null;
  const recording = phase === 'rec';
  const busy = phase === 'upload' || phase === 'process';
  const doneCount = lines.filter((l) => l.take).length;

  return html`<div class=${cls('page booth', guest && 'guest', recording && 'is-rec')}>
    <div class="booth-main" ref=${stage}>
      <section class="pane booth-stage">
        <${VideoPane} src=${fileUrl(p.id, p.clip.preview, p.clip.ver)} poster=${fileUrl(p.id, p.clip.thumb, p.clip.ver)} class="booth-video"
          onClick=${clickVideo} title=${playing ? t('Durdur') : t('Bu satırdan oynat')}>
          <i class="streamer"></i>
          <div class="countdown"><div class="cd-num"><svg class="cd-ring" viewBox="0 0 132 132"><circle cx="66" cy="66" r="60"
            style=${{ strokeDasharray: RING, strokeDashoffset: 0 }} /></svg><span class="cd-txt"></span></div></div>
          <div class="cue-go" hidden>${t('Konuş')}</div>
          <span class=${cls('tally booth-tally', recording && 'on')}>Rec</span>
        </${VideoPane}>
        ${line && html`<div class="cue" style=${{ '--c': c ? c.color : '#8c897f' }}>
          <div class="cue-head">
            <span class="hl" key=${line.id} style=${{ '--c': c ? c.color : '#8c897f' }}>${c ? c.name : ''}</span>
            <span class="tc dim">${globalIdx + 1}/${p.lines.length}</span>
            <span class="grow"></span>
            <span class="tc-lcd" title=${t('Satırın süresi')}>${t('{n} sn', { n: (line.end - line.start).toFixed(1) })}</span>
          </div>
          <div class="cue-text" key=${line.id}><${CueText} line=${line} /></div>
          <div class="cue-orig dim small">${line.orig}</div>
        </div>`}
        ${line && lane && html`<${RhythmLane} line=${line} buffer=${bufs && bufs.voices} t0=${lane.t0} t1=${lane.t1} color=${c ? c.color : null} />`}
        <div class="booth-controls">
          <div class="bc-side">
            <${Btn} kind="ghost" icon="prev" onClick=${prev} disabled=${idx <= 0 || recording} title=${t('Önceki satır (↑)')} />
            <${PlayButton} playing=${phase === 'scene'} onClick=${() => playScene(fromLine())} disabled=${!bufs || recording || busy}
              title=${phase === 'scene' ? t('Durdur (K)') : t('Sahneyi bu satırdan dublajla oynat (K)')} />
            <${Btn} icon=${phase === 'orig' ? 'stop' : 'headphones'} active=${phase === 'orig'} onClick=${listen} disabled=${!bufs || recording}
              title=${phase === 'orig' ? t('Durdur (P)') : t('Orijinali dinle (P)')}>${phase === 'orig' ? t('Durdur') : t('Orijinal')}</${Btn}>
          </div>
          <div class="recwrap">
            <button class=${cls('recbtn', recording && 'on', busy && 'busy')} onClick=${record} disabled=${!bufs || busy || testing}
              title=${t('Kaydet / durdur (Boşluk)')} aria-label=${recording ? t('Kaydı durdur') : t('rec|Kaydet')}><span class="recbtn-core"></span></button>
            <span class="reclabel">${recording ? t('Durdur') : phase === 'upload' ? t('Gönderiliyor') : phase === 'process' ? t('İşleniyor') : take ? t('Tekrar kaydet') : t('rec|Kaydet')}</span>
          </div>
          <div class="bc-side right">
            <${Btn} icon=${phase === 'review' ? 'stop' : 'play'} active=${phase === 'review'} onClick=${toggleReview}
              disabled=${!take || take.status !== 'ready' || recording} title=${phase === 'review' ? t('Durdur (L)') : t('Kaydımı dinle (L)')}>${phase === 'review' ? t('Durdur') : t('Kaydım')}</${Btn}>
            <${Btn} kind="ghost" icon="next" onClick=${next} disabled=${idx >= lines.length - 1 || recording} title=${t('Sonraki satır (Enter)')} />
          </div>
        </div>
        <${Listening} settings=${settings} setLevel=${setLevel} micOpen=${side === 'booth'} onMicSettings=${() => showSide(side === 'booth' ? 'lines' : 'booth')} />
      </section>
      ${line && html`<section class="pane takes-pane">
        <div class="pane-head"><h3>${t('Kayıtlar')}</h3><span class="count">${(line.takes || []).length}</span><span class="grow"></span>
          <input type="file" hidden ref=${fileIn} accept="audio/*,video/*,.m4a,.opus,.ogg,.mp3,.wav,.aac,.amr,.webm,.flac"
            onChange=${(e) => { uploadFile(e.target.files[0]); e.target.value = ''; }} />
          <${Btn} small kind="ghost" icon="upload" onClick=${() => fileIn.current.click()} title=${t('WhatsApp sesli mesajı ya da ses dosyası')}>${t('Dosyadan')}</${Btn}>
        </div>
        <div class="pane-scroll"><${TakeList} p=${p} line=${line} me=${name} guest=${guest} onPlay=${(t) => (phase === 'review' ? stopAll() : review(line, t))} /></div>
      </section>`}
    </div>
    <aside class="booth-side pane">
      <div class="pane-head"><h3>${t('Roller')}</h3><span class="grow"></span>${roomOpen && html`<${Lamp} tone="ok">${t('oda açık')}</${Lamp}>`}</div>
      <${Roles} p=${p} filter=${filter} setFilter=${pickRoles} room=${s.room} guest=${guest} />
      <div class="side-tabs"><${Segmented} value=${side} onChange=${showSide}
        options=${[['lines', t('Satırlar {a}/{b}', { a: doneCount, b: lines.length })], ['booth', t('Mikrofon ayarları')]]} /></div>
      ${side === 'lines'
        ? html`<div class="pane-scroll lineslist">${lines.map((l) => {
            const lc = chars[l.char];
            // the line number carries its speaker's colour (a separate dot beside it read as clutter)
            return html`<button key=${l.id} id=${'bl-' + l.id} class=${cls('lineitem', l.id === (line && line.id) && 'sel', l.take && 'done')} onClick=${() => goTo(l)}
              style=${{ '--c': lc ? lc.color : '#8c897f' }} title=${lc ? lc.name : null}>
              <span class="lineitem-n tc">${p.lines.indexOf(l) + 1}</span>
              <span class="lineitem-t">${l.text || l.orig}</span>
              ${l.take ? html`<${Icon} name="check" size=${14} />` : ''}
            </button>`;
          })}</div>`
        : html`<div class="pane-scroll"><${BoothSettings} settings=${settings} set=${set} guest=${guest} name=${name} setName=${setName} onTestRec=${testRec} testing=${testing} /></div>`}
      <div class="side-foot">
        <${Btn} small icon=${phase === 'scene' ? 'stop' : 'play'} active=${phase === 'scene'} onClick=${() => playScene(0)}>${phase === 'scene' ? t('Durdur') : t('Sahneyi baştan dinle')}</${Btn}>
        ${!guest && html`<input type="file" hidden multiple ref=${bulkIn} accept="audio/*,video/*,.m4a,.opus,.ogg,.mp3,.wav,.aac,.amr,.webm,.flac"
            onChange=${(e) => { setBulkFiles([...e.target.files]); e.target.value = ''; }} />
          <${Btn} small icon="upload" onClick=${() => bulkIn.current.click()} title=${t('Arkadaşlarının gönderdiği ses dosyalarını satırlara dağıt')}>${t('Toplu yükle')}</${Btn}>`}
      </div>
    </aside>
    ${bulkFiles && html`<${BulkDialog} p=${p} files=${bulkFiles} name=${name} onClose=${() => setBulkFiles(null)} />`}
  </div>`;
}
