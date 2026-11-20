// Ad preview safety. Meta returns HTML; we take ONE thing from it, the iframe src, and only if it points at a
// Facebook preview endpoint. The returned markup itself is never stored, forwarded or rendered.
import { checkPreviewSrc } from '../../public/app/preview-rule.js';

const MAX_BODY = 20000;
const NAMED = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body.toLowerCase()] ?? whole;
  });
}

// Returns the normalized URL string, or null. The rule itself lives in one shared module (also used by the browser).
export function validatePreviewSrc(src) {
  return checkPreviewSrc(src).href ?? null;
}

const SAFE_HOST = /^[a-z0-9.-]{1,100}$/;
const SAFE_PATH = /^[\w/.-]{1,100}$/;

// { src } for a valid body, otherwise { code } plus a sanitized host and path (never the query string: it is signed).
export function inspectPreviewBody(body) {
  if (typeof body !== 'string' || body.length === 0) return { code: 'no_body' };
  if (body.length > MAX_BODY) return { code: 'body_too_large' };
  const match = /<iframe\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(body);
  const raw = match?.[1] ?? match?.[2];
  if (raw === undefined) return { code: 'no_iframe' };
  const result = checkPreviewSrc(decodeEntities(raw));
  if (result.href) return { src: result.href };
  const out = { code: result.code };
  if (typeof result.host === 'string' && SAFE_HOST.test(result.host)) out.host = result.host;
  if (typeof result.path === 'string' && SAFE_PATH.test(result.path)) out.path = result.path;
  return out;
}

export function extractPreviewSrc(body) {
  return inspectPreviewBody(body).src ?? null;
}
