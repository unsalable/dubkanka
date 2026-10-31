import { html, useEffect, useRef, useState } from '../../vendor/preact-htm.js';
import { api, fileUrl, P, upload } from '../api.js';
import { Btn, Icon, Lamp, Popover, Progress } from '../components.js';
import { ask, closeProject, go, openProject, toastError, useStore } from '../state.js';
import { cls, fmtTime, timeAgo } from '../util.js';

const VIDEO_EXT = /\.(mp4|mkv|mov|webm|m4v|avi|flv|wmv|ts|mts|3gp)$/i;

function ProjectRow({ p, i, onDelete }) {
  const thumb = useRef(null);
  const vid = useRef(null);
  const more = useRef(null);
  const [hover, setHover] = useState(false);
  const [menu, setMenu] = useState(false);
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
  const state = p.status === 'preparing'
    ? html`<${Lamp} tone="busy">hazırlanıyor</${Lamp}>`
    : ready
    ? html`<${Lamp} tone=${p.lines && p.recorded >= p.lines ? 'ok' : 'accent'}>${p.recorded}/${p.lines} satır kayıtlı</${Lamp}>`
    : html`<${Lamp}>sahne seçilmedi</${Lamp}>`;
  return html`<div class="prow" style=${{ '--i': i }} onClick=${open} onMouseEnter=${() => ready && setHover(true)} onMouseLeave=${() => setHover(false)}
    role="link" tabIndex="0" onKeyDown=${(e) => e.key === 'Enter' && open()}>
    <div class=${cls('prow-thumb', hover && 'playing')} ref=${thumb}>
      ${p.thumb ? html`<img src=${fileUrl(p.id, p.thumb, ver)} alt="" loading="lazy" />` : html`<${Icon} name="film" size=${22} />`}
      ${ready && hover && html`<video ref=${vid} src=${fileUrl(p.id, 'media/preview.mp4', ver)} muted loop playsinline preload="none"
        onPlaying=${(e) => e.target.classList.add('on')}></video>`}
      ${ready && p.lines > 0 && html`<div class="prow-bar"><i style=${{ '--p': p.recorded / p.lines }}></i></div>`}
    </div>
    <div class="prow-main">
      <div class="prow-title" title=${p.name}>${p.name}</div>
      <div class="prow-meta">${state}${ready && html`<span class="dim">${p.characters} karakter</span>`}</div>
    </div>
    <span class="tc prow-dur">${p.duration ? fmtTime(p.duration, 0) : '--:--'}</span>
    <span class="prow-when dim">${timeAgo(p.updated)}</span>
    <button class="iconbtn" ref=${more} title="Diğer işlemler" onClick=${(e) => { e.stopPropagation(); setMenu(!menu); }}><${Icon} name="dots" size=${16} /></button>
    ${menu && html`<${Popover} anchor=${more.current} onClose=${() => setMenu(false)}>
      <button class="popitem" onClick=${(e) => { e.stopPropagation(); setMenu(false); open(); }}><${Icon} name="chevron" size=${14} />Aç</button>
      <button class="popitem danger" onClick=${(e) => { e.stopPropagation(); setMenu(false); onDelete(p); }}><${Icon} name="trash" size=${14} />Projeyi sil</button>
    </${Popover}>`}
  </div>`;
}

export function HomeView() {
  const s = useStore();
  const sys = s.system;
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

  // a new video always opens on the scene picker: the part to dub is chosen before anything is prepared
  const onFile = async (file) => {
    if (!file || up) return;
    setUp({ name: file.name, progress: 0 });
    try {
      const base = file.name.replace(/\.[^.]+$/, '');
      const q = `filename=${encodeURIComponent(file.name)}&name=${encodeURIComponent(base)}`;
      const r = await upload(`/api/projects/upload?${q}`, file, (f) => setUp({ name: file.name, progress: f }));
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
    const ok = await ask({ title: 'Proje silinsin mi?', text: `“${p.name}” ve içindeki bütün kayıtlar silinir. Bu geri alınamaz.`, ok: 'Projeyi sil', danger: true });
    if (!ok) return;
    await api.del(P(p.id)).catch(toastError);
    load();
  };

  return html`<div class="page home">
    ${sys && !sys.ffmpeg && html`<div class="alert error"><${Icon} name="alert" /> ffmpeg bulunamadı. Kurulumu onarıp uygulamayı yeniden aç.</div>`}
    <section class="intake">
      <div class=${cls('dropwell', veil && 'drag', up && 'busy')} onClick=${() => !up && input.current.click()} role="button" tabIndex="0"
        onKeyDown=${(e) => (e.key === 'Enter' || e.key === ' ') && !up && input.current.click()}>
        <input ref=${input} type="file" hidden accept="video/*,.mkv,.avi,.mov,.webm,.mp4,.m4v,.flv,.wmv,.ts,.mts,.3gp"
          onChange=${(e) => { onFile(e.target.files[0]); e.target.value = ''; }} />
        ${up
          ? html`<div class="dw-up">
              <div class="row nowrap"><strong class="grow ellipsis">${up.name}</strong><span class="tc muted">%${Math.round(up.progress * 100)}</span></div>
              <${Progress} value=${up.progress} live />
            </div>`
          : html`<span class="dw-ico"><${Icon} name="upload" size=${22} /></span>
              <strong class="dw-title">Videoyu buraya bırak</strong>
              <span class="muted">ya da tıklayıp seç</span>`}
      </div>
      <form class="linkbar" onSubmit=${onUrl}>
        <${Icon} name="link" size=${16} />
        <input class="linkbar-input" aria-label="Video bağlantısı" placeholder="ya da bir bağlantı yapıştır: YouTube, X, Instagram…" value=${url} onInput=${(e) => setUrl(e.target.value)} />
        <${Btn} type="submit" small kind=${url.trim() ? 'primary' : ''} disabled=${!url.trim()}>Getir</${Btn}>
      </form>
    </section>

    <section class="plist-wrap">
      <div class="plist-head"><h2>Projeler</h2>${projects && projects.length > 0 && html`<span class="count tc">${projects.length}</span>`}</div>
      ${projects === null
        ? html`<div class="plist">${[0, 1, 2].map((i) => html`<div key=${i} class="prow skelrow"><div class="skel prow-thumb"></div><div class="skel" style=${{ height: '14px', width: '40%' }}></div></div>`)}</div>`
        : projects.length === 0
        ? html`<div class="plist plist-empty"><p class="muted">Henüz proje yok.</p></div>`
        : html`<div class="plist">${projects.map((p, i) => html`<${ProjectRow} key=${p.id} p=${p} i=${i} onDelete=${del} />`)}</div>`}
    </section>
    ${veil && html`<div class="dropveil"><div class="dropveil-card"><${Icon} name="upload" size=${28} />Bırak</div></div>`}
  </div>`;
}
