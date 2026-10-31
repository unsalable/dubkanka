import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P, upload } from '../api.js';
import { Btn, Icon, Progress } from '../components.js';
import { closeProject, go, openProject, toastError, useStore } from '../state.js';
import { cls, fmtTime, timeAgo } from '../util.js';

const VIDEO_EXT = /\.(mp4|mkv|mov|webm|m4v|avi|flv|wmv|ts)$/i;
const STEPS = [
  ['film', 'Sahneyi seç', 'Videoyu at, dublajlayacağın kısmı kes.'],
  ['sparkle', 'Hazırlansın', 'Konuşmalar fondan ayrılır, yazıya dökülür, kişilere bölünür ve çevrilir.'],
  ['mic', 'Seslendirin', 'Herkes kendi repliğini bip sesleriyle tam zamanında kaydeder, linkle telefondan bile.'],
  ['share', 'Paylaş', 'Altyazılı 9:16 TikTok videosu tek tıkla çıkar.'],
];

function ProjectCard({ p, i, onDelete }) {
  const thumb = useRef(null);
  const vid = useRef(null);
  const [hover, setHover] = useState(false);
  const ready = p.status === 'ready';
  const ver = Math.floor(p.updated);
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (hover) v.play().catch(() => {});
    else {
      v.pause();
      v.currentTime = 0;
    }
  }, [hover]);
  const open = async () => {
    // the thumbnail becomes the project's video picture during the page transition
    if (thumb.current) thumb.current.style.viewTransitionName = 'viewer';
    await openProject(p.id);
    go(`p/${p.id}`);
  };
  return html`<div class="pcard" style=${{ '--i': i }} onClick=${open} onMouseEnter=${() => ready && setHover(true)} onMouseLeave=${() => setHover(false)}
    role="link" tabIndex="0" onKeyDown=${(e) => e.key === 'Enter' && open()}>
    <div class=${cls('pcard-thumb', hover && 'playing')} ref=${thumb}>
      ${p.thumb ? html`<img src=${fileUrl(p.id, p.thumb, ver)} alt="" loading="lazy" />` : html`<${Icon} name="film" size=${28} />`}
      ${ready && hover && html`<video ref=${vid} src=${fileUrl(p.id, 'media/preview.mp4', ver)} muted loop playsinline preload="none"
        onPlaying=${(e) => e.target.classList.add('on')}></video>`}
      ${p.status === 'preparing' && html`<span class="pcard-state"><span class="spinner"></span>Hazırlanıyor</span>`}
      ${p.status !== 'ready' && p.status !== 'preparing' && html`<span class="pcard-state">Sahne seçilmedi</span>`}
      ${p.duration && html`<span class="pcard-dur">${fmtTime(p.duration, 0)}</span>`}
      ${ready && p.lines > 0 && html`<div class="pcard-bar"><i style=${{ '--p': p.recorded / p.lines }}></i></div>`}
    </div>
    <div class="pcard-meta">
      <div class="grow">
        <div class="pcard-title" title=${p.name}>${p.name}</div>
        <div class="pcard-sub">${ready ? `${p.recorded}/${p.lines} satır kayıtlı · ${p.characters} karakter` : 'Hazır değil'} · ${timeAgo(p.updated)}</div>
      </div>
      <button class="iconbtn" title="Projeyi sil" onClick=${(e) => { e.stopPropagation(); onDelete(p); }}><${Icon} name="trash" size=${16} /></button>
    </div>
  </div>`;
}

export function HomeView() {
  const s = useStore();
  const [projects, setProjects] = useState(null);
  const [up, setUp] = useState(null);
  const [url, setUrl] = useState('');
  const [veil, setVeil] = useState(false);
  const input = useRef(null);
  const load = () => api.get('/api/projects').then(setProjects).catch(toastError);
  useEffect(() => {
    closeProject();
    load();
  }, []);

  const onFile = async (file) => {
    if (!file || up) return;
    setUp({ name: file.name, progress: 0 });
    try {
      const base = file.name.replace(/\.[^.]+$/, '');
      const r = await upload(`/api/projects/upload?filename=${encodeURIComponent(file.name)}&name=${encodeURIComponent(base)}`, file, (f) =>
        setUp({ name: file.name, progress: f })
      );
      go(`p/${r.project.id}/prepare`);
    } catch (e) {
      toastError(e);
      setUp(null);
    }
  };

  // a video dragged anywhere over the window opens a drop veil
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
    const enter = (e) => hasFiles(e) && (depth++, setVeil(true));
    const leave = (e) => hasFiles(e) && --depth <= 0 && ((depth = 0), setVeil(false));
    const over = (e) => hasFiles(e) && e.preventDefault();
    const drop = (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setVeil(false);
      const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('video/') || VIDEO_EXT.test(x.name)) || e.dataTransfer.files[0];
      onFile(f);
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, [up]);

  const onUrl = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    try {
      const r = await api.post('/api/projects/url', { url: url.trim() });
      go(`p/${r.project.id}/prepare`);
    } catch (err) {
      toastError(err);
    }
  };
  const del = async (p) => {
    if (!confirm(`"${p.name}" projesi ve tüm kayıtları silinsin mi?`)) return;
    await api.del(P(p.id)).catch(toastError);
    load();
  };

  const sys = s.system;
  return html`<div class="page home">
    ${sys && !sys.ffmpeg && html`<div class="alert error"><${Icon} name="alert" /> ffmpeg bulunamadı. Kurulum.bat dosyasını çalıştırıp uygulamayı yeniden aç.</div>`}
    <header class="home-head">
      <div>
        <h1>Yeni dublaj</h1>
        <p>Bir dizi ya da film sahnesi at. Konuşmalar fondan ayrılır, satırlar yazılır ve çevrilir, sonra arkadaşlarınla seslendirirsiniz.</p>
      </div>
    </header>
    <section class="newproj">
      <div class=${cls('dropzone', veil && 'drag')} onClick=${() => !up && input.current.click()} role="button" tabIndex="0"
        onKeyDown=${(e) => (e.key === 'Enter' || e.key === ' ') && !up && input.current.click()}>
        <input ref=${input} type="file" hidden accept="video/*,.mkv,.avi,.mov,.webm,.mp4,.m4v,.flv,.wmv,.ts"
          onChange=${(e) => onFile(e.target.files[0])} />
        ${up
          ? html`<div class="dz-up">
              <div class="row"><strong class="grow" style=${{ textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>${up.name}</strong>
                <span class="tc muted">%${Math.round(up.progress * 100)}</span></div>
              <${Progress} value=${up.progress} live />
              <span class="muted small" style=${{ textAlign: 'left' }}>Yükleniyor, bitince sahne seçimine geçeceksin.</span></div>`
          : html`<span class="dz-plus"><${Icon} name="plus" size=${22} /></span>
              <strong>Video seç ya da buraya sürükle</strong><span class="muted small">mp4, mkv, mov, webm…</span>`}
      </div>
      <form class="urlbox" onSubmit=${onUrl}>
        <h3><${Icon} name="link" size=${16} />Bağlantıdan al</h3>
        <p class="small">YouTube ve benzeri sitelerden videoyu doğrudan indirir.</p>
        <div class="urlform">
          <input class="input" placeholder="https://…" value=${url} onInput=${(e) => setUrl(e.target.value)} aria-label="Video bağlantısı" />
          <${Btn} type="submit" kind="primary" disabled=${!url.trim()}>Getir</${Btn}>
        </div>
      </form>
    </section>

    <section>
      <div class="section-head"><h2>Projeler</h2>${projects && projects.length > 0 && html`<span class="count">${projects.length}</span>`}</div>
      ${projects === null
        ? html`<div class="cards">${[0, 1, 2].map((i) => html`<div key=${i}><div class="skel" style=${{ aspectRatio: '16/9' }}></div><div class="skel" style=${{ height: '14px', width: '60%', marginTop: '10px' }}></div></div>`)}</div>`
        : projects.length === 0
        ? html`<ol class="howto">${STEPS.map(([icon, t, d], i) => html`<li key=${t} style=${{ '--i': i }}><strong><${Icon} name=${icon} size=${16} />${i + 1}. ${t}</strong><p>${d}</p></li>`)}</ol>`
        : html`<div class="cards">${projects.map((p, i) => html`<${ProjectCard} key=${p.id} p=${p} i=${i} onDelete=${del} />`)}</div>`}
    </section>
    ${sys && html`<footer class="sysinfo">
      <${Icon} name="info" size=${14} />
      ${sys.gpu && sys.gpu.available ? `Ekran kartı: ${sys.gpu.name} (${sys.gpu.memoryGB} GB), yapay zeka işlemleri hızlı çalışır.` : 'Ekran kartı bulunamadı, işlemler işlemcide (daha yavaş) yapılır.'}
      <span>·</span> Videolar: <span class="mono">${sys.exportsDir}</span>
    </footer>`}
    ${veil && html`<div class="dropveil"><div class="dropveil-card"><${Icon} name="upload" size=${30} />Videoyu bırak, sahneyi açalım</div></div>`}
  </div>`;
}
