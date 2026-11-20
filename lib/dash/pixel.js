import { MetaError, createMetaClient } from '../meta-client.js';
import { insightBounds } from '../instagram.js';
import { localDate, shift } from '../dates.js';
import { K, TTL } from './store.js';
import { writeSnap, datesBetween } from './snapshot.js';
import { funnelOf, envelope } from './metrics.js';
import { provisionalFrom, isAdjustable } from './range.js';
import { readSnapStatus } from './status.js';
import { cleanName } from '../text.js';

// Funnel events only; the API name on the left, stored as-is.
export const PIXEL_EVENTS = Object.freeze(['ViewContent', 'AddToCart', 'InitiateCheckout', 'Purchase']);
const SOURCES = Object.freeze({ web: 'WEB_ONLY', server: 'SERVER_ONLY' });

// Pixel /stats is on unless PIXEL_STATS_ENABLED is exactly 'false' (a pixel shared from another business denies it, so the
// dashboard runs on ad-attributed events plus EMQ by design).
export const pixelStatsEnabled = env => String(env?.PIXEL_STATS_ENABLED ?? '').trim().toLowerCase() !== 'false';

// Marks which Meta call failed (a fixed label, never the URL) so the cron log can name it.
async function tagStep(step, fn) {
  try { return await fn(); } catch (error) { if (error && typeof error === 'object' && !error.step) error.step = step; throw error; }
}

// META_PIXEL_ID wins. Otherwise the first available pixel of the ad account, cached for a day.
export async function resolvePixelId({ env, client, store, accountId }) {
  if (env.META_PIXEL_ID) {
    if (!/^\d+$/.test(String(env.META_PIXEL_ID))) throw new MetaError('Pixel id is invalid', { code: 'config' });
    return String(env.META_PIXEL_ID);
  }
  const cached = await store(['GET', K.pixelId(accountId)]);
  if (cached && /^\d+$/.test(cached)) return cached;
  const pixels = await tagStep('adspixels', () => client.list(`act_${accountId}/adspixels`, { fields: 'id,is_unavailable' }));
  const found = pixels.find(p => p?.is_unavailable !== true && /^\d+$/.test(String(p?.id)));
  if (!found) throw new MetaError('No pixel found', { code: 'no_pixel' });
  await store(['SET', K.pixelId(accountId), String(found.id), 'EX', TTL.pixelId]);
  return String(found.id);
}

// Per-day counts for one source. A bucket without a parseable start_time is ignored.
function countsByDay(body) {
  if (!Array.isArray(body?.data)) throw new MetaError('Invalid pixel stats', { code: 'shape' });
  const days = new Map();
  for (const bucket of body.data) {
    const t = Date.parse(bucket?.start_time);
    if (!Number.isFinite(t)) continue;
    const date = localDate(new Date(t));
    const day = days.get(date) || {};
    for (const entry of Array.isArray(bucket.data) ? bucket.data : []) {
      const count = Number(entry?.count);
      if (PIXEL_EVENTS.includes(entry?.value) && Number.isFinite(count)) day[entry.value] = (day[entry.value] || 0) + count;
    }
    days.set(date, day);
  }
  return days;
}

// Both sources are fetched before anything is written, so a failure never leaves a partial pixel day.
export async function snapshotPixel({ client, env, store, now, D, accountId, from, to }) {
  const pixelId = await resolvePixelId({ env, client, store, accountId });
  const { since, until } = insightBounds(from, to);
  const stats = (step, source) => tagStep(step, () => client.get(`${pixelId}/stats`, { aggregation: 'event', event_source: source, start_time: since, end_time: until }));
  const web = countsByDay(await stats('stats_web', SOURCES.web));
  const server = countsByDay(await stats('stats_server', SOURCES.server));
  const fetched_at = new Date(Number(now())).toISOString();
  const dates = [...new Set([...web.keys(), ...server.keys()])].filter(d => d >= from && d <= to).sort();
  for (const date of dates) {
    // A source with no bucket at all for the day is unknown (null, shown as N/D); inside a bucket, a missing event is 0.
    const count = (source, name) => (source.has(date) ? source.get(date)[name] ?? 0 : null);
    const events = Object.fromEntries(PIXEL_EVENTS.map(name => [name, { web: count(web, name), server: count(server, name) }]));
    await writeSnap({ store, module: 'pixel', date, ref: D, value: { events, fetched_at } });
  }
  return { written: dates.length, pixelId };
}

// ---- EMQ (Dataset Quality). Only ever requested with the system-user token; field names are unverified, so
// anything unexpected degrades to "unavailable" rather than a made-up number. ----

// Client bound to the system-user token, or null when it is not configured (then no Dataset Quality call can happen).
export function createEmqClient({ env, version, accountId, fetch, now, sleep, store, deadlineMs }) {
  const token = env.META_SYSTEM_USER_TOKEN;
  if (!token) return null;
  return createMetaClient({ token, version, accountId, fetch, now, sleep, store, deadlineMs, enabled: true });
}

// Pixel reads (id discovery, /stats, identity) use the system-user token when it is configured: the regular token is
// often refused with "(#100) Permission Denied" on pixel data. Without it, the regular client is used unchanged.
export function pixelClientFor({ env, client, version, accountId, fetch, now, sleep, store, deadlineMs }) {
  return createEmqClient({ env, version, accountId, fetch, now, sleep, store, deadlineMs }) || client;
}

// { score, events } with the Purchase score as the headline (mean of the rest otherwise), or null for an unknown shape.
export function parseEmq(body) {
  const events = new Map();
  const visit = list => {
    for (const entry of Array.isArray(list) ? list : []) {
      const name = entry?.event_name;
      const raw = entry?.event_match_quality?.composite_score ?? entry?.composite_score;
      const score = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
      if (typeof name === 'string' && Number.isFinite(score) && score >= 0 && score <= 10 && !events.has(name)) events.set(name, score);
    }
  };
  // Live shape: a top-level web list. Older shape: data[].web (also server / app). Anything else is unknown.
  visit(body?.web);
  for (const group of Array.isArray(body?.data) ? body.data : []) { visit(group?.web); visit(group?.server); visit(group?.app); }
  if (!events.size) return null;
  const list = [...events].map(([name, score]) => ({ name, score }));
  const purchase = list.find(e => e.name === 'Purchase');
  return { score: purchase ? purchase.score : list.reduce((sum, e) => sum + e.score, 0) / list.length, events: list };
}

export async function fetchEmq({ emqClient, pixelId }) {
  return parseEmq(await emqClient.get('dataset_quality', { dataset_id: pixelId, fields: 'web{event_name,event_match_quality{composite_score}}' }));
}

// Daily EMQ snapshot. Returns the number of documents written (0 when the shape is unknown).
export async function snapshotEmq({ emqClient, pixelId, store, now, D }) {
  const emq = await fetchEmq({ emqClient, pixelId });
  if (!emq) return { written: 0 };
  await writeSnap({ store, module: 'emq', date: D, ref: D, value: { ...emq, fetched_at: new Date(Number(now())).toISOString() } });
  return { written: 1 };
}

// ---- Pixel view payload ----

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sum = values => { const known = values.filter(isNum); return known.length ? known.reduce((a, b) => a + b, 0) : null; };
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const counted = entry => ({ web: isNum(entry?.web) ? entry.web : null, server: isNum(entry?.server) ? entry.server : null });

export function createPixelView({ client, emqClient, accountId, env, store, now, D }) {
  const HISTORY_DAYS = 14;
  const WINDOW_DAYS = 7;

  async function readDays() {
    const dates = datesBetween(shift(D, -HISTORY_DAYS), shift(D, -1));
    const values = await store(['MGET', ...dates.map(date => K.snap('pixel', date))]);
    const days = [];
    dates.forEach((date, i) => {
      const doc = parse(values[i]);
      if (!doc?.events || typeof doc.events !== 'object') return;
      const events = Object.fromEntries(PIXEL_EVENTS.map(name => {
        const c = counted(doc.events[name]);
        return [name, { ...c, total: sum([c.web, c.server]) }];
      }));
      days.push({ date, provisional: date >= provisionalFrom(D), adjustable: isAdjustable(date, D), events });
    });
    return days;
  }

  // Identity is nice to have: a failing node call leaves the counts and funnel intact.
  async function identity(id) {
    try {
      const info = await client.get(id, { fields: 'id,name,last_fired_time,is_unavailable' });
      return { id, name: cleanName(info?.name) || null, last_fired_time: info?.last_fired_time ?? null, is_unavailable: typeof info?.is_unavailable === 'boolean' ? info.is_unavailable : null };
    } catch (error) {
      if (!(error instanceof MetaError)) throw error;
      return { id, name: null, last_fired_time: null, is_unavailable: null };
    }
  }

  async function emqOf(id) {
    if (!emqClient) return { emq: null, emq_status: 'not_configured' };
    try {
      const emq = await fetchEmq({ emqClient, pixelId: id });
      return emq ? { emq, emq_status: 'ok' } : { emq: null, emq_status: 'unavailable' };
    } catch (error) {
      if (!(error instanceof MetaError)) throw error;
      return { emq: null, emq_status: 'unavailable' };
    }
  }

  // Why the real pixel data is missing, from the latest snapshot job. Only reasons the job itself recorded are reported.
  function reasonOf(days, latest) {
    const entry = latest?.status?.pixel;
    if (!pixelStatsEnabled(env) || entry?.code === 'attributed') return 'attributed';
    if (entry?.code === 'no_permission') return 'no_permission';
    if (days.length) return 'ok';
    if (!entry) return 'not_run_yet';
    return entry.ok === false && entry.code !== undefined ? 'error' : 'no_events';
  }

  // Fallback when /stats is not permitted: the same four funnel events, but as Meta attributes them to ads (sales snapshots).
  // There is no web/server split here, only a total, and the UI says so.
  async function readAttributed(window) {
    const dates = datesBetween(window.from, window.to);
    const values = await store(['MGET', ...dates.map(date => K.snap('sales', date))]);
    const pick = { ViewContent: 'content', AddToCart: 'carts', InitiateCheckout: 'checkout', Purchase: 'purchases' };
    const days = [];
    dates.forEach((date, i) => {
      const account = parse(values[i])?.account;
      if (!account || typeof account !== 'object') return;
      const events = Object.fromEntries(PIXEL_EVENTS.map(name => [name, { web: null, server: null, total: isNum(account[pick[name]]) ? account[pick[name]] : null }]));
      days.push({ date, provisional: date >= provisionalFrom(D), adjustable: isAdjustable(date, D), events });
    });
    const totals = Object.fromEntries(PIXEL_EVENTS.map(name => [name, { web: null, server: null, total: sum(days.map(day => day.events[name].total)) }]));
    const funnel = funnelOf({ content: totals.ViewContent.total, carts: totals.AddToCart.total, checkout: totals.InitiateCheckout.total, purchases: totals.Purchase.total });
    return { window, days, totals, funnel, days_covered: days.length, days_expected: dates.length };
  }

  async function pixel() {
    const id = await resolvePixelId({ env, client, store, accountId });
    const [info, days, emq, latest] = await Promise.all([identity(id), readDays(), emqOf(id), readSnapStatus(store, D)]);
    const window = { from: shift(D, -WINDOW_DAYS), to: shift(D, -1) };
    const inWindow = days.filter(day => day.date >= window.from && day.date <= window.to);
    const totals = Object.fromEntries(PIXEL_EVENTS.map(name => {
      const web = sum(inWindow.map(day => day.events[name].web)), server = sum(inWindow.map(day => day.events[name].server));
      return [name, { web, server, total: sum([web, server]) }];
    }));
    const funnel = funnelOf({ content: totals.ViewContent.total, carts: totals.AddToCart.total, checkout: totals.InitiateCheckout.total, purchases: totals.Purchase.total });
    const pixel_status = reasonOf(days, latest);
    const attributed = pixel_status === 'ok' ? null : await readAttributed(window);
    // How many of the window's days hold data: a partial week is never presented as a full one.
    const days_covered = inWindow.length, days_expected = WINDOW_DAYS;
    return { ...envelope({ now, D, range: window }), window, pixel: info, pixel_status, days, totals, funnel, days_covered, days_expected, attributed, ...emq };
  }

  return { pixel };
}
