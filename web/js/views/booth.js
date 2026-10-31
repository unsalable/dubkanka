// Recording booth (ADR): pre-roll + 3 beeps, karaoke text, sample-accurate takes, instant review.
import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P, upload } from '../api.js';
import { Btn, Field, Icon, Kbd, LevelMeter, Range, Select, Swatch, Toggle, VideoPane } from '../components.js';
import { buildMix, engine, loadMixBuffers, player, stemUrls, takeUrl } from '../engine.js';
import { listMics, recorder } from '../recorder.js';
import { toast, toastError, useStore } from '../state.js';
import { clamp, cls, db2gain, encodeWav, LS, selectedTake, timeAgo } from '../util.js';

const DEFAULTS = { preroll: 2, beeps: true, bg: true, guide: 0, autoStop: true, tail: 1.0, autoReview: true, align: 'auto' };
const STATUS_TEXT = { processing: 'işleniyor…', error: 'hata' };
const RING = 2 * Math.PI * 60;

function Words({ line }) {
  const words = line.words && line.words.length ? line.words : null;
  if (!words) return html`<span>${line.orig}</span>`;
  return words.map((w, i) => html`<span key=${i} class="w" data-s=${w[0]} data-e=${w[1]}>${w[2]}</span>`);
}

function TakeList({ p, line, me, guest, onPlay }) {
  if (!line.takes || !line.takes.length) return html`<div class="muted small">Bu satır için henüz kayıt yok. Boşluk tuşuna basıp ilkini al.</div>`;
  const sel = (tid) => api.post(P(p.id, `/lines/${line.id}/select`), { take: tid }).catch(toastError);
  const del = (t) => confirm('Bu kayıt silinsin mi?') && api.del(P(p.id, `/lines/${line.id}/takes/${t.id}`)).catch(toastError);
  return html`<div class="takes">${[...line.takes].reverse().map((t, i) => {
    const n = line.takes.length - i;
    const mine = !guest || t.by === me;
    return html`<div key=${t.id} class=${cls('take', line.take === t.id && 'sel', t.status)}>
      <button class="iconbtn" disabled=${t.status !== 'ready'} title="Dinle" onClick=${() => onPlay(t)}><${Icon} name="play" size=${14} /></button>
      <div class="take-info"><strong>Kayıt ${n}</strong> <span class="muted small">${t.by} · ${timeAgo(t.created)}${t.source === 'tts' ? ' · yapay zeka' : ''}${t.silent ? ' · ses yok!' : ''}</span>
        ${STATUS_TEXT[t.status] && html`<span class=${'badge ' + (t.status === 'error' ? 'bad' : '')}>${STATUS_TEXT[t.status]}</span>`}</div>
      ${line.take === t.id ? html`<span class="badge good"><${Icon} name="check" size=${12} />seçili</span>` : html`<${Btn} small onClick=${() => sel(t.id)} disabled=${t.status !== 'ready'}>Bunu kullan</${Btn}>`}
      ${mine && html`<button class="iconbtn" title="Sil" onClick=${() => del(t)}><${Icon} name="trash" size=${15} /></button>`}
    </div>`;
  })}</div>`;
}

function BoothSettings({ settings, set, guest, name, setName }) {
  const [mics, setMics] = useState([]);
  const [mic, setMic] = useState(LS.get('mic.device', ''));
  const [echo, setEcho] = useState(LS.get('mic.echo', true));
  const [noise, setNoise] = useState(LS.get('mic.noise', true));
  const [lat, setLat] = useState(LS.get('mic.latency', 0));
  useEffect(() => {
    listMics().then(setMics);
  }, [recorder.ready]);
  const reopen = async (k, v, setter) => {
    LS.set(k, v);
    setter(v);
    if (recorder.ready) await recorder.open(true).catch(toastError);
  };
  return html`<div class="boothsettings">
    ${!guest && html`<${Field} label="Kaydı yapan"><input class="input" value=${name} onInput=${(e) => setName(e.target.value)} /></${Field}>`}
    <${Field} label="Mikrofon">
      <${Select} value=${mic} onChange=${(v) => reopen('mic.device', v, setMic)} options=${[['', 'Varsayılan mikrofon'], ...mics.map((m) => [m.id, m.label])]} />
    </${Field}>
    <div class="row" style=${{ marginBottom: '14px' }}><${Btn} small icon="mic" onClick=${() => recorder.open().then(() => listMics().then(setMics)).catch(toastError)}>Mikrofonu dene</${Btn}><${LevelMeter} /></div>
    <${Field} label="Geri sayım (konuşmadan önce)">
      <${Select} value=${String(settings.preroll)} onChange=${(v) => set('preroll', Number(v))} options=${[['1', '1 saniye'], ['2', '2 saniye'], ['3', '3 saniye'], ['4', '4 saniye']]} />
    </${Field}>
    <${Field} label="Kayıt sırasında orijinal ses (rehber)">
      <${Select} value=${String(settings.guide)} onChange=${(v) => set('guide', Number(v))} options=${[['0', 'Kapalı (önerilen)'], ['0.25', 'Kısık'], ['0.7', 'Normal']]} />
    </${Field}>
    <${Toggle} checked=${settings.beeps} onChange=${(v) => set('beeps', v)} label="3 bip sesiyle geri say" />
    <${Toggle} checked=${settings.bg} onChange=${(v) => set('bg', v)} label="Kayıtta fon ve ortam sesleri çalsın" />
    <${Toggle} checked=${settings.autoStop} onChange=${(v) => set('autoStop', v)} label="Satır bitince kaydı otomatik durdur" />
    <${Toggle} checked=${settings.autoReview} onChange=${(v) => set('autoReview', v)} label="Kayıttan sonra hemen dinlet" />
    <${Toggle} checked=${settings.align === 'auto'} onChange=${(v) => set('align', v ? 'auto' : 'recorded')} label="Konuşma başlangıcını orijinale otomatik hizala" />
    <details><summary class="muted small">Gelişmiş mikrofon ayarları</summary>
      <${Toggle} checked=${echo} onChange=${(v) => reopen('mic.echo', v, setEcho)} label="Yankı engelleme (kulaklık yoksa açık kalsın)" />
      <${Toggle} checked=${noise} onChange=${(v) => reopen('mic.noise', v, setNoise)} label="Gürültü bastırma" />
      <${Field} label=${`Gecikme düzeltme: ${lat} ms`} hint="Bluetooth kulaklıkta kayıtlar geç oturuyorsa artır (ör. 150-250).">
        <${Range} min=${-200} max=${400} step=${10} value=${lat} onInput=${(v) => { setLat(v); LS.set('mic.latency', v); }} />
      </${Field}>
    </details>
  </div>`;
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
  const [filter, setFilter] = useState(() => LS.get((guest ? 'guest' : 'booth') + '.chars.' + p.id, []) || []);
  const setFilterSaved = (f) => {
    setFilter(f);
    LS.set((guest ? 'guest' : 'booth') + '.chars.' + p.id, f);
  };
  const lines = p.lines.filter((l) => !filter.length || filter.includes(l.char));
  const [lineId, setLineId] = useState(() => s.route[3] || (lines[0] && lines[0].id));
  const line = lines.find((l) => l.id === lineId) || lines[0];
  const idx = line ? lines.indexOf(line) : -1;
  const globalIdx = line ? p.lines.indexOf(line) : -1;
  const [phase, setPhase] = useState('idle');
  const [bufs, setBufs] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const recInfo = useRef(null);
  const pending = useRef(null);
  const overlay = useRef(null);
  const fileIn = useRef(null);
  const bulkIn = useRef(null);
  const dur = p.clip.duration;
  const chars = Object.fromEntries(p.characters.map((c) => [c.id, c]));
  const c = line ? chars[line.char] : null;

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

  useEffect(() => {
    if (guest && line) api.post('/api/guest/heartbeat', { view: 'record', line: globalIdx + 1 }).catch(() => {});
  }, [line && line.id]);

  // what plays under a line: background + ambience (birds, wind...); guests' lite background already holds both
  const bed = (bus) => [{ buffer: bufs.bg, at: 0, bus }, { buffer: bufs.amb, at: 0, bus }];

  const stopAll = () => {
    if (recInfo.current) return finish(true);
    player.stop();
    if (phase !== 'upload' && phase !== 'process') setPhase('idle');
  };

  const listen = () => {
    if (!bufs || !line) return;
    if (recInfo.current) return;
    const items = bufs.original ? [{ buffer: bufs.original, at: 0 }] : [...bed(), { buffer: bufs.voices, at: 0 }];
    setPhase('listen');
    player.play({ from: Math.max(0, line.start - 0.8), to: Math.min(dur, line.end + 0.5), items, onEnd: () => setPhase('idle') });
  };

  const review = async (l = line, t = selectedTake(l)) => {
    if (!bufs || !l || !t || t.status !== 'ready' || recInfo.current) return;
    const buf = await engine.load(takeUrl(p, t)).catch(toastError);
    if (!buf) return;
    const at = t.start + (t.nudge || 0);
    setPhase('review');
    player.play({
      from: Math.max(0, Math.min(l.start, at) - 0.6), to: Math.min(dur, Math.max(l.end, at + t.duration) + 0.5),
      items: [...bed(), { buffer: buf, at, gain: db2gain(t.gain || 0) }], onEnd: () => setPhase('idle'),
    });
  };

  const playScene = async () => {
    stopAll();
    const b = await loadMixBuffers(p, { lite: guest }).catch(toastError);
    if (!b) return;
    const mix = buildMix(p, b, 'dub');
    setPhase('listen');
    player.play({ from: 0, to: dur, ...mix, onEnd: () => setPhase('idle') });
  };

  const record = async () => {
    if (!line || !bufs) return;
    if (phase === 'rec') return finish(false);
    if (phase === 'upload') return;
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
    setPhase('upload');
    try {
      const q = `?recStart=${recStart.toFixed(4)}&source=booth&align=${settings.align}&by=${encodeURIComponent(name || 'Ben')}`;
      const r = await upload(P(p.id, `/lines/${info.lineId}/takes${q}`), encodeWav(rec.samples, rec.sampleRate));
      pending.current = { takeId: r.takeId, lineId: info.lineId };
      setPhase('process');
    } catch (e) {
      toastError(e);
      setPhase('idle');
    }
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
  };
  const next = () => idx + 1 < lines.length && goTo(lines[idx + 1]);
  const prev = () => idx > 0 && goTo(lines[idx - 1]);

  useEffect(() => {
    if (line) player.seek(Math.max(0, line.start - 0.2));
  }, [bufs]);

  useEffect(() => {
    const key = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) || e.repeat) return;
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

  // countdown ring, karaoke bar and word highlights follow the player clock without re-rendering
  useEffect(() => {
    if (!line) return;
    let shown = '';
    const upd = () => {
      const el = overlay.current;
      if (!el) return;
      const t = player.time;
      const fill = el.querySelector('.kara-fill');
      if (fill) fill.style.transform = `scaleX(${clamp((t - line.start) / (line.end - line.start), 0, 1)})`;
      const cd = el.querySelector('.countdown');
      const go = el.querySelector('.cue-go');
      const rec = phase === 'rec' && player.playing;
      if (cd) {
        const left = line.start - t;
        let txt = '';
        if (rec && left > 0) {
          const n = Math.ceil(left / 0.5 - 1e-6);
          txt = n <= 3 ? String(n) : 'Hazırlan';
          el.querySelector('.cd-ring circle').style.strokeDashoffset = RING * (1 - clamp(left / Math.max(0.5, settings.preroll), 0, 1));
        }
        cd.classList.toggle('show', !!txt);
        if (txt !== shown) {
          shown = txt;
          const num = cd.querySelector('.cd-num');
          num.classList.toggle('word', txt === 'Hazırlan');
          num.querySelector('.cd-txt').textContent = txt;
          if (txt) num.animate([{ transform: 'scale(1.35)', opacity: 0.2 }, { transform: 'scale(1)', opacity: 1 }], { duration: 260, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' });
        }
      }
      if (go) go.hidden = !(rec && t >= line.start && t <= line.end);
      el.querySelectorAll('.w').forEach((w) => w.classList.toggle('on', player.playing && t >= +w.dataset.s && t <= +w.dataset.e + 0.05));
    };
    upd();
    return player.on(upd);
  }, [line && line.id, line && line.start, line && line.end, phase, settings.preroll]);

  const uploadFile = async (file, l = line) => {
    if (!file || !l) return;
    try {
      await upload(P(p.id, `/lines/${l.id}/takes?source=upload&by=${encodeURIComponent(name || 'Ben')}&filename=${encodeURIComponent(file.name)}`), file);
      toast(`${file.name}, ${p.lines.indexOf(l) + 1}. satıra eklendi`, 'ok');
    } catch (e) {
      toastError(e);
    }
  };
  const bulk = async (files) => {
    let ok = 0;
    const miss = [];
    for (const f of files) {
      const m = f.name.match(/\d+/);
      const l = m ? p.lines[Number(m[0]) - 1] : null;
      if (!l) {
        miss.push(f.name);
        continue;
      }
      await uploadFile(f, l);
      ok++;
    }
    if (miss.length) toast(`Satır numarası bulunamadı: ${miss.join(', ')}`, 'error', 8000);
    else if (ok) toast(`${ok} kayıt eklendi, zamanlamaları otomatik ayarlanıyor`, 'ok');
  };

  if (!p.lines.length) return html`<div class="page narrow"><div class="empty"><${Icon} name="text" size=${32} /><h3>Kaydedilecek satır yok</h3><p class="muted">Önce Senaryo ekranında satır ekle.</p></div></div>`;

  const take = line ? selectedTake(line) : null;
  const recording = phase === 'rec';
  const busy = phase === 'upload' || phase === 'process';
  const doneCount = lines.filter((l) => l.take).length;

  return html`<div class=${cls('page booth', guest && 'guest', recording && 'is-rec')}>
    <div class="booth-main" ref=${overlay}>
      <section class="pane booth-stage">
        <${VideoPane} src=${fileUrl(p.id, p.clip.preview, p.clip.ver)} poster=${fileUrl(p.id, p.clip.thumb, p.clip.ver)} class="booth-video">
          <div class="countdown"><div class="cd-num"><svg class="cd-ring" viewBox="0 0 132 132"><circle cx="66" cy="66" r="60"
            style=${{ strokeDasharray: RING, strokeDashoffset: 0 }} /></svg><span class="cd-txt"></span></div></div>
          <div class="cue-go" hidden>Konuş</div>
          ${recording && html`<div class="recdot"><span></span>KAYIT</div>`}
        </${VideoPane}>
        ${line && html`<div class="prompter" style=${{ '--c': c ? c.color : '#8b8b93' }}>
          <div class="prompter-head"><${Swatch} color=${c ? c.color : '#8b8b93'} /> <strong>${c ? c.name : ''}</strong>
            <span class="tc">${globalIdx + 1}. satır · ${(line.end - line.start).toFixed(1)} sn</span></div>
          <div class="prompter-text" key=${line.id}>${line.text || html`<em class="muted">Dublaj metni boş. Orijinali okuyabilir ya da doğaçlama yapabilirsin.</em>`}</div>
          <div class="kara"><div class="kara-fill"></div></div>
          <div class="prompter-orig"><span class="muted small">Orijinal ritim: </span><${Words} line=${line} /></div>
        </div>`}
        <div class="booth-controls">
          <${Btn} kind="ghost" icon="prev" onClick=${prev} disabled=${idx <= 0 || recording} title="Önceki satır (↑)" />
          <${Btn} icon="headphones" onClick=${listen} disabled=${!bufs || recording} title="Orijinali dinle (P)">Orijinal</${Btn}>
          <div class="recwrap">
            <button class=${cls('recbtn', recording && 'on', busy && 'busy')} onClick=${record} disabled=${!bufs || busy}
              title="Kaydet / durdur (Boşluk)" aria-label=${recording ? 'Kaydı durdur' : 'Kaydet'}><span class="recbtn-core"></span></button>
            <span class="reclabel">${recording ? 'Durdur' : phase === 'upload' ? 'Gönderiliyor' : phase === 'process' ? 'İşleniyor' : take ? 'Tekrar kaydet' : 'Kaydet'}</span>
          </div>
          <${Btn} icon="play" onClick=${() => review()} disabled=${!take || take.status !== 'ready' || recording} title="Kaydımı dinle (L)">Kaydım</${Btn}>
          <${Btn} kind="ghost" icon="next" onClick=${next} disabled=${idx >= lines.length - 1 || recording} title="Sonraki satır (Enter)" />
        </div>
        ${recording && html`<div class="booth-meter"><${Icon} name="mic" size=${14} /><${LevelMeter} /></div>`}
        <div class="booth-hint">
          <span><${Kbd}>Boşluk</${Kbd}> kaydet / durdur</span><span><${Kbd}>P</${Kbd}> orijinal</span><span><${Kbd}>L</${Kbd}> kaydım</span>
          <span><${Kbd}>Enter</${Kbd}> sonraki</span><span><${Icon} name="headphones" size=${14} /> Kulaklıkla kayıt çok daha temiz olur</span>
        </div>
      </section>
      ${line && html`<section class="pane">
        <div class="pane-head"><h3>Bu satırın kayıtları</h3><span class="count">${(line.takes || []).length}</span><span class="grow"></span>
          <input type="file" hidden ref=${fileIn} accept="audio/*,video/*,.m4a,.opus,.ogg,.mp3,.wav,.aac,.amr" onChange=${(e) => { uploadFile(e.target.files[0]); e.target.value = ''; }} />
          <${Btn} small kind="ghost" icon="upload" onClick=${() => fileIn.current.click()} title="WhatsApp sesli mesajı ya da ses dosyası">Dosyadan yükle</${Btn}>
        </div>
        <div class="pane-body"><${TakeList} p=${p} line=${line} me=${name} guest=${guest} onPlay=${(t) => review(line, t)} /></div>
      </section>`}
    </div>
    <aside class="booth-side">
      <div class="panel">
        <div class="panel-head"><h3>Kimi seslendiriyorsun?</h3></div>
        <div class="chips">
          <button class=${cls('chip', !filter.length && 'on')} onClick=${() => setFilterSaved([])}>Hepsi</button>
          ${p.characters.map((ch) => html`<button key=${ch.id} class=${cls('chip', filter.includes(ch.id) && 'on')} style=${{ '--c': ch.color }}
            onClick=${() => setFilterSaved(filter.includes(ch.id) ? filter.filter((x) => x !== ch.id) : [...filter, ch.id])}>
            <${Swatch} color=${ch.color} /> ${ch.name}${ch.actor ? html` <span class="muted small">(${ch.actor})</span>` : ''}</button>`)}
        </div>
        ${guest && filter.length === 1 && html`<div style=${{ marginTop: '10px' }}><${Btn} small kind="ghost" onClick=${() => api.post(P(p.id, `/characters/${filter[0]}/claim`)).then(() => toast('Rol sende!', 'ok')).catch(toastError)}>Bu rolü ben alıyorum</${Btn}></div>`}
      </div>
      <div class="panel">
        <div class="panel-head"><h3>Satırlar</h3><span class="muted small">${doneCount}/${lines.length} kayıtlı</span></div>
        <div class="lineslist">${lines.map((l) => {
          const lc = chars[l.char];
          return html`<button key=${l.id} class=${cls('lineitem', l.id === (line && line.id) && 'sel', l.take && 'done')} onClick=${() => goTo(l)}>
            <span class="lineitem-n">${p.lines.indexOf(l) + 1}</span><${Swatch} color=${lc ? lc.color : '#8b8b93'} />
            <span class="lineitem-t">${l.text || l.orig}</span>
            ${l.take ? html`<${Icon} name="check" size=${14} />` : ''}
          </button>`;
        })}</div>
      </div>
      <div class="panel">
        <div class="toolbar">
          <${Btn} small icon="play" onClick=${playScene}>Tüm sahneyi dublajla dinle</${Btn}>
          ${!guest && html`<input type="file" hidden multiple ref=${bulkIn} accept="audio/*,video/*,.m4a,.opus,.ogg,.mp3,.wav" onChange=${(e) => { bulk([...e.target.files]); e.target.value = ''; }} />
            <${Btn} small icon="upload" onClick=${() => bulkIn.current.click()} title="Dosya adındaki sayı satır numarası olarak kullanılır (ör. 3.m4a → 3. satır)">Toplu ses yükle</${Btn}>`}
        </div>
        <button class="linkbtn" onClick=${() => setShowSettings(!showSettings)} aria-expanded=${showSettings}><${Icon} name="gear" size=${15} /> Kabin ayarları</button>
        ${showSettings && html`<${BoothSettings} settings=${settings} set=${set} guest=${guest} name=${name} setName=${setName} />`}
      </div>
    </aside>
  </div>`;
}
