import { shift } from '../dates.js';
import { snapshotSales, datesBetween } from './snapshot.js';
import { backfillInstagram } from './social.js';
import { logEvent } from './log.js';

export const CHUNK_DAYS = 31;
const MAX_LOOKBACK = 400;
const IG_RETENTION = 90;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = v => {
  if (typeof v !== 'string' || !DATE.test(v)) return false;
  try { return shift(v, 0) === v; } catch { return false; }
};

// Returns { from, to } or null. Only closed days (up to D-1) within the 400 day snapshot horizon are accepted.
export function parseBackfill(input, D) {
  let body = input;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { return null; } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { from, to } = body;
  if (!validDate(from) || !validDate(to) || from > to || to > shift(D, -1) || from < shift(D, -MAX_LOOKBACK)) return null;
  return { from, to };
}

// One chunk of at most 31 days. Sales failures abort the chunk (nothing partial is written); IG is best effort.
export async function runBackfill({ from, to, D, env, store, fetch, now, client, accountId, version, budget }) {
  const end = shift(from, CHUNK_DAYS - 1) < to ? shift(from, CHUNK_DAYS - 1) : to;
  const sales = await snapshotSales({ client, accountId, store, now, D, version, from, to: end });
  const igDates = datesBetween(from, end).filter(d => d >= shift(D, -IG_RETENTION));
  let ig = 0;
  if (igDates.length) {
    try { ig = (await backfillInstagram({ env, store, fetch, now, D, dates: igDates, budget })).written; }
    catch (error) { logEvent('dash_backfill', { stage: 'ig', code: error?.code ?? 'failed' }); }
  }
  return { written: { sales: sales.written, ig }, next_from: end < to ? shift(end, 1) : null };
}
