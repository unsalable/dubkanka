import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P } from '../api.js';
import { Btn, Field, Icon, JobPanel, Modal, PlayButton, Popover, Select, TimeReadout, Toggle, usePlaying, VideoPane, VolumeControl } from '../components.js';
import { engine, player, stemUrls } from '../engine.js';
import { FeatureOffer } from '../feature-ui.js';
import { t } from '../i18n.js';
import { ask, featureReady, go, jobOf, patchLocal, toast, toastError, useStore } from '../state.js';
import { fitZoom, Timeline } from '../timeline.js';
import { cls, copyText, debounce, fmtTime, revealInList, syllables } from '../util.js';

function useStem(p, key) {
  const [buf, setBuf] = useState(null);
  const url = stemUrls(p, false)[key];
  useEffect(() => {
    let alive = true;
    engine.load(url).then((b) => alive && setBuf(b)).catch(() => {});
    return () => (alive = false);
  }, [url]);
  return buf;
}

export function playOriginal(p, original, from, to) {
  if (!original) return;
  player.play({ from, to, items: [{ buffer: original, at: 0 }] });
}

/** Only says something when the dub is clearly longer than the original: then it will not fit the mouth. */
function TooLong({ orig, text }) {
  if (!text || !text.trim()) return null;
  const so = syllables(orig);
  const sd = syllables(text);
  if (sd / Math.max(1, so) <= 1.35) return null;
  return html`<span class="toolong" title=${t('Orijinal {a} hece, dublaj {b} hece. Kısaltırsan ağza daha iyi oturur.', { a: so, b: sd })}>${t('uzun')}</span>`;
}

/** Who says the line: the character's name tag itself is the button that gives the line to someone else. */
function CharTag({ p, line, c, onPick }) {
  const btn = useRef(null);
  const [open, setOpen] = useState(false);
  return html`<button ref=${btn} class="hl chartag" style=${{ '--c': c ? c.color : '#8c897f' }} title=${t('Bu satırı kim söylüyor?')} aria-expanded=${open}
      onClick=${(e) => { e.stopPropagation(); setOpen(!open); }}>${c ? c.name : t('Kim?')}<${Icon} name="chevdown" size=${12} class="chev" /></button>
    ${open && html`<${Popover} anchor=${btn.current} align="start" title=${t('Söyleyen')} onClose=${() => setOpen(false)}>
      ${p.characters.map((ch) => html`<button key=${ch.id} class="popitem" onClick=${() => { setOpen(false); onPick(ch.id); }}>
        <span class="hl" style=${{ '--c': ch.color }}>${ch.name}</span><span class="grow"></span>${ch.id === line.char && html`<${Icon} name="check" size=${14} />`}</button>`)}
    </${Popover}>`}`;
}

function LineRow({ p, line, idx, selected, onSelect, onPlay, chars }) {
  const [text, setText] = useState(line.text || '');
  const [flash, setFlash] = useState(false);
  const focused = useRef(false);
  const first = useRef(true);
  const area = useRef(null);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (focused.current) return;
    setText(line.text || '');
    // a new translation landed: let the row light up once
    setFlash(true);
    const timer = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(timer);
  }, [line.text]);
  useEffect(() => {
    const a = area.current;
    if (a) {
      a.style.height = 'auto';
      a.style.height = a.scrollHeight + 'px';
    }
  }, [text]);
  const save = useMemo(() => debounce((v) => api.patch(P(p.id, `/lines/${line.id}`), { text: v }).catch(toastError), 600), [line.id]);
  const c = chars[line.char];
  const recorded = line.take && (line.takes || []).some((x) => x.id === line.take);
  const setChar = (cid) => {
    patchLocal((pp) => (pp.lines.find((l) => l.id === line.id).char = cid));
    api.patch(P(p.id, `/lines/${line.id}`), { char: cid }).catch(toastError);
  };
  // the cue sheet shows only what the line needs: who says it, the original, the dub; timing lives in the timeline
  return html`<div class=${cls('linerow', selected && 'sel', flash && 'flash')} style=${{ '--c': c ? c.color : '#8c897f' }}
    onClick=${() => onSelect(line)} id=${'line-' + line.id}>
    <div class="linerow-num" title=${`${fmtTime(line.start)} · ${t('{n} sn', { n: (line.end - line.start).toFixed(1) })}`}>${idx + 1}</div>
    <div class="linerow-main">
      <div class="linerow-meta">
        <${CharTag} p=${p} line=${line} c=${c} onPick=${setChar} />
        <${TooLong} orig=${line.orig} text=${text} />
        <span class="grow"></span>
        <span class="linerow-acts">
          <button class="iconbtn sm" title=${t('Orijinali dinle')} onClick=${(e) => { e.stopPropagation(); onPlay(line); }}><${Icon} name="headphones" size=${15} /></button>
          <button class="iconbtn sm" title=${t('Bu satırı kaydet')} onClick=${(e) => { e.stopPropagation(); go(`p/${p.id}/record/${line.id}`); }}><${Icon} name="mic" size=${15} /></button>
        </span>
        ${recorded && html`<span class="linerow-done" title=${t('Kaydı var')}><${Icon} name="check" size=${14} /></span>`}
      </div>
      ${line.orig && html`<div class="orig">${line.orig}</div>`}
      <textarea ref=${area} class="input dubtext" rows="1" placeholder=${t('Dublaj repliğini yaz…')} value=${text}
        onFocus=${() => { focused.current = true; onSelect(line); }}
        onBlur=${(e) => { focused.current = false; save.flush(e.target.value); }}
        onInput=${(e) => { setText(e.target.value); save(e.target.value); }}
        onKeyDown=${(e) => {
          if (e.key !== 'Enter' || e.shiftKey) return;
          e.preventDefault();
          const next = document.querySelector(`#line-${p.lines[idx + 1]?.id} textarea`);
          if (!next) return e.target.blur();
          next.focus({ preventScroll: true });
          revealInList(next.closest('.linerow'));
        }}></textarea>
    </div>
  </div>`;
}

function CastRow({ p, c, count, i }) {
  const [name, setName] = useState(c.name);
  const [actor, setActor] = useState(c.actor || '');
  const [menu, setMenu] = useState(false);
  const dots = useRef(null);
  useEffect(() => setName(c.name), [c.name]);
  useEffect(() => setActor(c.actor || ''), [c.actor]);
  const patch = (body) => api.patch(P(p.id, `/characters/${c.id}`), body).catch(toastError);
  const merge = async (into) => {
    setMenu(false);
    await api.post(P(p.id, `/characters/${c.id}/merge`), { into }).catch(toastError);
  };
  const others = p.characters.filter((x) => x.id !== c.id);
  return html`<div class="castrow" style=${{ '--c': c.color, '--i': i }}>
    <label class="colorpick" title=${t('Rengi değiştir')}><input type="color" value=${c.color} onChange=${(e) => patch({ color: e.target.value })} /></label>
    <input class="bare strong castname" value=${name} title=${t('Karakter adı')} aria-label=${t('Karakter adı')} onInput=${(e) => setName(e.target.value)}
      onBlur=${() => name.trim() && name !== c.name && patch({ name: name.trim() })} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />
    <input class="bare castactor" value=${actor} placeholder=${t('seslendiren')} title=${t('Bu rolü kim seslendirecek?')} aria-label=${t('Seslendiren')}
      onInput=${(e) => setActor(e.target.value)} onBlur=${() => actor !== (c.actor || '') && patch({ actor: actor.trim() })} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />
    <span class="tc dim" title=${t('Satır sayısı')}>${count}</span>
    <button class="iconbtn sm" ref=${dots} title=${t('Diğer işlemler')} aria-haspopup="menu" aria-expanded=${menu} onClick=${() => setMenu(!menu)}><${Icon} name="dots" size=${16} /></button>
    ${menu && html`<${Popover} anchor=${dots.current} title=${others.length ? t('Aynı kişi mi? Şununla birleştir') : null} onClose=${() => setMenu(false)}>
      ${others.map((x) => html`<button key=${x.id} class="popitem" onClick=${() => merge(x.id)}>
        <span class="hl" style=${{ '--c': x.color }}>${x.name}</span><span class="grow"></span><span class="dim tc">${p.lines.filter((l) => l.char === x.id).length}</span></button>`)}
      ${others.length > 0 && html`<div class="popover-sep"></div>`}
      ${count === 0
        ? html`<button class="popitem danger" onClick=${() => { setMenu(false); api.del(P(p.id, `/characters/${c.id}`)).catch(toastError); }}><${Icon} name="trash" size=${14} />${t('Karakteri sil')}</button>`
        : html`<div class="popitem dim" aria-disabled="true"><${Icon} name="info" size=${14} />${t('Satırı olan karakter silinemez, önce birleştir.')}</div>`}
    </${Popover}>`}
  </div>`;
}

const ENGINE_KIND = (sys, id) => ((sys.translators || []).find((x) => x.id === id) || {}).kind;

function TranslatePanel({ p, onClose }) {
  const s = useStore();
  const sys = s.system || {};
  const translators = sys.translators || [];
  const [engineName, setEngine] = useState(() => (p.settings.translator === 'claude' ? 'anthropic' : p.settings.translator) || 'google');
  const [style, setStyle] = useState(p.settings.style || 'natural');
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const job = jobOf('translate');
  const tr = translators.find((x) => x.id === engineName) || {};
  const go_ = () => api.post(P(p.id, '/translate'), { engine: engineName, style, onlyEmpty }).catch(toastError);
  const runningJob = job && (job.status === 'running' || job.status === 'queued');
  const options = translators.map((x) => [x.id, x.name + (x.configured ? '' : ' ' + t('(ayarlanmadı)'))]);
  return html`<${Modal} title=${t('Satırları çevir')} onClose=${onClose}>
    <${Field} label=${t('Çeviri servisi')}><${Select} value=${engineName} onChange=${setEngine} options=${options.length ? options : [['google', t('Google Çeviri')]]} /></${Field}>
    ${ENGINE_KIND(sys, engineName) === 'llm' && html`<${Field} label=${t('Tarz')}>
      <${Select} value=${style} onChange=${setStyle} options=${Object.entries(sys.styles || {})} /></${Field}>`}
    ${!tr.configured && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />${t('{name} henüz ayarlanmadı.', { name: tr.name })} <a href="#/settings/translate">${t('Ayarlar → Çeviri')}</a></div>`}
    <${Toggle} checked=${onlyEmpty} onChange=${setOnlyEmpty} label=${t('Sadece boş satırları çevir (yazdıklarım kalsın)')} />
    ${job && html`<${JobPanel} job=${job} />`}
    <div class="modal-actions"><${Btn} onClick=${onClose}>${t('Kapat')}</${Btn}><${Btn} kind="primary" icon="translate" disabled=${runningJob || !tr.configured} onClick=${go_}>${t('Çevir')}</${Btn}></div>
  </${Modal}>`;
}

export function scriptText(p, cid) {
  const c = p.characters.find((x) => x.id === cid);
  const rows = [];
  p.lines.forEach((l, i) => {
    if (cid && l.char !== cid) return;
    rows.push(`#${i + 1}  [${fmtTime(l.start)} · ${t('{n} sn', { n: (l.end - l.start).toFixed(1) })}]${cid ? '' : '  ' + (p.characters.find((x) => x.id === l.char) || {}).name}\n${l.text || t('(boş)')}\n   ${t('orijinal:')} ${l.orig}`);
  });
  return `🎬 ${t('{name} — dublaj senaryosu', { name: p.name })}${c ? `\n${t('Rolün: {name}', { name: c.name })}` : ''}\n` +
    `${t('Her repliği ayrı kaydet, dosyanın adını satır numarası yap (ör. 3.m4a). WhatsApp sesli mesajı da olur.')}\n\n` + rows.join('\n\n');
}

function ShareScript({ p, onClose }) {
  const [cid, setCid] = useState(p.characters[0] ? p.characters[0].id : '');
  const txt = scriptText(p, cid);
  return html`<${Modal} title=${t('Senaryoyu gönder')} onClose=${onClose} wide>
    <p class="muted">${t('Arkadaşın kendi repliklerini kaydedip sana atar; dosyaları Kayıt ekranında Toplu yükle ile eklersin.')}</p>
    <${Field} label=${t('Kimin için?')}><${Select} value=${cid} onChange=${setCid} options=${[...p.characters.map((c) => [c.id, c.name]), ['', t('Tüm senaryo')]]} /></${Field}>
    <textarea class="input sharetext" readonly value=${txt}></textarea>
    <div class="modal-actions"><${Btn} icon="copy" kind="primary" onClick=${async () => { await copyText(txt); toast(t('Kopyalandı'), 'ok'); }}>${t('Kopyala')}</${Btn}></div>
  </${Modal}>`;
}

export function ScriptView({ p }) {
  const voices = useStem(p, 'voices');
  const original = useStem(p, 'original');
  const playing = usePlaying();
  const [sel, setSel] = useState(p.lines[0] ? p.lines[0].id : null);
  const [zoom, setZoom] = useState(null);
  const [modal, setModal] = useState(null);
  const wrap = useRef(null);
  const dur = p.clip.duration;
  const chars = Object.fromEntries(p.characters.map((c) => [c.id, c]));
  const counts = {};
  p.lines.forEach((l) => (counts[l.char] = (counts[l.char] || 0) + 1));
  const selLine = p.lines.find((l) => l.id === sel);

  useEffect(() => {
    if (zoom == null && wrap.current) setZoom(fitZoom(wrap.current.clientWidth, dur));
  }, [wrap.current]);

  const playLine = (l) => {
    setSel(l.id);
    playOriginal(p, original, Math.max(0, l.start - 0.3), Math.min(dur, l.end + 0.3));
  };
  const toggle = () => {
    if (player.playing) return player.stop();
    playOriginal(p, original, player.time >= dur - 0.1 ? 0 : Math.max(0, player.time), dur);
  };
  const select = (l) => {
    setSel(l.id);
    if (!player.playing) player.seek(l.start);
    revealInList(document.getElementById('line-' + l.id));
  };
  const patchLine = (lid, body) => {
    patchLocal((pp) => Object.assign(pp.lines.find((l) => l.id === lid), body));
    api.patch(P(p.id, `/lines/${lid}`), body).catch(toastError);
  };
  const addLine = async () => {
    const at = Math.max(0, player.time);
    const l = await api.post(P(p.id, '/lines'), { start: at, end: Math.min(dur, at + 2), char: selLine ? selLine.char : undefined }).catch(toastError);
    if (l) setSel(l.id);
  };
  const split = () => selLine && api.post(P(p.id, `/lines/${selLine.id}/split`), { at: player.time }).catch(toastError);
  const mergeNext = async () => {
    if (!selLine) return;
    const next = p.lines[p.lines.indexOf(selLine) + 1];
    if (next && (next.takes || []).length &&
      !(await ask({ title: t('Satırlar birleştirilsin mi?'), text: t('Sonraki satırın kayıtları silinir.'), ok: t('Birleştir'), danger: true }))) return;
    api.post(P(p.id, `/lines/${selLine.id}/merge-next`)).catch(toastError);
  };
  const delLine = async () => {
    if (!selLine) return;
    if ((selLine.takes || []).length &&
      !(await ask({ title: t('{n}. satır silinsin mi?', { n: p.lines.indexOf(selLine) + 1 }), text: t('Satırın kayıtları da silinir.'), ok: t('Sil'), danger: true }))) return;
    api.del(P(p.id, `/lines/${selLine.id}`)).catch(toastError);
  };

  useEffect(() => {
    const key = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const track = {
    id: 'voices', label: html`<${Icon} name="wave" size=${14} />${t('Orijinal konuşmalar')}`, height: 84, buffer: voices, waveColor: 'rgba(214,210,198,0.3)',
    clips: p.lines.map((l, i) => ({
      id: l.id, start: l.start, end: l.end, color: (chars[l.char] || {}).color, label: `${i + 1}`,
      title: `${(chars[l.char] || {}).name}: ${l.orig}`, resizable: true, draggable: true, className: 'lineclip',
    })),
  };
  const empty = p.lines.length === 0;
  const recorded = p.lines.filter((l) => l.take).length;

  return html`<div class="page script" ref=${wrap}>
    <div class="ws script-ws">
      <div class="viewer-col">
        <section class="pane viewer-pane">
          <${VideoPane} src=${fileUrl(p.id, p.clip.preview, p.clip.ver)} poster=${fileUrl(p.id, p.clip.thumb, p.clip.ver)} class="script-video"
            onClick=${() => original && toggle()} title=${playing ? t('Durdur') : t('Oynat')} />
          <div class="transport">
            <${PlayButton} playing=${playing} onClick=${toggle} disabled=${!original} />
            <${TimeReadout} duration=${dur} />
            <${VolumeControl} />
            <div class="toolbar line-tools">
              <${Btn} small kind="ghost" icon="plus" onClick=${addLine} title=${t('Oynatma çizgisinin olduğu yere yeni satır')}>${t('Satır ekle')}</${Btn}>
              <${Btn} small kind="ghost" icon="cut" onClick=${split} disabled=${!selLine} title=${t('Seçili satırı oynatma çizgisinden ikiye böl')}>${t('Böl')}</${Btn}>
              <${Btn} small kind="ghost" icon="merge" onClick=${mergeNext} disabled=${!selLine} title=${t('Seçili satırı sonrakiyle birleştir')}>${t('Birleştir')}</${Btn}>
              <${Btn} small kind="ghost" icon="trash" onClick=${delLine} disabled=${!selLine} title=${t('Seçili satırı sil')}>${t('Sil')}</${Btn}>
            </div>
          </div>
        </section>
        <section class="pane cast-pane">
          <div class="pane-head"><h3>${t('Oyuncular')}</h3><span class="count">${p.characters.length}</span><span class="grow"></span>
            <${Btn} small kind="ghost" icon="plus" onClick=${() => api.post(P(p.id, '/characters'), {}).catch(toastError)}>${t('Karakter')}</${Btn}></div>
          <div class="pane-scroll cast">${p.characters.map((c, i) => html`<${CastRow} key=${c.id} p=${p} c=${c} count=${counts[c.id] || 0} i=${i} />`)}</div>
        </section>
      </div>
      <section class="pane lines-pane">
        <div class="pane-head"><h3>${t('Senaryo')}</h3><span class="count" title=${t('{n} satırın kaydı var', { n: recorded })}>${p.lines.length}</span><span class="grow"></span>
          <${Btn} small kind="ghost" icon="translate" onClick=${() => setModal('translate')}>${t('Çevir')}</${Btn}>
          <${Btn} small kind="ghost" icon="copy" onClick=${() => setModal('share')} title=${t("Senaryoyu WhatsApp'tan arkadaşına gönder")}>${t('Gönder')}</${Btn}>
          <${Btn} small kind="primary" icon="mic" onClick=${() => go(`p/${p.id}/record`)}>${t('Kayda geç')}</${Btn}></div>
        ${empty
          ? featureReady('speech')
            ? html`<div class="empty"><h3>${t('Bu sahnede konuşma bulunamadı')}</h3><p class="muted">${t('“Satır ekle” ile kendin ekleyebilirsin.')}</p></div>`
            : html`<div class="empty"><h3>${t('Satırları sen yaz')}</h3><p class="muted">${t('Bir replik başlayınca “Satır ekle”ye bas ve metni yaz.')}</p>
                <${FeatureOffer} id="speech" text=${t('İndirip sahneyi yeniden hazırlarsan satırlar kendiliğinden yazılır.')} class="empty-offer" /></div>`
          : html`<div class="pane-scroll lines">${p.lines.map(
              (l, i) => html`<${LineRow} key=${l.id} p=${p} line=${l} idx=${i} selected=${l.id === sel} chars=${chars} onSelect=${select} onPlay=${playLine} />`
            )}</div>`}
      </section>
      ${zoom != null && html`<${Timeline} duration=${dur} tracks=${[track]} zoom=${zoom} onZoom=${setZoom} selectedId=${sel}
        onSeek=${(at) => player.seek(at)} onSelect=${(c) => select(p.lines.find((l) => l.id === c.id))}
        onMove=${(c, dt) => { const l = p.lines.find((x) => x.id === c.id); const d = Math.max(-l.start, Math.min(dur - l.end, dt)); patchLine(c.id, { start: +(l.start + d).toFixed(3), end: +(l.end + d).toFixed(3) }); }}
        onResize=${(c, edge, at) => patchLine(c.id, { [edge]: +at.toFixed(3) })} />`}
    </div>
    ${modal === 'translate' && html`<${TranslatePanel} p=${p} onClose=${() => setModal(null)} />`}
    ${modal === 'share' && html`<${ShareScript} p=${p} onClose=${() => setModal(null)} />`}
  </div>`;
}
