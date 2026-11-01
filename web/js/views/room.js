import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Icon, Lamp } from '../components.js';
import { FeatureOffer } from '../feature-ui.js';
import { t } from '../i18n.js';
import { toast, toastError, useStore } from '../state.js';
import { cls, copyText, LS, timeAgo } from '../util.js';
import { scriptText } from './script.js';

function Person({ name, me, online, char, line, p }) {
  const c = char && p.characters.find((x) => x.id === char);
  return html`<div class="person">
    <span class=${online ? 'lamp ok' : 'lamp'}></span>
    <strong>${name}</strong>${me && html`<span class="dim small">${t('oda sahibi')}</span>`}
    <span class="grow"></span>
    ${c ? html`<span class="hl" style=${{ '--c': c.color }}>${c.name}</span>` : html`<span class="dim small">${t('rol seçmedi')}</span>`}
    <span class="tc dim small person-line">${online ? (line ? t('{n}. satır', { n: line }) : t('çevrimiçi')) : t('ayrıldı')}</span>
  </div>`;
}

export function RoomView({ p }) {
  const s = useStore();
  const r = s.room || { status: 'off' };
  const [busy, setBusy] = useState(false);
  // the link and PIN arrive with a little flourish only when the room opens while you watch
  const was = useRef(r.status);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    if (r.status === 'on' && was.current === 'starting') setFresh(true);
    was.current = r.status;
  }, [r.status]);
  const mine = r.projectId === p.id;
  const open = async () => {
    setBusy(true);
    await api.post('/api/room/start', { projectId: p.id }).catch(toastError);
    setBusy(false);
  };
  const close = () => api.post('/api/room/stop').catch(toastError);
  const invite = t('🎙 {name} dublajına gel!\n1) Linke tıkla: {url}\n2) Adını yaz, PIN: {pin}\n3) Karakterini seç ve kaydet. Kulaklık takarsan süper olur 🎧', { name: p.name, url: r.url, pin: r.pin });
  const head = html`<header class="page-head"><div><h1>${t('Oda')}</h1></div></header>`;

  if (!r.hasCloudflared && r.status !== 'on')
    return html`<div class="page narrow room">
      ${head}
      <section class="panel">
        <${FeatureOffer} id="room" text=${t('Oda için bunu bir kere indirmen gerekiyor. Ücretsiz, hesap istemez.')} />
      </section>
      <${OfflineHelp} p=${p} />
    </div>`;

  const guests = r.guests || [];
  const hostName = LS.get('booth.name', t('Ben'));
  return html`<div class="page narrow room">
    ${head}
    ${r.status === 'off' || !mine
      ? html`<section class="panel">
          <p>${t('Odayı açınca bir link ve PIN oluşur; ikisini arkadaşlarına gönder.')}</p>
          ${r.status !== 'off' && !mine && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />${t('Şu an başka bir proje için oda açık; bunu açarsan o oda kapanır.')}</div>`}
          <${Btn} kind="primary" icon="users" disabled=${busy} onClick=${open}>${busy ? t('Açılıyor…') : t('Odayı aç')}</${Btn}>
        </section>`
      : r.status === 'starting'
      ? html`<section class="panel"><div class="row"><span class="spinner"></span> ${t('Güvenli bağlantı kuruluyor, birkaç saniye…')}</div></section>`
      : r.status === 'error'
      ? html`<section class="panel"><div class="alert error"><${Icon} name="alert" size=${16} />${t('Oda açılamadı: {e}', { e: r.error === 'cloudflared-missing' ? t('bağlantı aracı bulunamadı') : r.error })}</div>
          <div class="toolbar"><${Btn} onClick=${open}>${t('Tekrar dene')}</${Btn}><${Btn} kind="ghost" onClick=${close}>${t('Kapat')}</${Btn}></div></section>`
      : html`<section class=${cls('panel invite', fresh && 'fresh')}>
          <div class="invite-qr"><img src=${'/api/room/qr.svg?u=' + encodeURIComponent(r.url)} alt=${t('Oda linkinin QR kodu')} /></div>
          <div class="invite-info">
            <div class="label">${t('Link')}</div>
            <div class="invite-link mono">${r.url}</div>
            <div class="label">PIN</div>
            <div class="invite-pin" aria-label=${'PIN ' + r.pin}>${String(r.pin).split('').map((d, i) => html`<span key=${i + d} style=${{ '--i': i }}>${d}</span>`)}</div>
            <div class="toolbar">
              <${Btn} kind="primary" icon="copy" onClick=${async () => { await copyText(invite); toast(t('Davet mesajı kopyalandı'), 'ok'); }}>${t('Davet mesajını kopyala')}</${Btn}>
              <${Btn} icon="link" onClick=${async () => { await copyText(r.url); toast(t('Link kopyalandı'), 'ok'); }}>${t('Sadece link')}</${Btn}>
              <${Btn} kind="ghost" icon="x" onClick=${close}>${t('Odayı kapat')}</${Btn}>
            </div>
          </div>
        </section>
        <div class="room-cols">
          <section class="panel">
            <div class="panel-head"><h3>${t('Odadakiler')}</h3><span class="dim small">${t('{n} misafir çevrimiçi', { n: guests.filter((g) => g.online).length })}</span></div>
            <${Person} p=${p} me name=${(r.host && r.host.name) || hostName} online=${r.host ? r.host.online : true} char=${r.host && r.host.char} line=${r.host && r.host.line} />
            ${guests.map((g) => html`<${Person} key=${g.name} p=${p} name=${g.name} online=${g.online} char=${g.char} line=${g.line} />`)}
            ${guests.length === 0 && html`<p class="dim small" style=${{ marginTop: '8px' }}>${t('Henüz kimse katılmadı.')}</p>`}
          </section>
          <section class="panel">
            <div class="panel-head"><h3>${t('Olanlar')}</h3></div>
            <div class="feed">${(r.activity || []).length === 0 ? html`<p class="dim small">${t('Henüz bir şey olmadı.')}</p>` : (r.activity || []).map(
              (a) => html`<div key=${a.t + a.text}><span class="tc dim">${timeAgo(a.t)}</span>${a.text}</div>`)}</div>
          </section>
        </div>`}
    <${OfflineHelp} p=${p} />
  </div>`;
}

function OfflineHelp({ p }) {
  return html`<details class="panel">
    <summary><strong>${t('Arkadaşın bağlanamıyor mu?')}</strong></summary>
    <ol class="how-list">
      <li>${t('Senaryo ekranındaki Gönder ile her arkadaşına kendi repliklerini gönder.')}</li>
      <li>${t('Her repliği ayrı kaydetsinler; dosya adı satır numarası olursa (ör. 3.m4a) yeri kendiliğinden bulunur. Sesli mesaj da olur.')}</li>
      <li>${t('Gelen dosyaları Kayıt ekranında Toplu yükle ile at. Numarasız dosyaların satırını listeden seçersin; sessizlikler kesilir, her kayıt yerine hizalanır.')}</li>
    </ol>
    <${Btn} small icon="copy" onClick=${async () => { await copyText(scriptText(p, '')); toast(t('Tüm senaryo kopyalandı'), 'ok'); }}>${t('Tüm senaryoyu kopyala')}</${Btn}>
  </details>`;
}
