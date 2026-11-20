// The single rule for an ad preview iframe src. Imported by the server (lib/dash/preview.js) and by the browser
// (views/creativos.js), so both sides accept and reject exactly the same URLs. No imports: it must load in both places.
export const PREVIEW_HOSTS = Object.freeze(['www.facebook.com', 'business.facebook.com', 'm.facebook.com', 'facebook.com']);
export const PREVIEW_PATH_PREFIX = '/ads/api/preview_iframe';
export const MAX_SRC = 2048;

// Returns { href } when every rule holds, or { code } with a short reason. `host` and `path` (no query, no signed
// parameters) are included only when the URL parsed, so a caller can log a safe diagnostic.
export function checkPreviewSrc(src) {
  if (typeof src !== 'string' || src.length === 0) return { code: 'type' };
  if (src.length > MAX_SRC) return { code: 'length' };
  let url;
  try { url = new URL(src.startsWith('//') ? `https:${src}` : src); } catch { return { code: 'parse' }; }
  const where = { host: url.hostname, path: url.pathname };
  if (url.protocol !== 'https:') return { code: 'protocol', ...where };
  if (!PREVIEW_HOSTS.includes(url.hostname)) return { code: 'host', ...where };
  if (url.port !== '') return { code: 'port', ...where };
  if (url.username !== '' || url.password !== '') return { code: 'userinfo', ...where };
  if (!url.pathname.startsWith(PREVIEW_PATH_PREFIX)) return { code: 'path', ...where };
  return { href: url.href };
}

export const safePreviewSrc = src => checkPreviewSrc(src).href ?? null;
