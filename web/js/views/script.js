import { html, useEffect, useMemo, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P } from '../api.js';
import { Btn, CharDot, Field, Icon, JobPanel, Modal, PlayButton, Select, TimeReadout, Toggle, usePlaying, VideoPane } from '../components.js';
import { engine, player, stemUrls } from '../engine.js';
import { go, jobOf, patchLocal, toast, toastError, useStore } from '../state.js';
import { fitZoom, Timeline } from '../timeline.js';
import { cls, copyText, debounce, fmtTime, syllables } from '../util.js';

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

function SpeedBadge({ orig, text }) {
  if (!text || !text.trim()) return html`<span class="badge" title="Dublaj metni boş">boş</span>`;
  const so = syllables(orig);
  const sd = syllables(text);
  const r = sd / Math.max(1, so);
  if (r > 1.35) return html`<span class="badge bad" title=${`Orijinal ${so} hece, dublaj ${sd} hece. Kısaltırsan ağız hareketine daha iyi oturur.`}>uzun</span>`;
  if (r < 0.6) return html`<span class="badge warn" title=${`Orijinal ${so} hece, dublaj ${sd} hece.`}>kısa</span>`;
  return html`<span class="badge good" title=${`Orijinal ${so} hece, dublaj ${sd} hece.`}>uygun</span>`;
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
    const t = setTimeout(() => setFlash(false), 900);
    return () => clearTimeout(t);
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
  const recorded = line.take && (line.takes || []).some((t) => t.id === line.take);
  const setChar = (cid) => {
    patchLocal((pp) => (pp.lines.find((l) => l.id === line.id).char = cid));
    api.patch(P(p.id, `/lines/${line.id}`), { char: cid }).catch(toastError);
  };
  return html`<div class=${cls('linerow', selected && 'sel', flash && 'flash')} style=${{ '--c': c ? c.color : '#8b8b93', '--i': idx }} onClick=${() => onSelect(line)} id=${'line-' + line.id}>
    <div class="linerow-num">${idx + 1}</div>
    <div class="linerow-main">
      <div class="linerow-meta">
        <select class="input charselect" value=${line.char} title="Bu satırı kim söylüyor?" onClick=${(e) => e.stopPropagation()} onChange=${(e) => setChar(e.target.value)}>
          ${p.characters.map((ch) => html`<option value=${ch.id} selected=${ch.id === line.char}>${ch.name}</option>`)}
        </select>
        <span class="tc">${fmtTime(line.start)} · ${(line.end - line.start).toFixed(1)} sn</span>
      </div>
      <div class="orig" title="Orijinal">${line.orig || html`<em>(orijinal metin yok)</em>`}</div>
      <textarea ref=${area} class="input dubtext" rows="1" placeholder="Dublaj repliğini yaz…" value=${text}
        onFocus=${() => { focused.current = true; onSelect(line); }}
        onBlur=${(e) => { focused.current = false; save.flush(e.target.value); }}
        onInput=${(e) => { setText(e.target.value); save(e.target.value); }}
        onKeyDown=${(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const next = document.querySelector(`#line-${p.lines[idx + 1]?.id} textarea`); if (next) next.focus(); else e.target.blur(); } }}></textarea>
    </div>
    <div class="linerow-side">
      <div class="row" style=${{ gap: '4px', justifyContent: 'flex-end' }}>
        ${recorded ? html`<span class="badge good" title="Kaydı var"><${Icon} name="check" size=${12} />kayıt</span>` : null}
        <${SpeedBadge} orig=${line.orig} text=${text} />
      </div>
      <div class="linerow-acts">
        <button class="iconbtn" title="Orijinali dinle" onClick=${(e) => { e.stopPropagation(); onPlay(line); }}><${Icon} name="headphones" size=${16} /></button>
        <button class="iconbtn" title="Bu satırı kaydet" onClick=${(e) => { e.stopPropagation(); go(`p/${p.id}/record/${line.id}`); }}><${Icon} name="mic" size=${16} /></button>
      </div>
    </div>
  </div>`;
}

function CharChip({ p, c, count }) {
  const [name, setName] = useState(c.name);
  const [actor, setActor] = useState(c.actor || '');
  useEffect(() => setName(c.name), [c.name]);
  useEffect(() => setActor(c.actor || ''), [c.actor]);
  const patch = (body) => api.patch(P(p.id, `/characters/${c.id}`), body).catch(toastError);
  const [menu, setMenu] = useState(false);
  const merge = async (into) => {
    setMenu(false);
    if (!into) return;
    await api.post(P(p.id, `/characters/${c.id}/merge`), { into }).catch(toastError);
  };
  return html`<div class="charchip" style=${{ '--c': c.color }}>
    <input type="color" class="colorpick" value=${c.color} title="Renk" onChange=${(e) => patch({ color: e.target.value })} />
    <div class="charchip-fields">
      <input class="bare strong" value=${name} title="Karakter adı" aria-label="Karakter adı" onInput=${(e) => setName(e.target.value)} onBlur=${() => name.trim() && name !== c.name && patch({ name: name.trim() })} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />
      <input class="bare small" value=${actor} placeholder="Seslendiren…" title="Bu rolü kim seslendirecek?" aria-label="Seslendiren" onInput=${(e) => setActor(e.target.value)} onBlur=${() => actor !== (c.actor || '') && patch({ actor: actor.trim() })} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />
    </div>
    <span class="count">${count}</span>
    <button class="iconbtn" title="Diğer işlemler" onClick=${() => setMenu(!menu)}><${Icon} name="dots" size=${16} /></button>
    ${menu && html`<div class="popmenu" onMouseLeave=${() => setMenu(false)}>
      <div class="muted small">Aynı kişi mi? Şununla birleştir:</div>
      ${p.characters.filter((x) => x.id !== c.id).map((x) => html`<button class="popitem" onClick=${() => merge(x.id)}><${CharDot} color=${x.color} /> ${x.name}</button>`)}
      ${count === 0 && html`<button class="popitem danger" onClick=${() => { setMenu(false); api.del(P(p.id, `/characters/${c.id}`)).catch(toastError); }}><${Icon} name="trash" size=${14} /> Karakteri sil</button>`}
    </div>`}
  </div>`;
}

function TranslatePanel({ p, onClose }) {
  const s = useStore();
  const sys = s.system || {};
  const [engineName, setEngine] = useState(p.settings.translator || 'google');
  const [style, setStyle] = useState(p.settings.style || 'natural');
  const [onlyEmpty, setOnlyEmpty] = useState(false);
  const job = jobOf('translate');
  const go_ = () => api.post(P(p.id, '/translate'), { engine: engineName, style, onlyEmpty }).catch(toastError);
  const runningJob = job && (job.status === 'running' || job.status === 'queued');
  return html`<${Modal} title="Satırları çevir" onClose=${onClose}>
    <${Field} label="Çeviri motoru"><${Select} value=${engineName} onChange=${setEngine} options=${[['google', 'Google Çeviri (ücretsiz)'], ['claude', 'Claude: dublaja uygun çeviri']]} /></${Field}>
    ${engineName === 'claude' && html`<${Field} label="Tarz" hint="Troll: sahne aynı kalır, replikler komik ya da absürt yeniden yazılır.">
      <${Select} value=${style} onChange=${setStyle} options=${Object.entries(sys.styles || {})} /></${Field}>`}
    ${engineName === 'claude' && sys.settings && !sys.settings.hasAnthropicKey && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />Önce <a href="#/settings">Ayarlar</a>'dan Anthropic API anahtarını gir.</div>`}
    <${Toggle} checked=${onlyEmpty} onChange=${setOnlyEmpty} label="Sadece boş satırları çevir (yazdıklarım kalsın)" />
    ${!onlyEmpty && html`<p class="muted small">Dolu satırların metni de değişecek.</p>`}
    ${job && html`<${JobPanel} job=${job} />`}
    <div class="modal-actions"><${Btn} onClick=${onClose}>Kapat</${Btn}><${Btn} kind="primary" icon="sparkle" disabled=${runningJob} onClick=${go_}>Çevir</${Btn}></div>
  </${Modal}>`;
}

export function scriptText(p, cid) {
  const c = p.characters.find((x) => x.id === cid);
  const rows = [];
  p.lines.forEach((l, i) => {
    if (cid && l.char !== cid) return;
    rows.push(`#${i + 1}  [${fmtTime(l.start)} · ${(l.end - l.start).toFixed(1)} sn]${cid ? '' : '  ' + (p.characters.find((x) => x.id === l.char) || {}).name}\n${l.text || '(boş)'}\n   orijinal: ${l.orig}`);
  });
  return `🎬 ${p.name} — dublaj senaryosu${c ? `\nRolün: ${c.name}` : ''}\n` +
    `Her repliği ayrı kaydet, dosyanın adını satır numarası yap (ör. 3.m4a). WhatsApp sesli mesajı da olur.\n\n` + rows.join('\n\n');
}

function ShareScript({ p, onClose }) {
  const [cid, setCid] = useState(p.characters[0] ? p.characters[0].id : '');
  const txt = scriptText(p, cid);
  return html`<${Modal} title="Senaryoyu arkadaşına gönder" onClose=${onClose} wide>
    <p class="muted">Arkadaşın odaya bağlanamıyorsa bu metni WhatsApp'tan gönder. Kayıtlarını sana atınca <b>Kayıt</b> ekranındaki <b>Dosyadan yükle</b> ile eklersin, zamanlamayı uygulama ayarlar.</p>
    <${Field} label="Kimin için?"><${Select} value=${cid} onChange=${setCid} options=${[...p.characters.map((c) => [c.id, c.name]), ['', 'Tüm senaryo']]} /></${Field}>
    <textarea class="input sharetext" readonly value=${txt}></textarea>
    <div class="modal-actions"><${Btn} icon="copy" kind="primary" onClick=${async () => { await copyText(txt); toast('Kopyalandı', 'ok'); }}>Kopyala</${Btn}></div>
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
    const el = document.getElementById('line-' + l.id);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  const patchLine = (lid, body) => {
    patchLocal((pp) => Object.assign(pp.lines.find((l) => l.id === lid), body));
    api.patch(P(p.id, `/lines/${lid}`), body).catch(toastError);
  };
  const addLine = async () => {
    const t = Math.max(0, player.time);
    const l = await api.post(P(p.id, '/lines'), { start: t, end: Math.min(dur, t + 2), char: selLine ? selLine.char : undefined }).catch(toastError);
    if (l) setSel(l.id);
  };
  const split = () => selLine && api.post(P(p.id, `/lines/${selLine.id}/split`), { at: player.time }).catch(toastError);
  const mergeNext = () => {
    if (!selLine) return;
    const hasTakes = (selLine.takes || []).length;
    if (hasTakes && !confirm('Birleştirince sonraki satırın kayıtları silinir. Devam?')) return;
    api.post(P(p.id, `/lines/${selLine.id}/merge-next`)).catch(toastError);
  };
  const delLine = () => {
    if (!selLine) return;
    if ((selLine.takes || []).length && !confirm('Bu satırın kayıtları da silinecek. Emin misin?')) return;
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
    id: 'voices', label: html`<${Icon} name="wave" size=${14} />Orijinal konuşmalar`, height: 84, buffer: voices, waveColor: 'rgba(205,205,215,0.32)',
    clips: p.lines.map((l, i) => ({
      id: l.id, start: l.start, end: l.end, color: (chars[l.char] || {}).color, label: `${i + 1}`,
      title: `${(chars[l.char] || {}).name}: ${l.orig}`, resizable: true, draggable: true, className: 'lineclip',
    })),
  };
  const empty = p.lines.length === 0;

  return html`<div class="page script" ref=${wrap}>
    <div class="ws script-ws">
      <div class="viewer-col">
        <section class="pane viewer-pane">
          <${VideoPane} src=${fileUrl(p.id, p.clip.preview, p.clip.ver)} poster=${fileUrl(p.id, p.clip.thumb, p.clip.ver)} class="script-video" />
          <div class="transport">
            <${PlayButton} playing=${playing} onClick=${toggle} disabled=${!original} />
            <${TimeReadout} duration=${dur} />
            <span class="grow"></span>
            <${Btn} small kind="ghost" icon="plus" onClick=${addLine} title="Oynatma çizgisinin olduğu yere yeni satır">Satır ekle</${Btn}>
            <${Btn} small kind="ghost" icon="cut" onClick=${split} disabled=${!selLine} title="Seçili satırı oynatma çizgisinden ikiye böl">Böl</${Btn}>
            <${Btn} small kind="ghost" icon="merge" onClick=${mergeNext} disabled=${!selLine} title="Seçili satırı sonrakiyle birleştir">Birleştir</${Btn}>
            <${Btn} small kind="ghost" icon="trash" onClick=${delLine} disabled=${!selLine} title="Seçili satırı sil">Sil</${Btn}>
          </div>
        </section>
        <section class="pane chars-pane">
          <div class="pane-head"><h3>Karakterler</h3><span class="count">${p.characters.length}</span><span class="grow"></span>
            <${Btn} small kind="ghost" icon="plus" onClick=${() => api.post(P(p.id, '/characters'), {}).catch(toastError)}>Karakter</${Btn}></div>
          <div class="pane-body">${p.characters.map((c) => html`<${CharChip} key=${c.id} p=${p} c=${c} count=${counts[c.id] || 0} />`)}</div>
        </section>
      </div>
      <section class="pane lines-pane">
        <div class="pane-head"><h3>Satırlar</h3><span class="count">${p.lines.length}</span><span class="grow"></span>
          <${Btn} small kind="ghost" icon="sparkle" onClick=${() => setModal('translate')}>Çevir</${Btn}>
          <${Btn} small kind="ghost" icon="copy" onClick=${() => setModal('share')} title="Senaryoyu WhatsApp'tan göndermek için kopyala">Paylaş</${Btn}>
          <${Btn} small kind="primary" icon="mic" onClick=${() => go(`p/${p.id}/record`)}>Kayda geç</${Btn}></div>
        ${empty
          ? html`<div class="empty"><h3>Bu sahnede konuşma bulunamadı</h3><p class="muted">Videoyu oynatıp "Satır ekle" ile replikleri kendin ekleyebilirsin.</p></div>`
          : html`<div class="pane-scroll lines">${p.lines.map(
              (l, i) => html`<${LineRow} key=${l.id} p=${p} line=${l} idx=${i} selected=${l.id === sel} chars=${chars} onSelect=${select} onPlay=${playLine} />`
            )}</div>`}
      </section>
      ${zoom != null && html`<${Timeline} duration=${dur} tracks=${[track]} zoom=${zoom} onZoom=${setZoom} selectedId=${sel}
        onSeek=${(t) => player.seek(t)} onSelect=${(c) => select(p.lines.find((l) => l.id === c.id))}
        onMove=${(c, dt) => { const l = p.lines.find((x) => x.id === c.id); const d = Math.max(-l.start, Math.min(dur - l.end, dt)); patchLine(c.id, { start: +(l.start + d).toFixed(3), end: +(l.end + d).toFixed(3) }); }}
        onResize=${(c, edge, t) => patchLine(c.id, { [edge]: +t.toFixed(3) })} />`}
    </div>
    ${modal === 'translate' && html`<${TranslatePanel} p=${p} onClose=${() => setModal(null)} />`}
    ${modal === 'share' && html`<${ShareScript} p=${p} onClose=${() => setModal(null)} />`}
  </div>`;
}
