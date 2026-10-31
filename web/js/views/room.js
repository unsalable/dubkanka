import { html, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Icon, JobPanel } from '../components.js';
import { jobOf, toast, toastError, useStore } from '../state.js';
import { copyText, timeAgo } from '../util.js';
import { scriptText } from './script.js';

export function RoomView({ p }) {
  const s = useStore();
  const r = s.room || { status: 'off' };
  const [busy, setBusy] = useState(false);
  const dl = s.jobs.find((j) => j.kind === 'download') || jobOf('download');
  const dlRunning = dl && (dl.status === 'running' || dl.status === 'queued');
  const mine = r.projectId === p.id;
  const open = async () => {
    setBusy(true);
    await api.post('/api/room/start', { projectId: p.id }).catch(toastError);
    setBusy(false);
  };
  const close = () => api.post('/api/room/stop').catch(toastError);
  const invite = `🎙 ${p.name} dublajına gel!\n1) Linke tıkla: ${r.url}\n2) Adını yaz, PIN: ${r.pin}\n3) Karakterini seç ve kaydet. Kulaklık takarsan süper olur 🎧`;
  const head = html`<header class="page-head"><div><h1>Arkadaşlarını davet et</h1>
    <p>Arkadaşların başka evlerden, telefonlarından bile bağlanıp kendi repliklerini kaydedebilir. Kayıtları anında senin projene düşer.</p></div></header>`;

  if (!r.hasCloudflared && r.status !== 'on')
    return html`<div class="page narrow room">
      ${head}
      <section class="panel">
        <p>Bunun için bir kerelik küçük bir bağlantı aracı indirilmeli: Cloudflare <code>cloudflared</code>, ücretsiz, yaklaşık 60 MB.
          Hesap açman gerekmez; uygulama açıkken arkadaşlarına güvenli (https) bir link verir.</p>
        ${dl && html`<${JobPanel} bare job=${dl} />`}
        <${Btn} kind="primary" icon="download" disabled=${dlRunning} onClick=${() => api.post('/api/room/cloudflared').catch(toastError)}>Bağlantı aracını indir</${Btn}>
      </section>
      <${OfflineHelp} p=${p} />
    </div>`;

  return html`<div class="page narrow room">
    ${head}
    ${r.status === 'off' || !mine
      ? html`<section class="panel">
          <p>Odayı açınca arkadaşlarına bir link ve 4 haneli PIN verilir. Link sadece bu uygulama açıkken çalışır.</p>
          ${r.status !== 'off' && !mine && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />Şu an başka bir proje için oda açık. Bunu açarsan o proje için kapanır.</div>`}
          <${Btn} kind="primary" icon="users" disabled=${busy} onClick=${open}>${busy ? 'Açılıyor…' : 'Odayı aç'}</${Btn}>
        </section>`
      : r.status === 'starting'
      ? html`<section class="panel"><div class="row"><span class="spinner"></span> Oda açılıyor, güvenli bağlantı kuruluyor (birkaç saniye)…</div></section>`
      : r.status === 'error'
      ? html`<section class="panel"><div class="alert error"><${Icon} name="alert" size=${16} />Oda açılamadı: ${r.error === 'cloudflared-missing' ? 'bağlantı aracı bulunamadı' : r.error}</div>
          <div class="toolbar"><${Btn} onClick=${open}>Tekrar dene</${Btn}><${Btn} kind="ghost" onClick=${close}>Kapat</${Btn}></div></section>`
      : html`<section class="panel invite">
          <div class="invite-qr"><img src=${'/api/room/qr.svg?u=' + encodeURIComponent(r.url)} alt="Oda linkinin QR kodu" /></div>
          <div class="invite-info">
            <div class="invite-label">Link</div>
            <div class="invite-link">${r.url}</div>
            <div class="invite-label">PIN</div>
            <div class="invite-pin" aria-label=${'PIN ' + r.pin}>${String(r.pin).split('').map((d, i) => html`<span key=${i + d} style=${{ '--i': i }}>${d}</span>`)}</div>
            <div class="toolbar">
              <${Btn} kind="primary" icon="copy" onClick=${async () => { await copyText(invite); toast('Davet mesajı kopyalandı, WhatsApp\'a yapıştır', 'ok'); }}>Davet mesajını kopyala</${Btn}>
              <${Btn} icon="link" onClick=${async () => { await copyText(r.url); toast('Link kopyalandı', 'ok'); }}>Sadece link</${Btn}>
              <${Btn} kind="ghost" icon="x" onClick=${close}>Odayı kapat</${Btn}>
            </div>
          </div>
        </section>
        <div class="room-cols">
          <section class="panel">
            <div class="panel-head"><h3>Odadakiler</h3><span class="muted small">${(r.guests || []).filter((g) => g.online).length} çevrimiçi</span></div>
            ${(r.guests || []).length === 0 ? html`<p class="muted small">Henüz kimse katılmadı. Linki ve PIN'i gönder, katılan burada belirir.</p>` : (r.guests || []).map(
              (g) => html`<div class="guestrow" key=${g.name}><span class=${'dot ' + (g.online ? 'on' : '')}></span><strong>${g.name}</strong>
                <span class="muted small">${g.online ? (g.line ? `${g.line}. satırda` : 'çevrimiçi') : 'ayrıldı'}</span></div>`
            )}
          </section>
          <section class="panel">
            <div class="panel-head"><h3>Olanlar</h3></div>
            <div class="feed">${(r.activity || []).length === 0 ? html`<p class="muted small">Kayıtlar ve katılımlar burada akar.</p>` : (r.activity || []).map(
              (a) => html`<div key=${a.t + a.text}><span class="tc">${timeAgo(a.t)}</span>${a.text}</div>`)}</div>
          </section>
        </div>`}
    <${OfflineHelp} p=${p} />
  </div>`;
}

function OfflineHelp({ p }) {
  return html`<details class="panel">
    <summary><strong>Arkadaşın bağlanamıyor mu?</strong> <span class="muted small">Sesleri WhatsApp'tan da toplayabilirsin</span></summary>
    <ol class="steps-help">
      <li>Senaryo ekranındaki <b>Paylaş</b> ile her arkadaşına kendi repliklerini gönder.</li>
      <li>Her repliği ayrı kaydedip dosya adını satır numarası yapsınlar (ör. <code>3.m4a</code>). Sesli mesaj da olur.</li>
      <li>Gelen dosyaları <b>Kayıt</b> ekranında <b>Toplu ses yükle</b> ile at. Sessizlikler kesilir, her kayıt otomatik olarak doğru yere hizalanır.</li>
    </ol>
    <${Btn} small icon="copy" onClick=${async () => { await copyText(scriptText(p, '')); toast('Tüm senaryo kopyalandı', 'ok'); }}>Tüm senaryoyu kopyala</${Btn}>
  </details>`;
}
