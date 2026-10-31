import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api } from '../api.js';
import { Btn, Icon, Lamp } from '../components.js';
import { FeatureOffer } from '../feature-ui.js';
import { toast, toastError, useStore } from '../state.js';
import { cls, copyText, LS, timeAgo } from '../util.js';
import { scriptText } from './script.js';

function Person({ name, me, online, char, line, p }) {
  const c = char && p.characters.find((x) => x.id === char);
  return html`<div class="person">
    <span class=${online ? 'lamp ok' : 'lamp'}></span>
    <strong>${name}</strong>${me && html`<span class="dim small">oda sahibi</span>`}
    <span class="grow"></span>
    ${c ? html`<span class="hl" style=${{ '--c': c.color }}>${c.name}</span>` : html`<span class="dim small">rol seçmedi</span>`}
    <span class="tc dim small person-line">${online ? (line ? `${line}. satır` : 'çevrimiçi') : 'ayrıldı'}</span>
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
  const invite = `🎙 ${p.name} dublajına gel!\n1) Linke tıkla: ${r.url}\n2) Adını yaz, PIN: ${r.pin}\n3) Karakterini seç ve kaydet. Kulaklık takarsan süper olur 🎧`;
  const head = html`<header class="page-head"><div><h1>Oda</h1>
    <p>Arkadaşların başka evlerden, telefondan bile bağlanıp kendi repliklerini kaydeder; kayıtları anında bu projeye düşer.</p></div></header>`;
  const how = html`<details class="panel how"><summary><strong>Nasıl çalışıyor, ücretli mi?</strong></summary>
    <ul class="how-list">
      <li>Oda bu bilgisayarda açılır. Cloudflare'in <b>ücretsiz geçici tüneli</b> (hesap gerekmez) arkadaşlarına güvenli bir https linki verir. Link sadece DubKanka açıkken çalışır.</li>
      <li>Ses ayırma, yazıya dökme ve kayıt işleme bu bilgisayarda yapılır. Hiçbir bulut servisi kullanılmaz, ücret çıkmaz.</li>
      <li>Google Çeviri ücretsizdir. Ayarlar'a anahtar girdiğin dil modelleri (Claude, OpenAI…) kendi hesabından ücretlendirilir; girmezsen hiç kullanılmaz.</li>
      <li>DubKanka'yı kuran her arkadaş kendi odasını açabilir; senin açık olman gerekmez.</li>
    </ul></details>`;

  if (!r.hasCloudflared && r.status !== 'on')
    return html`<div class="page narrow room">
      ${head}
      <section class="panel">
        <p>Oda için bir kerelik küçük bir bağlantı aracı iner: Cloudflare'in ücretsiz <span class="mono">cloudflared</span> aracı. Hesap gerekmez.</p>
        <${FeatureOffer} id="room" text="Arkadaşların linkle telefondan katılır, kendi rolünü kaydeder." />
      </section>
      ${how}<${OfflineHelp} p=${p} />
    </div>`;

  const guests = r.guests || [];
  const hostName = LS.get('booth.name', 'Ben');
  return html`<div class="page narrow room">
    ${head}
    ${r.status === 'off' || !mine
      ? html`<section class="panel">
          <p>Odayı açınca bir link ve 4 haneli bir PIN oluşur. İkisini WhatsApp'tan gönder, gerisini arkadaşın halleder.</p>
          ${r.status !== 'off' && !mine && html`<div class="alert warn small"><${Icon} name="alert" size=${16} />Şu an başka bir proje için oda açık; bunu açarsan o oda kapanır.</div>`}
          <${Btn} kind="primary" icon="users" disabled=${busy} onClick=${open}>${busy ? 'Açılıyor…' : 'Odayı aç'}</${Btn}>
        </section>`
      : r.status === 'starting'
      ? html`<section class="panel"><div class="row"><span class="spinner"></span> Güvenli bağlantı kuruluyor, birkaç saniye…</div></section>`
      : r.status === 'error'
      ? html`<section class="panel"><div class="alert error"><${Icon} name="alert" size=${16} />Oda açılamadı: ${r.error === 'cloudflared-missing' ? 'bağlantı aracı bulunamadı' : r.error}</div>
          <div class="toolbar"><${Btn} onClick=${open}>Tekrar dene</${Btn}><${Btn} kind="ghost" onClick=${close}>Kapat</${Btn}></div></section>`
      : html`<section class=${cls('panel invite', fresh && 'fresh')}>
          <div class="invite-qr"><img src=${'/api/room/qr.svg?u=' + encodeURIComponent(r.url)} alt="Oda linkinin QR kodu" /></div>
          <div class="invite-info">
            <div class="label">Link</div>
            <div class="invite-link mono">${r.url}</div>
            <div class="label">PIN</div>
            <div class="invite-pin" aria-label=${'PIN ' + r.pin}>${String(r.pin).split('').map((d, i) => html`<span key=${i + d} style=${{ '--i': i }}>${d}</span>`)}</div>
            <div class="toolbar">
              <${Btn} kind="primary" icon="copy" onClick=${async () => { await copyText(invite); toast('Davet mesajı kopyalandı; WhatsApp\'a yapıştır', 'ok'); }}>Davet mesajını kopyala</${Btn}>
              <${Btn} icon="link" onClick=${async () => { await copyText(r.url); toast('Link kopyalandı', 'ok'); }}>Sadece link</${Btn}>
              <${Btn} kind="ghost" icon="x" onClick=${close}>Odayı kapat</${Btn}>
            </div>
          </div>
        </section>
        <div class="room-cols">
          <section class="panel">
            <div class="panel-head"><h3>Odadakiler</h3><span class="dim small">${guests.filter((g) => g.online).length} misafir çevrimiçi</span></div>
            <${Person} p=${p} me name=${(r.host && r.host.name) || hostName} online=${r.host ? r.host.online : true} char=${r.host && r.host.char} line=${r.host && r.host.line} />
            ${guests.map((g) => html`<${Person} key=${g.name} p=${p} name=${g.name} online=${g.online} char=${g.char} line=${g.line} />`)}
            ${guests.length === 0 && html`<p class="dim small" style=${{ marginTop: '8px' }}>Henüz kimse katılmadı. Katılan burada, aldığı rolle görünür.</p>`}
          </section>
          <section class="panel">
            <div class="panel-head"><h3>Olanlar</h3></div>
            <div class="feed">${(r.activity || []).length === 0 ? html`<p class="dim small">Katılımlar ve kayıtlar burada akar.</p>` : (r.activity || []).map(
              (a) => html`<div key=${a.t + a.text}><span class="tc dim">${timeAgo(a.t)}</span>${a.text}</div>`)}</div>
          </section>
        </div>`}
    ${how}<${OfflineHelp} p=${p} />
  </div>`;
}

function OfflineHelp({ p }) {
  return html`<details class="panel">
    <summary><strong>Arkadaşın bağlanamıyor mu?</strong> <span class="dim small">Sesleri WhatsApp'tan da toplayabilirsin</span></summary>
    <ol class="how-list">
      <li>Senaryo ekranındaki <b>Paylaş</b> ile her arkadaşına kendi repliklerini gönder.</li>
      <li>Her repliği ayrı kaydetsinler; dosya adı satır numarası olursa (ör. <span class="mono">3.m4a</span>) yeri kendiliğinden bulunur. Sesli mesaj da olur.</li>
      <li>Gelen dosyaları <b>Kayıt</b> ekranında <b>Toplu yükle</b> ile at. Numarasız dosyaların satırını listeden seçersin; sessizlikler kesilir, her kayıt yerine hizalanır.</li>
    </ol>
    <${Btn} small icon="copy" onClick=${async () => { await copyText(scriptText(p, '')); toast('Tüm senaryo kopyalandı', 'ok'); }}>Tüm senaryoyu kopyala</${Btn}>
  </details>`;
}
