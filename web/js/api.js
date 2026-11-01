import { getLang, t } from './i18n.js';

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

function detailText(d) {
  if (!d) return null;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join(', ');
  return JSON.stringify(d);
}

async function req(method, url, body, opts = {}) {
  // the server answers in the interface's language (its errors, job messages, feature names)
  const init = { method, headers: { 'X-DK-Lang': getLang() }, credentials: 'same-origin', signal: opts.signal };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) init.body = body;
    else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
  }
  let r;
  try {
    r = await fetch(url, init);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new ApiError(t('Sunucuya bağlanılamadı. Uygulama penceresi açık mı?'), 0);
  }
  if (!r.ok) {
    let msg = r.statusText || t('Hata');
    try {
      msg = detailText((await r.json()).detail) || msg;
    } catch {}
    throw new ApiError(msg, r.status);
  }
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r;
}

export const api = {
  get: (u, o) => req('GET', u, undefined, o),
  post: (u, b) => req('POST', u, b === undefined ? {} : b),
  patch: (u, b) => req('PATCH', u, b),
  del: (u) => req('DELETE', u),
};

/** POST a raw file body with upload progress (0..1). Resolves with parsed JSON. */
export function upload(url, blob, onProgress) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('POST', url);
    x.withCredentials = true;
    x.setRequestHeader('X-DK-Lang', getLang());
    x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
    x.onload = () => {
      let data = null;
      try {
        data = JSON.parse(x.responseText);
      } catch {}
      if (x.status >= 200 && x.status < 300) resolve(data);
      else reject(new ApiError(detailText(data && data.detail) || t('Yükleme başarısız ({status})', { status: x.status }), x.status));
    };
    x.onerror = () => reject(new ApiError(t('Yükleme sırasında bağlantı koptu.'), 0));
    x.send(blob);
  });
}

export const fileUrl = (pid, path, v) => `/api/projects/${pid}/file/${path}${v ? '?v=' + v : ''}`;
export const P = (pid, rest = '') => `/api/projects/${pid}${rest}`;
