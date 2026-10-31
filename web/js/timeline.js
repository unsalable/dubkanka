// Multi-track timeline: waveforms, draggable / resizable / trimmable clips with snapping, ruler, playhead that follows
// the player.
import { html, useEffect, useLayoutEffect, useRef, useState } from '../vendor/preact-htm.js';
import { Icon } from './components.js';
import { player } from './engine.js';
import { clamp, cls, drawWave, fmtTime } from './util.js';

const TICKS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
const SNAP_PX = 7;
const MIN_LEN = 0.05;

function Ruler({ zoom, duration, scrollLeft, viewW, height, onDown }) {
  const ref = useRef(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(viewW * dpr);
    c.height = Math.floor(height * dpr);
    c.style.width = viewW + 'px';
    c.style.height = height + 'px';
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, viewW, height);
    const step = TICKS.find((s) => s * zoom >= 70) || 120;
    const minor = step / (step >= 1 ? 5 : 2);
    const t0 = scrollLeft / zoom;
    const t1 = (scrollLeft + viewW) / zoom;
    g.fillStyle = 'rgba(242,240,234,0.2)';
    for (let t = Math.floor(t0 / minor) * minor; t <= Math.min(t1, duration); t += minor) {
      const x = Math.round(t * zoom - scrollLeft) + 0.5;
      g.fillRect(x, height - 4, 1, 4);
    }
    g.fillStyle = 'rgba(242,240,234,0.62)';
    g.font = '10px "IBM Plex Mono", "Cascadia Mono", ui-monospace, Consolas, monospace';
    for (let t = Math.floor(t0 / step) * step; t <= Math.min(t1, duration); t += step) {
      const x = Math.round(t * zoom - scrollLeft) + 0.5;
      g.fillRect(x, height - 10, 1, 10);
      g.fillText(fmtTime(t, step < 1 ? 1 : 0), x + 3, 11);
    }
  }, [zoom, duration, scrollLeft, viewW, height]);
  return html`<div class="tl-ruler" style=${{ height: height + 'px' }} onPointerDown=${onDown}>
    <canvas ref=${ref} style=${{ left: scrollLeft + 'px' }}></canvas>
  </div>`;
}

/** clip: {id, start, end, color, label, buffer?, at?, draggable?, resizable?, trim?: {min, max}} — `trim` turns the
 *  edge handles into trims of the audio between min and max (the take's full length). */
function Clip({ clip, zoom, height, selected, onSelect, onMove, onResize, onTrim, snap, duration }) {
  const el = useRef(null);
  const cv = useRef(null);
  const left = clip.start * zoom;
  const w = Math.max(4, (clip.end - clip.start) * zoom);
  useEffect(() => {
    const c = cv.current;
    if (!c || !clip.buffer) return;
    const dpr = window.devicePixelRatio || 1;
    const cw = Math.min(4096, Math.ceil(w));
    c.width = Math.floor(cw * dpr);
    c.height = Math.floor((height - 4) * dpr);
    c.style.width = cw + 'px';
    drawWave(c, clip.buffer, clip.at ?? clip.start, clip.start, clip.start + cw / zoom, clip.waveColor || 'rgba(255,255,255,0.82)', clip.waveGain || 1);
  }, [clip.buffer, zoom, clip.start, clip.end, height]);

  const down = (e, mode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const node = el.current;
    const x0 = e.clientX;
    const s0 = clip.start;
    const e0 = clip.end;
    const len = e0 - s0;
    const lo = clip.trim ? clip.trim.min : 0;
    const hi = clip.trim ? clip.trim.max : duration;
    let moved = false;
    let ns = s0;
    let ne = e0;
    try {
      node.setPointerCapture(e.pointerId);
    } catch {}
    const show = () => {
      node.style.left = ns * zoom + 'px';
      node.style.width = Math.max(4, (ne - ns) * zoom) + 'px';
    };
    const move = (ev) => {
      const dt = (ev.clientX - x0) / zoom;
      if (!moved && Math.abs(ev.clientX - x0) > 3) {
        moved = true;
        node.classList.add('dragging');
      }
      if (!moved) return;
      if (mode === 'move' && clip.draggable) {
        ns = s0 + dt;
        const a = snap(ns, clip.id);
        if (a != null) ns = a;
        else {
          const b = snap(ns + len, clip.id);
          if (b != null) ns = b - len;
        }
        ne = ns + len;
        node.style.transform = `translateX(${(ns - s0) * zoom}px)`;
      } else if (mode === 'l' && (clip.resizable || clip.trim)) {
        ns = clamp(snap(s0 + dt, clip.id) ?? s0 + dt, lo, e0 - MIN_LEN);
        show();
      } else if (mode === 'r' && (clip.resizable || clip.trim)) {
        ne = clamp(snap(e0 + dt, clip.id) ?? e0 + dt, s0 + MIN_LEN, hi);
        show();
      }
    };
    const up = (ev) => {
      node.removeEventListener('pointermove', move);
      try {
        node.releasePointerCapture(ev.pointerId);
      } catch {}
      node.style.transform = '';
      node.classList.remove('dragging');
      snap(null);
      if (!moved) {
        onSelect && onSelect(clip, ev);
        return;
      }
      node.style.left = left + 'px';
      node.style.width = w + 'px';
      if (mode === 'move' && clip.draggable) onMove && onMove(clip, ns - s0);
      else if (clip.trim && mode !== 'move') onTrim && onTrim(clip, mode === 'l' ? 'in' : 'out', mode === 'l' ? ns : ne);
      else if (mode === 'l' && clip.resizable) onResize && onResize(clip, 'start', ns);
      else if (mode === 'r' && clip.resizable) onResize && onResize(clip, 'end', ne);
    };
    node.addEventListener('pointermove', move);
    node.addEventListener('pointerup', up, { once: true });
    node.addEventListener('pointercancel', up, { once: true });
  };

  const edges = clip.resizable || clip.trim;
  return html`<div ref=${el} class=${cls('tl-clip', selected && 'sel', clip.dim && 'dim', clip.draggable && 'drag', clip.trim && 'trim', clip.className)}
    style=${{ left: left + 'px', width: w + 'px', '--c': clip.color || '#7f9cbb' }}
    onPointerDown=${(e) => down(e, 'move')} title=${clip.title || ''}>
    ${clip.buffer && html`<canvas ref=${cv}></canvas>`}
    <span class="tl-clip-label">${clip.label}</span>
    ${edges && html`<i class="tl-h l" title=${clip.trim ? 'Baştan kırp' : 'Başlangıç'} onPointerDown=${(e) => down(e, 'l')}></i>
      <i class="tl-h r" title=${clip.trim ? 'Sondan kırp' : 'Bitiş'} onPointerDown=${(e) => down(e, 'r')}></i>`}
  </div>`;
}

function Lane({ track, zoom, scrollLeft, viewW, selectedId, onSelect, onMove, onResize, onTrim, onSeek, snap, duration }) {
  const cv = useRef(null);
  useEffect(() => {
    const c = cv.current;
    if (!c || !track.buffer) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.floor(viewW * dpr);
    c.height = Math.floor(track.height * dpr);
    c.style.width = viewW + 'px';
    c.style.height = track.height + 'px';
    drawWave(c, track.buffer, track.waveAt || 0, scrollLeft / zoom, (scrollLeft + viewW) / zoom, track.waveColor || 'rgba(180,177,167,0.5)', track.waveGain || 1);
  }, [track.buffer, zoom, scrollLeft, viewW, track.height, track.waveColor]);
  return html`<div class=${cls('tl-lane', track.muted && 'muted')} style=${{ height: track.height + 'px' }}
    onPointerDown=${(e) => (e.target === e.currentTarget || e.target === cv.current) && onSeek(e)}>
    ${track.buffer && html`<canvas class="tl-wave" ref=${cv} style=${{ left: scrollLeft + 'px' }}></canvas>`}
    ${(track.clips || []).map(
      (c) => html`<${Clip} key=${c.id} clip=${c} zoom=${zoom} height=${track.height} selected=${selectedId === c.id} duration=${duration}
        onSelect=${onSelect} onMove=${onMove} onResize=${onResize} onTrim=${onTrim} snap=${snap} />`
    )}
  </div>`;
}

export function Timeline({ duration, tracks, zoom, onZoom, onSeek, selectedId, onSelect, onMove, onResize, onTrim, rulerH = 24, headW = 168 }) {
  const scroller = useRef(null);
  const inner = useRef(null);
  const playhead = useRef(null);
  const snapLine = useRef(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewW, setViewW] = useState(800);
  const raf = useRef(0);

  useLayoutEffect(() => {
    const ro = new ResizeObserver(() => scroller.current && setViewW(scroller.current.clientWidth));
    ro.observe(scroller.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const upd = () => {
      const t = Math.max(0, player.time);
      if (playhead.current) playhead.current.style.transform = `translateX(${t * zoom}px)`;
      const sc = scroller.current;
      if (player.playing && sc) {
        const x = t * zoom;
        if (x > sc.scrollLeft + sc.clientWidth - 30 || x < sc.scrollLeft) sc.scrollLeft = Math.max(0, x - 80);
      }
    };
    upd();
    return player.on(upd);
  }, [zoom]);

  useEffect(() => {
    const sc = scroller.current;
    const wheel = (e) => {
      if (!(e.ctrlKey || e.metaKey) || !onZoom) return;
      e.preventDefault();
      onZoom(clamp(zoom * (e.deltaY < 0 ? 1.25 : 0.8), minZoom(), 600));
    };
    sc.addEventListener('wheel', wheel, { passive: false });
    return () => sc.removeEventListener('wheel', wheel);
  }, [zoom, viewW, duration]);

  // magnetic edges: the playhead and every other clip's start and end pull a dragged edge within a few pixels
  const edges = [];
  for (const t of tracks) for (const c of t.clips || []) edges.push([c.id, c.start], [c.id, c.end]);
  const snap = (t, id) => {
    const line = snapLine.current;
    if (t == null) {
      if (line) line.hidden = true;
      return null;
    }
    let best = null;
    let bestD = SNAP_PX / zoom;
    for (const [cid, x] of [...edges, ['playhead', Math.max(0, player.time)], ['0', 0]]) {
      if (cid === id) continue;
      const d = Math.abs(x - t);
      if (d < bestD) {
        bestD = d;
        best = x;
      }
    }
    if (line) {
      line.hidden = best == null;
      if (best != null) line.style.left = best * zoom + 'px';
    }
    return best;
  };

  const minZoom = () => Math.max(2, (viewW - 20) / Math.max(1, duration));
  const width = Math.max(viewW, duration * zoom + 60);
  const seekAt = (e) => {
    const r = inner.current.getBoundingClientRect();
    onSeek && onSeek(clamp((e.clientX - r.left) / zoom, 0, duration));
  };
  const onScroll = (e) => {
    const x = e.target.scrollLeft;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => setScrollLeft(x));
  };

  return html`<div class="tl" style=${{ '--head-w': headW + 'px' }}>
    <div class="tl-heads">
      <div class="tl-corner" style=${{ height: rulerH + 'px' }}>
        ${onZoom && html`
          <button class="iconbtn" title="Uzaklaş (Ctrl + tekerlek)" onClick=${() => onZoom(clamp(zoom * 0.7, minZoom(), 600))}><${Icon} name="zoomout" size=${15} /></button>
          <button class="iconbtn" title="Tümünü sığdır" onClick=${() => onZoom(minZoom())}><${Icon} name="fit" size=${15} /></button>
          <button class="iconbtn" title="Yakınlaş (Ctrl + tekerlek)" onClick=${() => onZoom(clamp(zoom * 1.4, minZoom(), 600))}><${Icon} name="zoomin" size=${15} /></button>`}
      </div>
      ${tracks.map((t) => html`<div key=${t.id} class=${cls('tl-head', t.muted && 'muted')} style=${{ height: t.height + 'px', '--c': t.color || 'transparent' }}>
        <div class="tl-head-title">${t.label}</div>${t.controls}
      </div>`)}
    </div>
    <div class="tl-scroll" ref=${scroller} onScroll=${onScroll}>
      <div class="tl-inner" ref=${inner} style=${{ width: width + 'px' }}>
        <${Ruler} zoom=${zoom} duration=${duration} scrollLeft=${scrollLeft} viewW=${viewW} height=${rulerH} onDown=${seekAt} />
        ${tracks.map(
          (t) => html`<${Lane} key=${t.id} track=${t} zoom=${zoom} scrollLeft=${scrollLeft} viewW=${viewW} selectedId=${selectedId} duration=${duration}
            onSelect=${onSelect} onMove=${onMove} onResize=${onResize} onTrim=${onTrim} onSeek=${seekAt} snap=${snap} />`
        )}
        <div class="tl-end" style=${{ left: duration * zoom + 'px' }}></div>
        <div class="tl-snap" ref=${snapLine} hidden></div>
        <div class="tl-playhead" ref=${playhead}></div>
      </div>
    </div>
  </div>`;
}

export function fitZoom(width, duration) {
  return clamp((width - 200) / Math.max(1, duration), 4, 400);
}
