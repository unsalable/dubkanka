// What friends see when they open the room link on their phone or PC.
import { html, useEffect, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Field, Icon, Swatch } from '../components.js';
import { openProject, setState, toastError, useStore } from '../state.js';
import { LS } from '../util.js';
import { BoothView } from './booth.js';

function Join() {
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
    <form class="panel join-card" onSubmit=${join}>
      <img src="/web/icon.svg" alt="" class="join-logo" />
      <h1>Dublaja hoş geldin</h1>
      <p>Arkadaşın seni bir dublaj odasına çağırdı. Adını ve sana verilen PIN'i yaz.</p>
      <${Field} label="Adın"><input class="input" required maxlength="30" value=${name} onInput=${(e) => setName(e.target.value)} placeholder="ör. Mehmet" autocomplete="nickname" /></${Field}>
      <${Field} label="PIN"><input class="input pin" required inputmode="numeric" maxlength="4" value=${pin} onInput=${(e) => setPin(e.target.value.replace(/\D/g, ''))} placeholder="••••" autocomplete="one-time-code" /></${Field}>
      <${Btn} type="submit" kind="primary big" disabled=${busy || !name.trim() || pin.length < 4}>${busy ? 'Giriliyor…' : 'Odaya gir'}</${Btn}>
      <p class="join-note"><${Icon} name="headphones" size=${16} />Kulaklıkla kaydedersen sesin çok daha temiz olur.</p>
    </form>
  </div>`;
}

function PickRole({ p, onPick }) {
  return html`<div class="page narrow">
    <header class="page-head"><div><h1>Hangi karakteri seslendireceksin?</h1><p>Seçtiğin karakterin replikleri sırayla karşına gelir.</p></div></header>
    <div class="rolecards">${p.characters.map((c, i) => {
      const n = p.lines.filter((l) => l.char === c.id).length;
      const done = p.lines.filter((l) => l.char === c.id && l.take).length;
      return html`<button key=${c.id} class="rolecard" style=${{ '--c': c.color, '--i': i }} onClick=${() => onPick(c.id)}>
        <${Swatch} color=${c.color} /><strong>${c.name}</strong>
        <span class="muted small">${n} replik · ${done} kayıtlı${c.actor ? ` · ${c.actor}` : ''}</span></button>`;
    })}</div>
    <button class="linkbtn" onClick=${() => onPick(null)}>Hepsini göster</button>
  </div>`;
}

export function GuestApp() {
  const s = useStore();
  const [picked, setPicked] = useState(null);
  const p = s.project;
  useEffect(() => {
    if (s.role !== 'guest') return;
    const t = setInterval(() => api.post('/api/guest/heartbeat', { view: 'record' }).catch(() => {}), 10000);
    return () => clearInterval(t);
  }, [s.role]);
  if (s.role === 'anon') return html`<${Join} />`;
  if (!p) return html`<div class="boot"><img class="boot-mark" src="/web/icon.svg" alt="" />Proje yükleniyor…</div>`;
  if (p.status !== 'ready') return html`<div class="boot"><img class="boot-mark" src="/web/icon.svg" alt="" />Sahne henüz hazırlanıyor, birazdan tekrar dene.</div>`;
  const key = 'guest.chars.' + p.id;
  const chosen = picked !== null || LS.get(key, null) !== null;
  return html`<div class="shell guest">
    <header class="topbar">
      <div class="topbar-left"><span class="brand"><img src="/web/icon.svg" alt="" /><span>DubKanka</span></span>
        <span class="crumb">/</span><span class="projname">${p.name}</span></div>
      <span class="topbar-spacer"></span>
      <div class="topbar-right"><span class="muted small row"><${Icon} name="users" size=${14} /> ${s.guestName}</span>
        ${chosen && html`<${Btn} small kind="ghost" onClick=${() => { LS.set(key, null); setPicked(null); }}>Rol değiştir</${Btn}>`}</div>
    </header>
    <main class="main">
      ${chosen
        ? html`<${BoothView} key=${'g' + (picked || '')} p=${p} guest />`
        : html`<${PickRole} p=${p} onPick=${(cid) => {
            LS.set(key, cid ? [cid] : []);
            setPicked(cid || '');
            if (cid) api.post(`/api/projects/${p.id}/characters/${cid}/claim`).catch(() => {});
          }} />`}
    </main>
  </div>`;
}
