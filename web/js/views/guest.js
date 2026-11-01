// What friends see when they open the room link on their phone or PC.
import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Field, Icon, Segmented } from '../components.js';
import { LANGS, t } from '../i18n.js';
import { changeLang, openProject, setState, toastError, useStore } from '../state.js';
import { LS } from '../util.js';
import { BoothView } from './booth.js';

function Join() {
  const s = useStore();
  const [name, setName] = useState(LS.get('guest.name', ''));
  const [pin, setPin] = useState(new URLSearchParams(location.search).get('pin') || '');
  const [busy, setBusy] = useState(false);
  const join = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api.post('/api/guest/join', { name, pin });
      LS.set('guest.name', r.name);
      setState({ role: 'guest', guestName: r.name });
      await openProject(r.projectId);
    } catch (err) {
      toastError(err);
    }
    setBusy(false);
  };
  return html`<div class="join">
    <div class="join-lang"><${Segmented} value=${s.lang} onChange=${changeLang} options=${LANGS} /></div>
    <form class="join-card" onSubmit=${join}>
      <img src="/web/icon.svg" alt="" class="join-logo" />
      <h1>${t('Dublaj odası')}</h1>
      <p>${t("Arkadaşın seni bir dublaj odasına çağırdı. Adını ve sana verilen PIN'i yaz.")}</p>
      <${Field} label=${t('Adın')}><input class="input" required maxlength="30" value=${name} onInput=${(e) => setName(e.target.value)} placeholder=${t('ör. Mehmet')} autocomplete="nickname" /></${Field}>
      <${Field} label="PIN"><input class="input pin" required inputmode="numeric" maxlength="4" value=${pin} onInput=${(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" autocomplete="one-time-code" /></${Field}>
      <${Btn} type="submit" kind="primary big" disabled=${busy || !name.trim() || pin.length < 4}>${busy ? t('Giriliyor…') : t('Odaya gir')}</${Btn}>
      <p class="join-note"><${Icon} name="headphones" size=${16} />${t('Kulaklıkla kaydedersen sesin çok daha temiz olur.')}</p>
    </form>
  </div>`;
}

function PickRole({ p, room, onPick }) {
  const live = {};
  if (room) {
    for (const g of room.guests || []) if (g.char) (live[g.char] = live[g.char] || []).push(g.name);
    if (room.host && room.host.online && room.host.char) (live[room.host.char] = live[room.host.char] || []).push(room.host.name);
  }
  return html`<div class="page narrow">
    <header class="page-head"><div><h1>${t('Hangi karakteri seslendireceksin?')}</h1><p>${t('Seçtiğin karakterin replikleri sırayla karşına gelir.')}</p></div></header>
    <div class="rolelist">${p.characters.map((c, i) => {
      const n = p.lines.filter((l) => l.char === c.id).length;
      const done = p.lines.filter((l) => l.char === c.id && l.take).length;
      const who = [...new Set([...(live[c.id] || []), ...(c.actor || '').split(',').map((x) => x.trim()).filter(Boolean)])];
      return html`<button key=${c.id} class="rolerow" style=${{ '--c': c.color, '--i': i }} onClick=${() => onPick(c.id)}>
        <span class="hl" style=${{ '--c': c.color }}>${c.name}</span>
        <span class="rolerow-who">${who.length ? html`${live[c.id] ? html`<span class="lamp ok"></span>` : ''}${who.join(', ')}` : html`<span class="dim">${t('kimse almadı')}</span>`}</span>
        <span class="tc dim small">${t('{a}/{b} kayıtlı', { a: done, b: n })}</span>
        <${Icon} name="chevron" size=${14} />
      </button>`;
    })}</div>
    <button class="linkbtn" onClick=${() => onPick(null)}>${t('Hepsini göster')}</button>
  </div>`;
}

export function GuestApp() {
  const s = useStore();
  const [picked, setPicked] = useState(null);
  const p = s.project;
  const key = p ? 'guest.chars.' + p.id : null;
  useEffect(() => {
    if (s.role !== 'guest') return;
    const beat = () => {
      const f = key ? LS.get(key, []) || [] : [];
      api.post('/api/guest/heartbeat', { view: 'record', char: f.length === 1 ? f[0] : null }).catch(() => {});
    };
    const timer = setInterval(beat, 10000);
    return () => clearInterval(timer);
  }, [s.role, key]);
  if (s.role === 'anon') return html`<${Join} />`;
  if (!p) return html`<div class="boot"><img class="boot-mark" src="/web/icon.svg" alt="" />${t('Proje yükleniyor…')}</div>`;
  if (p.status !== 'ready') return html`<div class="boot"><img class="boot-mark" src="/web/icon.svg" alt="" />${t('Sahne henüz hazırlanıyor, birazdan tekrar dene.')}</div>`;
  const chosen = picked !== null || LS.get(key, null) !== null;
  return html`<div class="shell guest">
    <header class="topbar">
      <div class="topbar-left"><span class="brand"><img src="/web/icon.svg" alt="" /><span>DubKanka</span></span>
        <span class="crumb">/</span><span class="projname">${p.name}</span></div>
      <span class="topbar-spacer"></span>
      <div class="topbar-right"><span class="muted small row"><${Icon} name="user" size=${14} /> ${s.guestName}</span>
        ${chosen && html`<${Btn} small kind="ghost" onClick=${() => { LS.set(key, null); setPicked(null); }}>${t('Rol değiştir')}</${Btn}>`}</div>
    </header>
    <main class="main">
      ${chosen
        ? html`<${BoothView} key=${'g' + (picked || '')} p=${p} guest />`
        : html`<${PickRole} p=${p} room=${s.room} onPick=${(cid) => {
            LS.set(key, cid ? [cid] : []);
            setPicked(cid || '');
            if (cid) api.post(`/api/projects/${p.id}/characters/${cid}/claim`).catch(() => {});
          }} />`}
    </main>
  </div>`;
}
