import { randomBytes } from 'node:crypto';
import { configuredAllowlist, isAllowed } from './allowlist.js';
import { hmac, K, TTL } from '../dash/store.js';

const RENEW_AFTER_MS = 3600 * 1000;

export const secretOk = env => Buffer.byteLength(String(env.DASH_SESSION_SECRET ?? '')) >= 32;

// Server-side sessions keyed by HMAC(sid). The raw sid only ever lives in the browser cookie.
export function createSessions({ env, store, now }) {
  const h = value => hmac(env.DASH_SESSION_SECRET, value);

  async function create(email) {
    const sid = randomBytes(32).toString('base64url');
    const t = Number(now());
    await store(['SET', K.authSession(h(sid)), JSON.stringify({ email, iat: t, seen: t }), 'EX', TTL.session]);
    const userKey = K.authUser(h(email));
    await store(['SADD', userKey, h(sid)]);
    await store(['EXPIRE', userKey, TTL.user]);
    return { sid, maxAge: TTL.session };
  }

  // Returns null (401) or { email, cookieMaxAge } where cookieMaxAge is set only when the cookie must be re-emitted.
  async function check(sid) {
    if (!secretOk(env)) return null;
    const allow = configuredAllowlist(env);
    if (!allow.valid) return null;
    const key = K.authSession(h(sid));
    const raw = await store(['GET', key]);
    if (!raw) return null;
    let record;
    try { record = JSON.parse(raw); } catch { return null; }
    const t = Number(now());
    if (!Number.isFinite(record?.iat) || t - record.iat >= TTL.sessionCap * 1000) { await store(['DEL', key]); return null; }
    if (!isAllowed(allow, record.email)) return null;
    if (t - record.seen <= RENEW_AFTER_MS) return { email: record.email, cookieMaxAge: null };
    const remaining = Math.floor((record.iat + TTL.sessionCap * 1000 - t) / 1000);
    const ttl = Math.max(1, Math.min(TTL.session, remaining));
    await store(['SET', key, JSON.stringify({ ...record, seen: t }), 'EX', ttl]);
    await store(['EXPIRE', K.authUser(h(record.email)), TTL.user]);
    return { email: record.email, cookieMaxAge: ttl };
  }

  async function destroy(sid, email) {
    await store(['DEL', K.authSession(h(sid))]);
    await store(['SREM', K.authUser(h(email)), h(sid)]);
  }

  return { create, check, destroy };
}
