import { useLayoutEffect, useReducer } from '../vendor/preact-htm.js';
import { api, P } from './api.js';
import { LS, sleep } from './util.js';

export const store = {
  role: null, // host | guest | anon
  guestName: null,
  system: null,
  route: parseRoute(),
  projectId: null,
  project: null,
  jobs: [],
  room: null,
  toasts: [],
  online: true,
};

const subs = new Set();
let version = 0;
export function setState(patch) {
  Object.assign(store, typeof patch === 'function' ? patch(store) : patch);
  version++;
  for (const f of [...subs]) f();
}

/** Subscribe in a layout effect (runs at commit, not on the next animation frame) and catch up on
 *  any update that happened between render and subscription. */
export function useStore() {
  const [, force] = useReducer((x) => x + 1, 0);
  const seen = version;
  useLayoutEffect(() => {
    subs.add(force);
    if (version !== seen) force();
    return () => subs.delete(force);
  }, []);
  return store;
}

export function parseRoute() {
  return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
}

// Motion level (Ayarlar → Genel), applied as <html data-motion>: CSS scales durations and distances from it.
export const MOTION_LEVELS = [['full', 'Tam'], ['reduced', 'Azaltılmış'], ['off', 'Kapalı']];
export const motion = () => document.documentElement.dataset.motion || 'full';
export function setMotion(level) {
  LS.set('motion', level);
  document.documentElement.dataset.motion = level;
}
document.documentElement.dataset.motion = LS.get('motion', matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full');

// Where a route sits in the workflow, so page changes slide forwards or backwards.
const PLACE = { prepare: 1, script: 2, record: 3, mix: 4, export: 5, room: 6 };
const place = (r) => (r[0] === 'p' ? PLACE[r[2]] || 1 : r[0] === 'settings' ? 9 : 0);

// Settings and the room are places you visit and leave: their buttons take you back to where you were.
let before = { settings: [], room: {} };
function remember(from, to) {
  if (from[0] !== 'settings' && to[0] === 'settings') before.settings = from;
  if (from[0] === 'p' && from[2] !== 'room' && to[0] === 'p' && to[2] === 'room') before.room[from[1]] = from;
}
/** Hash of the page to return to when leaving settings / a project's room. */
export const backFromSettings = () => '#/' + before.settings.join('/');
export const backFromRoom = (pid) => '#/' + (before.room[pid] || ['p', pid]).join('/');
const calm = () => document.hidden || !document.startViewTransition || motion() === 'off';

/** Apply a route change inside a view transition: the page slides, the video picture glides to its new spot. */
export function transition(update, dir = 1) {
  if (calm()) return update();
  document.documentElement.style.setProperty('--vt-dir', dir);
  let done = false;
  const run = () => {
    if (!done) {
      done = true;
      update();
    }
  };
  // a window that is not painting (minimised, throttled) never starts the transition: never wait on it
  const guard = setTimeout(() => {
    run();
    vt.skipTransition();
  }, 250);
  // resolve after a macrotask: Preact has committed the new page by then
  const vt = document.startViewTransition(() => {
    clearTimeout(guard);
    run();
    return new Promise((r) => setTimeout(r, 0));
  });
  for (const pr of [vt.ready, vt.finished, vt.updateCallbackDone]) pr.catch(() => {});
  return vt;
}

window.addEventListener('hashchange', () => {
  const route = parseRoute();
  remember(store.route, route);
  transition(() => setState({ route }), place(route) >= place(store.route) ? 1 : -1);
});
export const go = (path) => (location.hash = '#/' + path);

let toastId = 0;
export function dismissToast(id) {
  if (!store.toasts.some((t) => t.id === id && !t.leaving)) return;
  setState((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, leaving: true } : t)) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 200);
}
export function toast(text, type = 'info', ms = 4200, action = null) {
  const id = ++toastId;
  setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, type, ms, action }] }));
  setTimeout(() => dismissToast(id), ms);
}
export const toastError = (e) => toast(e && e.message ? e.message : String(e), 'error', 6000);

/** Apply a local change to the current project immediately (the server copy follows via watch). */
export function patchLocal(fn) {
  if (!store.project) return;
  const p = structuredClone(store.project);
  fn(p);
  setState({ project: p });
}

// ---- live updates (long-poll) ---------------------------------------------
let watchCtl = null;
export function startWatch() {
  if (watchCtl) watchCtl.abort();
  const ctl = (watchCtl = new AbortController());
  (async () => {
    let v = -1;
    while (!ctl.signal.aborted) {
      const pid = store.projectId || '';
      try {
        const r = await api.get(`/api/watch?project=${pid}&v=${v}`, { signal: ctl.signal });
        v = r.v;
        const patch = { jobs: r.jobs || [], room: r.room || null, online: true };
        featureJobsSettled(store.jobs, patch.jobs);
        if (pid && r.rev != null && r.rev >= 0 && (!store.project || store.project.id !== pid || store.project.rev !== r.rev)) {
          patch.project = await api.get(P(pid), { signal: ctl.signal });
        }
        if (pid !== (store.projectId || '')) continue;
        setState(patch);
      } catch (e) {
        if (ctl.signal.aborted) return;
        if (e.status === 403 && store.role !== 'host') {
          // room closed or not joined yet: back to the join screen, polling restarts after joining
          setState({ role: 'anon', guestName: null, project: null, projectId: null });
          return;
        }
        setState({ online: e.status !== 0 ? store.online : false });
        await sleep(1500);
      }
    }
  })();
}

export async function openProject(pid) {
  if (store.projectId === pid && store.project && store.project.id === pid) return;
  setState({ projectId: pid, project: null, jobs: [] });
  startWatch();
  try {
    const p = await api.get(P(pid));
    if (store.projectId === pid) setState({ project: p });
  } catch (e) {
    toastError(e);
    if (e.status === 404 && store.role === 'host') go('');
  }
}

export function closeProject() {
  if (!store.projectId) return;
  setState({ projectId: null, project: null, jobs: [] });
  startWatch();
}

// ---- features (Ayarlar → Özellikler) -------------------------------------------
const live = (j) => j.status === 'running' || j.status === 'queued';

export async function refreshFeatures() {
  try {
    const r = await api.get('/api/features');
    setState((s) => ({ system: s.system && { ...s.system, features: r.features } }));
  } catch {}
}

/** Add features in the background; the top bar and Ayarlar → Özellikler show the progress. */
export async function installFeatures(ids) {
  try {
    const r = await api.post('/api/features/install', { ids });
    setState((s) => ({ system: s.system && { ...s.system, features: r.features } }));
  } catch (e) {
    toastError(e);
  }
}

/** A feature as it is right now: its last known state, with a running install's progress on top. */
export function featureOf(id) {
  const f = ((store.system && store.system.features) || []).find((x) => x.id === id);
  if (!f) return null;
  const j = store.jobs.find((x) => x.meta && x.meta.feature === id && live(x));
  if (!j) return f;
  return { ...f, job: j, state: j.kind === 'feature-remove' ? 'removing' : j.status === 'running' ? 'installing' : 'queued' };
}
export const featureReady = (id) => {
  const f = featureOf(id);
  return !!f && (f.state === 'ready' || f.state === 'partial');
};

// a feature job just ended: refresh what is installed and say so
function featureJobsSettled(prev, next) {
  for (const j of next) {
    if (!j.meta || !j.meta.feature || live(j)) continue;
    const was = prev.find((x) => x.id === j.id);
    if (!was || !live(was)) continue;
    refreshFeatures();
    if (j.status === 'done') toast(j.message || 'Hazır', 'ok');
    else if (j.status === 'error') toast(j.error || 'Eklenemedi', 'error', 8000);
  }
}

/** Latest job of a kind for the open project (running ones first). */
export function jobOf(kind) {
  const js = store.jobs.filter((j) => j.kind === kind);
  return js.find((j) => j.status === 'running' || j.status === 'queued') || js.sort((a, b) => b.created - a.created)[0] || null;
}

export async function runJob(promise) {
  try {
    return await promise;
  } catch (e) {
    toastError(e);
    return null;
  }
}
