// The desktop app (Electron) exposes window.dkDesktop through its preload script. In a browser (friends in the room,
// or running from source) it is missing and everything here stays quiet.
import { useEffect, useState } from '../vendor/preact-htm.js';
import { t } from './i18n.js';
import { toast } from './state.js';

export const desktop = window.dkDesktop || null;
if (desktop) document.documentElement.classList.add('desktop');

let update = null;
const subs = new Set();
function setUpdate(u) {
  const was = update && update.state;
  update = u;
  for (const f of subs) f(u);
  if (u && u.state === 'downloaded' && was !== 'downloaded')
    toast(t('DubKanka {v} indirildi.', { v: u.version }), 'ok', 12000, { label: t('Yeniden başlat'), onClick: () => desktop.updates.install() });
}
if (desktop) {
  desktop.updates.getState().then(setUpdate).catch(() => {});
  desktop.updates.onState(setUpdate);
}

/** Live auto-update state ({state, version, progress, error}) or null outside the desktop app. */
export function useUpdate() {
  const [u, setU] = useState(update);
  useEffect(() => {
    subs.add(setU);
    return () => subs.delete(setU);
  }, []);
  return u;
}
