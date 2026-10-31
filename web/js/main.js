import { html, render, useEffect, useRef, useState } from '../vendor/preact-htm.js';
import { api, P } from './api.js';
import { Icon, Toasts, useIndicator } from './components.js';
import { desktop, useUpdate } from './desktop.js';
import { player } from './engine.js';
import { go, openProject, setState, startWatch, store, toastError, useStore } from './state.js';
import { cls } from './util.js';
import { BoothView } from './views/booth.js';
import { ExportView } from './views/export.js';
import { GuestApp } from './views/guest.js';
import { HomeView } from './views/home.js';
import { MixerView } from './views/mixer.js';
import { PrepareView } from './views/prepare.js';
import { RoomView } from './views/room.js';
import { ScriptView } from './views/script.js';
import { SettingsView } from './views/settings.js';

const TABS = [
  ['prepare', 'Sahne', 'film'],
  ['script', 'Senaryo', 'text'],
  ['record', 'Kayıt', 'mic'],
  ['mix', 'Mikser', 'sliders'],
  ['export', 'Paylaş', 'share'],
];

function RoomButton({ project, active }) {
  const s = useStore();
  const r = s.room;
  const on = r && r.status === 'on';
  const online = on ? (r.guests || []).filter((g) => g.online).length : 0;
  const href = project ? `#/p/${project.id}/room` : r && r.projectId ? `#/p/${r.projectId}/room` : null;
  if (!href) return null;
  const tone = !r || r.status === 'off' ? null : on ? 'ok' : r.status === 'starting' ? 'busy' : 'bad';
  return html`<a class=${cls('roombtn', active && 'active')} href=${href} title="Arkadaşlarını odaya çağır">
    ${tone ? html`<span class=${cls('lamp', tone)}></span>` : html`<${Icon} name="users" size=${16} />`}
    <span class="roombtn-label">${!r || r.status === 'off' ? 'Oda' : on ? 'Oda açık' : r.status === 'starting' ? 'Oda açılıyor' : 'Oda hatası'}</span>
    ${on && html`<span class="count" title="Odadaki arkadaşlar">${online}</span>`}</a>`;
}

function UpdateButton() {
  const u = useUpdate();
  if (!u || u.state !== 'downloaded') return null;
  return html`<button class="updatebtn" title=${`DubKanka ${u.version} indirildi`} onClick=${() => desktop.updates.install()}>
    <${Icon} name="refresh" size=${14} />Güncelle ve yeniden başlat</button>`;
}

function ProjectName({ p }) {
  const [edit, setEdit] = useState(false);
  const [name, setName] = useState(p.name);
  useEffect(() => setName(p.name), [p.name]);
  const save = () => {
    setEdit(false);
    if (name.trim() && name !== p.name) api.patch(P(p.id), { name: name.trim() }).catch(toastError);
  };
  if (edit)
    return html`<input class="input projname-input" value=${name} autoFocus onInput=${(e) => setName(e.target.value)}
      onBlur=${save} onKeyDown=${(e) => e.key === 'Enter' && e.target.blur()} />`;
  return html`<button class="projname" title="Adı değiştir" onClick=${() => setEdit(true)}>${p.name}</button>`;
}

function Tabs({ project, tab }) {
  const ready = project.status === 'ready';
  const box = useRef(null);
  const ind = useRef(null);
  useIndicator(box, ind, '.tab.active', [tab, ready]);
  return html`<nav class="tabs" ref=${box} aria-label="Adımlar">
    <i class="tab-ind" ref=${ind}></i>
    ${TABS.map(([k, label, icon], i) => {
      const disabled = k !== 'prepare' && !ready;
      return html`<a key=${k} class=${cls('tab', tab === k && 'active', disabled && 'disabled')} aria-current=${tab === k ? 'page' : undefined}
        href=${disabled ? undefined : `#/p/${project.id}/${k}`} title=${disabled ? 'Önce sahneyi hazırla' : label}>
        <span class="tab-n">${i + 1}</span><${Icon} name=${icon} size=${15} /><span class="tab-label">${label}</span></a>`;
    })}
  </nav>`;
}

function Shell({ project, tab, children }) {
  return html`<div class="shell">
    <header class="topbar">
      <div class="topbar-left">
        <a class="brand" href="#/" title="Projeler"><img src="/web/icon.svg" alt="" /><span>DubKanka</span></a>
        ${project && html`<span class="crumb">/</span><${ProjectName} p=${project} />`}
      </div>
      ${project ? html`<${Tabs} project=${project} tab=${tab} />` : html`<span class="topbar-spacer"></span>`}
      <div class="topbar-right">
        <${UpdateButton} />
        <${RoomButton} project=${project} active=${tab === 'room'} />
        <a class=${cls('iconbtn', store.route[0] === 'settings' && 'on')} href="#/settings" title="Ayarlar"><${Icon} name="gear" /></a>
      </div>
    </header>
    <main class="main">${children}</main>
  </div>`;
}

function Loading() {
  return html`<div class="page" aria-busy="true">
    <div class="ws" style=${{ gridTemplateColumns: 'minmax(0,1.1fr) minmax(320px,1fr)', height: 'min(62vh, 640px)' }}>
      <div class="skel" style=${{ borderRadius: 0 }}></div><div class="skel" style=${{ borderRadius: 0 }}></div>
    </div>
  </div>`;
}

function ProjectShell({ pid, tab }) {
  const s = useStore();
  useEffect(() => {
    openProject(pid);
  }, [pid]);
  useEffect(() => () => player.stop(), [tab]);
  const p = s.project && s.project.id === pid ? s.project : null;
  if (!p) return html`<${Shell}><${Loading} /></${Shell}>`;
  const ready = p.status === 'ready';
  let cur = tab || (ready ? 'script' : 'prepare');
  if (!ready && !['prepare', 'room'].includes(cur)) cur = 'prepare';
  const views = { prepare: PrepareView, script: ScriptView, record: BoothView, mix: MixerView, export: ExportView, room: RoomView };
  const View = views[cur] || PrepareView;
  return html`<${Shell} project=${p} tab=${cur}><${View} key=${cur + pid} p=${p} /></${Shell}>`;
}

function App() {
  const s = useStore();
  if (s.bootError)
    return html`<div class="boot error"><img class="boot-mark" src="/web/icon.svg" alt="" />${s.bootError}
      <button class="btn" onClick=${() => location.reload()}>Tekrar dene</button></div>`;
  if (!s.role) return html`<div class="boot"><img class="boot-mark" src="/web/icon.svg" alt="" />Bağlanıyor…</div>`;
  if (s.role !== 'host') return html`<${GuestApp} /><${Toasts} />`;
  const [a, b, c] = s.route;
  let view;
  if (a === 'p' && b) view = html`<${ProjectShell} pid=${b} tab=${c} />`;
  else if (a === 'settings') view = html`<${Shell}><${SettingsView} /></${Shell}>`;
  else view = html`<${Shell}><${HomeView} /></${Shell}>`;
  return html`${view}<${Toasts} />${!s.online && html`<div class="offline" role="alert"><${Icon} name="alert" size=${16} />
    Uygulamayla bağlantı koptu. DubKanka açık mı?</div>`}`;
}

async function boot() {
  try {
    const who = await api.get('/api/whoami');
    setState({ role: who.role, guestName: who.name });
    if (who.role === 'host') setState({ system: await api.get('/api/system') });
    else if (who.role === 'guest' && who.projectId) await openProject(who.projectId);
  } catch (e) {
    setState({ bootError: e.message });
  }
  if (!store.projectId && store.role !== 'anon') startWatch();
}

render(html`<${App} />`, document.getElementById('app'));
boot();
window.dk = { store, player, go };
