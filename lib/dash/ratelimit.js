import { hmac, K, TTL } from './store.js';

// Atomic counter: the TTL is set in the same script as the first INCR, so a key can never lack an expiry.
const SCRIPT = "local c=redis.call('INCR',KEYS[1]); if c==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return c";

export async function hit(store, key, ttlSeconds) {
  return Number(await store(['EVAL', SCRIPT, 1, key, ttlSeconds]));
}

export const REFRESH_PER_HOUR = 10;

// One refresh per minute (NX flag holding its start time) and ten per hour (Lua counter), keyed by HMAC(email).
export async function refreshGate({ store, secret, email, now }) {
  const id = hmac(secret, email);
  const t = Number(now());
  const minuteKey = K.refreshMinute(id);
  const first = await store(['SET', minuteKey, String(t), 'NX', 'EX', TTL.refreshMinute]);
  if (first !== 'OK') {
    const started = Number(await store(['GET', minuteKey]));
    const elapsed = Number.isFinite(started) ? Math.floor((t - started) / 1000) : 0;
    return { ok: false, retry_after: Math.min(TTL.refreshMinute, Math.max(1, TTL.refreshMinute - elapsed)) };
  }
  if (await hit(store, K.refreshHour(id), TTL.rateHour) > REFRESH_PER_HOUR) return { ok: false, retry_after: TTL.rateHour };
  return { ok: true };
}

export const ASK_PER_HOUR = 20;
export const ASK_PER_DAY = 100;

// Ask-the-agent budget per user (keyed HMAC of the email): 20 an hour and 100 a day, each an atomic Lua counter.
// A refusal carries no detail; the day counter is only touched when the hour one passed.
export async function askGate({ store, secret, email }) {
  const id = hmac(secret, email);
  if (await hit(store, K.askHour(id), TTL.rateHour) > ASK_PER_HOUR) return { ok: false };
  if (await hit(store, K.askDay(id), TTL.rateDay) > ASK_PER_DAY) return { ok: false };
  return { ok: true };
}

// A call that failed on the provider's side must not cost the user a question: give both counters back.
export async function askRefund({ store, secret, email }) {
  const id = hmac(secret, email);
  for (const key of [K.askHour(id), K.askDay(id)]) {
    if (Number(await store(['DECR', key])) < 0) await store(['DEL', key]);
  }
}

export const MEMORY_WRITES_PER_HOUR = 30;

// Memory writes (add, edit, delete, approve, discard) per user: 30 an hour, keyed by HMAC(email). Reading is never limited.
export async function memoryWriteGate({ store, secret, email }) {
  return { ok: await hit(store, K.memoryWrite(hmac(secret, email)), TTL.rateHour) <= MEMORY_WRITES_PER_HOUR };
}
