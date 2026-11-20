import { shift } from '../dates.js';
import { K, TTL400, IDX_TTL } from '../dash/store.js';
import { isProvisional, provisionalFrom } from '../dash/range.js';
import { epochDay } from '../dash/snapshot.js';

// Optimization journal: one deterministic row per ISO week, computed by plain code (no model) from the stored snapshots.
// Rows are recomputed every day for the last RECOMPUTE_WEEKS weeks, so late attribution corrections reach them and a second
// run over the same snapshots writes exactly the same bytes (nothing time-varying is stored). The agent and the chat get a
// compact columnar digest of the last FACT_WEEKS weeks plus week-over-week trend flags.
export const JOURNAL = Object.freeze({ KEEP_WEEKS: 26, RECOMPUTE_WEEKS: 8, FACT_WEEKS: 8, ROUTE_WEEKS: 12, MAX_TRENDS: 12, MIN_TREND_WEEKS: 2 });

const DAY = 86400000;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = (v, places = 2) => (isNum(v) ? Math.round(v * 10 ** places) / 10 ** places : null);
const sumKnown = values => { const known = values.filter(isNum); return known.length ? known.reduce((a, b) => a + b, 0) : null; };
const per100 = (a, b) => (isNum(a) && isNum(b) && b > 0 ? (a / b) * 100 : null);
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

// ISO 8601: weeks start on Monday and belong to the year of their Thursday.
export function weekKey(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const year = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((d - jan4) / DAY - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}
export function weekStart(key) {
  const [year, week] = String(key).split('-W').map(Number);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  return new Date(jan4.getTime() - ((jan4.getUTCDay() + 6) % 7) * DAY + (week - 1) * 7 * DAY).toISOString().slice(0, 10);
}
const weekDates = week => { const from = weekStart(week); return Array.from({ length: 7 }, (_, i) => shift(from, i)); };

const newest = (byDate, dates, D, valid) => {
  for (const date of [...dates].sort().reverse()) if (date <= D && valid(byDate?.[date])) return byDate[date];
  return null;
};
const countBy = (list, test) => list.filter(test).length;

// `docs[module][date]` are parsed snapshot documents. Returns null when the week has no closed sales day (no row is written).
// Only closed days (before D - 2) feed the numbers, like every other fact; snapshots taken on a day (EMQ, ads, agent runs)
// count when that day is not after D.
export function computeRow({ week, docs, D }) {
  const dates = weekDates(week);
  const closed = dates.filter(date => !isProvisional(date, D));
  const accounts = closed.map(date => docs.sales?.[date]?.account).filter(a => a && typeof a === 'object' && isNum(a.spend));
  if (!accounts.length) return null;
  const total = key => sumKnown(accounts.map(a => a[key]));
  const spend = total('spend'), purchases = total('purchases'), revenue = total('revenue');
  const views = total('content'), carts = total('carts'), checkout = total('checkout');
  const row = {
    week, from: dates[0], to: dates[6], days: accounts.length,
    spend: round(spend), purchases,
    cpa: isNum(purchases) && purchases > 0 ? round(spend / purchases) : null,
    roas: isNum(revenue) && spend > 0 ? round(revenue / spend) : null,
    ctr_pct: round(per100(total('clicks'), total('impressions'))),
    funnel: { views, carts, checkout, purchases, cart_per_100: round(per100(carts, views)), checkout_per_100: round(per100(checkout, carts)), purchase_per_100: round(per100(purchases, checkout)) },
  };

  const pixelDocs = closed.map(date => docs.pixel?.[date]?.events).filter(events => events && typeof events === 'object');
  const eventTotals = source => sumKnown(pixelDocs.flatMap(events => Object.values(events).map(e => e?.[source])));
  row.pixel = pixelDocs.length ? {
    events_web: eventTotals('web'), events_server: eventTotals('server'),
    purchase_web: sumKnown(pixelDocs.map(e => e.Purchase?.web)), purchase_server: sumKnown(pixelDocs.map(e => e.Purchase?.server)),
  } : null;

  const emq = newest(docs.emq, dates, D, doc => isNum(doc?.score));
  row.emq = emq ? round(emq.score, 1) : null;

  const creatives = newest(docs.creatives, dates, D, doc => Array.isArray(doc?.ads));
  const fatigue = newest(docs.fatigue, dates, D, doc => Array.isArray(doc?.ads));
  row.ads = creatives || fatigue ? {
    active: creatives ? countBy(creatives.ads, a => a?.status === 'ACTIVE') : null,
    running: creatives ? countBy(creatives.ads, a => a?.delivery === 'running') : null,
    fatigued: fatigue ? countBy(fatigue.ads, a => a?.state === 'FATIGUED') : null,
  } : null;

  const nets = closed.map(date => docs.ig?.[date]).filter(doc => isNum(doc?.follows) && isNum(doc?.unfollows)).map(doc => doc.follows - doc.unfollows);
  row.ig_net = nets.length ? nets.reduce((a, b) => a + b, 0) : null;

  const runs = dates.filter(date => date <= D).map(date => docs.agent?.[date]).filter(run => run?.status === 'ok' && Array.isArray(run.recommendations));
  if (runs.length) {
    const counts = {};
    for (const run of runs) for (const rec of run.recommendations) if (typeof rec?.action === 'string') counts[rec.action] = (counts[rec.action] || 0) + 1;
    row.alerts = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
  } else row.alerts = null;
  return row;
}

const MODULES = ['sales', 'pixel', 'ig', 'emq', 'creatives', 'fatigue'];

// One MGET per week: seven days of six snapshot modules plus the agent runs.
async function readWeekDocs(store, week) {
  const dates = weekDates(week);
  const keys = [...MODULES.flatMap(module => dates.map(date => K.snap(module, date))), ...dates.map(date => K.agentRun(date))];
  const raw = await store(['MGET', ...keys]);
  const docs = {};
  let at = 0;
  for (const module of [...MODULES, 'agent']) {
    docs[module] = {};
    for (const date of dates) { const doc = parse(raw?.[at++]); if (doc !== null) docs[module][date] = doc; }
  }
  return docs;
}

// Overwrite-only (idempotent). The index keeps the newest KEEP_WEEKS weeks; older rows are deleted with their entries.
export async function writeRow({ store, row }) {
  const idx = K.idx('journal');
  await store(['SET', K.journal(row.week), JSON.stringify(row), 'EX', TTL400]);
  await store(['ZADD', idx, epochDay(weekStart(row.week)), row.week]);
  await store(['EXPIRE', idx, IDX_TTL]);
  const count = Number(await store(['ZCARD', idx])) || 0;
  if (count <= JOURNAL.KEEP_WEEKS) return;
  const old = await store(['ZRANGE', idx, 0, count - JOURNAL.KEEP_WEEKS - 1]);
  for (const week of old || []) { await store(['DEL', K.journal(week)]); await store(['ZREM', idx, week]); }
}

// Recomputes the last RECOMPUTE_WEEKS weeks from the snapshots, oldest first. Returns the weeks that have a row.
export async function computeJournal({ store, D }) {
  const weeks = [];
  for (let i = JOURNAL.RECOMPUTE_WEEKS - 1; i >= 0; i--) {
    const week = weekKey(shift(D, -7 * i));
    const row = computeRow({ week, docs: await readWeekDocs(store, week), D });
    if (!row) continue;
    await writeRow({ store, row });
    weeks.push(week);
  }
  return { weeks };
}

const valid = (row, week) => row && typeof row === 'object' && row.week === week && typeof row.from === 'string' && typeof row.to === 'string';

// Stored rows of the last `weeks` weeks, oldest first. Damaged or missing rows are simply absent.
export async function readJournal({ store, D, weeks = JOURNAL.FACT_WEEKS }) {
  const keys = Array.from({ length: weeks }, (_, i) => weekKey(shift(D, -7 * (weeks - 1 - i))));
  const raw = await store(['MGET', ...keys.map(K.journal)]);
  return keys.map((week, i) => [week, parse(raw?.[i])]).filter(([week, row]) => valid(row, week)).map(([, row]) => row);
}

// ---- the compact digest for the prompts ----

const SERIES = {
  days: r => (isNum(r.days) ? r.days : null),
  spend: r => round(r.spend, 0),
  purchases: r => (isNum(r.purchases) ? r.purchases : null),
  cpa: r => round(r.cpa, 1),
  roas: r => round(r.roas, 2),
  ctr_pct: r => round(r.ctr_pct, 2),
  cart_per_100: r => round(r.funnel?.cart_per_100, 1),
  // Checkouts can exceed carts when the two events are tracked differently; a rate above 100 is capped and flagged.
  checkout_per_100: r => { const v = round(r.funnel?.checkout_per_100, 1); return isNum(v) ? Math.min(v, 100) : null; },
  purchase_per_100: r => round(r.funnel?.purchase_per_100, 1),
  pixel_server_pct: r => round(per100(r.pixel?.events_server, (r.pixel?.events_web ?? 0) + (r.pixel?.events_server ?? 0)), 1),
  emq: r => round(r.emq, 1),
  ads_running: r => (isNum(r.ads?.running) ? r.ads.running : null),
  ads_fatigued: r => (isNum(r.ads?.fatigued) ? r.ads.fatigued : null),
  ig_net: r => (isNum(r.ig_net) ? r.ig_net : null),
  alerts: r => (r.alerts && typeof r.alerts === 'object' ? Object.values(r.alerts).reduce((a, b) => a + b, 0) : null),
};
// The series that get a trend flag, under the names the agent reads.
const TREND_NAMES = [
  ['spend', 'spend'], ['purchases', 'purchases'], ['cpa', 'cpa'], ['roas', 'roas'], ['ctr_pct', 'ctr'],
  ['cart_per_100', 'funnel_cart_rate'], ['checkout_per_100', 'funnel_checkout_rate'], ['purchase_per_100', 'funnel_purchase_rate'],
  ['pixel_server_pct', 'server_share'], ['emq', 'emq'], ['ads_fatigued', 'fatigued_ads'],
];

// Consecutive week-over-week moves in the same direction, ending at the newest value. A missing week or an equal value ends the run.
function run(values) {
  let direction = 0;
  let count = 0;
  for (let i = values.length - 1; i > 0; i--) {
    const [a, b] = [values[i - 1], values[i]];
    if (!isNum(a) || !isNum(b) || a === b) break;
    const step = b > a ? 1 : -1;
    if (direction && step !== direction) break;
    direction = step;
    count++;
  }
  return { direction, count };
}

// Null for an empty journal. The newest week may still be in progress (`partial_last`): it is in the series but never in the trends.
// A week with fewer than FULL_WEEK_DAYS covered days is not comparable with a full one: trailing ones leave the trends (like the
// partial week) and one in the middle breaks the run. `flags` lists data caveats computed by code.
const FULL_WEEK_DAYS = 7;
export function journalFacts(rows, D) {
  const chosen = rows.slice(-JOURNAL.FACT_WEEKS);
  if (!chosen.length) return null;
  const series = Object.fromEntries(Object.entries(SERIES).map(([name, pick]) => [name, chosen.map(pick)]));
  const partial = chosen.at(-1).to >= provisionalFrom(D);
  const full = chosen.map(r => !isNum(r.days) || r.days >= FULL_WEEK_DAYS);
  let complete = partial ? chosen.length - 1 : chosen.length;
  while (complete > 0 && !full[complete - 1]) complete--;
  const flags = [];
  for (const [name, label] of TREND_NAMES) {
    const { direction, count } = run(series[name].slice(0, complete).map((v, i) => (full[i] ? v : null)));
    if (count >= JOURNAL.MIN_TREND_WEEKS) flags.push({ text: `${label}: ${direction > 0 ? 'up' : 'down'} ${count} weeks`, count });
  }
  flags.sort((a, b) => b.count - a.count || (a.text < b.text ? -1 : 1));
  const notes = chosen.some(r => isNum(r.funnel?.checkout_per_100) && r.funnel.checkout_per_100 > 100) ? ['checkout_per_100_capped'] : [];
  return { weeks: chosen.map(r => r.week), partial_last: partial, series, trends: flags.slice(0, JOURNAL.MAX_TRENDS).map(f => f.text), flags: notes };
}
