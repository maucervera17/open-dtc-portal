import { shift } from '../dates.js';
import { K } from './store.js';
import { MetaError } from '../meta-client.js';

// A permission failure is decided by the Meta client (`permission`: codes 10 and 200-299, or a "permission" message).
// Code 100 alone is an invalid parameter, and 190 (invalid or expired token) needs a new token: neither is a permission failure.
export const isPermissionError = error => error instanceof MetaError && error.permission === true;

const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const LOOKBACK_DAYS = 3;

// Newest snapshot-job status document among D, D-1, D-2 and D-3 (the job runs once a day, so today's may not exist yet).
export async function readSnapStatus(store, D) {
  const dates = Array.from({ length: LOOKBACK_DAYS + 1 }, (_, i) => shift(D, -i));
  const raw = await store(['MGET', ...dates.map(date => K.snap('status', date))]);
  for (let i = 0; i < dates.length; i++) {
    const doc = parse(raw?.[i]);
    if (doc && typeof doc === 'object') return { date: dates[i], status: doc };
  }
  return null;
}
