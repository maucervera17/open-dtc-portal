import { shift } from '../dates.js';
import { K, TTL400, IDX_TTL } from './store.js';
import { readDashMetrics } from './metrics.js';
import { FIELDS } from './sales.js';
import { provisionalFrom } from './range.js';
import { windowsFor, statsOf, evaluate } from './fatigue.js';
import { minSpendFor } from '../locale.js';
import { LIVE_STATUSES, AD_DELIVERY_FIELDS, AD_FATIGUE_FIELDS, adDelivery, recentImpressions } from './delivery.js';
import { objectiveGroup, campaignGroup } from './objective.js';

export const epochDay = date => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86400000);
export const datesBetween = (from, to) => {
  const out = [];
  for (let d = from; d <= to; d = shift(d, 1)) out.push(d);
  return out;
};

// Overwrite-only write (idempotent per day). `ref` is the job date: index members older than 400 days are trimmed.
// `key` overrides the default snapshot key for documents that live elsewhere (the agent run) but share the index rules.
export async function writeSnap({ store, module, date, value, ref, key = K.snap(module, date) }) {
  await store(['SET', key, JSON.stringify(value), 'EX', TTL400]);
  const idx = K.idx(module);
  await store(['ZADD', idx, epochDay(date), date]);
  await store(['EXPIRE', idx, IDX_TTL]);
  await store(['ZREMRANGEBYSCORE', idx, '-inf', epochDay(ref) - 400]);
}

// [D-7, D-1] normally; Sundays widen to [D-28, D-1] so late attribution corrections are absorbed weekly.
export const salesRange = D => ({ from: shift(D, new Date(`${D}T00:00:00Z`).getUTCDay() === 0 ? -28 : -7), to: shift(D, -1) });

export async function snapshotSales({ client, accountId, store, now, D, version, from, to }) {
  const query = (level, fields) => client.list(`act_${accountId}/insights`, {
    fields: FIELDS + (fields ? `,${fields}` : ''), level, time_increment: '1', time_range: JSON.stringify({ since: from, until: to }),
  });
  const [days, campaigns] = await Promise.all([query('account'), query('campaign', 'campaign_id,campaign_name')]);
  const byDate = new Map();
  for (const r of campaigns) byDate.set(r.date_start, [...(byDate.get(r.date_start) || []), { id: r.campaign_id, name: r.campaign_name, metrics: readDashMetrics(r) }]);
  const fetched_at = new Date(Number(now())).toISOString();
  let written = 0;
  for (const row of [...days].sort((a, b) => (a.date_start < b.date_start ? -1 : 1))) {
    const date = row.date_start;
    if (!date || date < from || date > to) continue;
    await writeSnap({ store, module: 'sales', date, ref: D, value: {
      account: readDashMetrics(row), campaigns: byDate.get(date) || [], provisional: date >= provisionalFrom(D), fetched_at, api_version: version,
    } });
    written++;
  }
  return { written };
}

// Inventory only: ids, names and status. Signed CDN URLs are never requested and never stored.
export async function snapshotCreatives({ client, accountId, store, now, D }) {
  const [ads, recent] = await Promise.all([
    client.list(`act_${accountId}/ads`, { fields: AD_DELIVERY_FIELDS }),
    recentImpressions({ client, accountId, D, level: 'ad', idKey: 'ad_id' }),
  ]);
  await writeSnap({ store, module: 'creatives', date: D, ref: D, value: {
    ads: ads.map(a => ({
      id: a.id, name: a.name ?? null, status: a.effective_status ?? null, ...adDelivery(a, recent.byId.get(String(a.id)) ?? 0, now),
      adset_id: a.adset_id ?? null, campaign_id: a.campaign_id ?? null,
    })),
    fetched_at: new Date(Number(now())).toISOString(),
  } });
  return { written: 1 };
}

// Four windowed insights calls (campaign and ad, current and baseline). Each window is ONE query with time_range,
// so frequency is Meta's own value for the window and is never summed from daily rows. Nothing is written on failure.
export async function snapshotFatigue({ client, accountId, store, now, D, env = {} }) {
  const windows = windowsFor(D);
  const query = (level, extra, w) => client.list(`act_${accountId}/insights`, {
    fields: `${FIELDS},frequency,instagram_profile_visits,${extra}`, level, time_range: JSON.stringify({ since: w.from, until: w.to }),
  });
  // Current delivery state per ad, so the agent never recommends stopping what already ended or is paused.
  const [adList, recent] = await Promise.all([
    client.list(`act_${accountId}/ads`, {
      fields: AD_FATIGUE_FIELDS, filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: [...LIVE_STATUSES, 'PAUSED'] }]),
    }),
    recentImpressions({ client, accountId, D, level: 'ad', idKey: 'ad_id' }),
  ]);
  const deliveryById = new Map(adList.filter(a => a?.id !== undefined).map(a => [String(a.id), adDelivery(a, recent.byId.get(String(a.id)) ?? 0, now).delivery]));
  const [adC, adB, campC, campB] = await Promise.all([
    query('ad', 'ad_id,ad_name,campaign_id', windows.C), query('ad', 'ad_id,ad_name,campaign_id', windows.B),
    query('campaign', 'campaign_id,campaign_name,objective', windows.C), query('campaign', 'campaign_id,campaign_name,objective', windows.B),
  ]);
  // What each live ad is for, from the ads request above (no extra call): the ad set decides, the campaign objective backs it up.
  const purpose = new Map(adList.filter(a => a?.id !== undefined).map(a => {
    const fields = { objective: a.campaign?.objective ?? null, optimization_goal: a.adset?.optimization_goal ?? null, destination_type: a.adset?.destination_type ?? null };
    return [String(a.id), { ...fields, campaign_id: a.campaign_id === undefined || a.campaign_id === null ? null : String(a.campaign_id), objective_group: objectiveGroup(fields) }];
  }));
  const objectiveOf = new Map([...campC, ...campB].filter(r => r?.campaign_id && typeof r.objective === 'string').map(r => [String(r.campaign_id), r.objective]));
  for (const p of purpose.values()) if (p.campaign_id && p.objective && !objectiveOf.has(p.campaign_id)) objectiveOf.set(p.campaign_id, p.objective);
  const groupOfCampaign = id => campaignGroup(objectiveOf.get(id), [...purpose.values()].filter(p => p.campaign_id === id).map(p => p.objective_group));
  const byId = (rows, idKey) => new Map(rows.filter(r => r?.[idKey]).map(r => [String(r[idKey]), r]));
  const current = byId(adC, 'ad_id'), baseline = byId(adB, 'ad_id');
  const ads = [...new Set([...current.keys(), ...baseline.keys()])].sort().map(id => {
    const c = current.get(id), b = baseline.get(id);
    const C = statsOf(c), B = statsOf(b);
    const { state, signals, gates } = evaluate(C, B, minSpendFor(env));
    const campaign_id = (c || b).campaign_id ?? null;
    const p = purpose.get(id);
    const own = p ? { objective: p.objective, optimization_goal: p.optimization_goal, destination_type: p.destination_type, objective_group: p.objective_group } : { objective: objectiveOf.get(String(campaign_id)) ?? null, optimization_goal: null, destination_type: null, objective_group: groupOfCampaign(String(campaign_id)) };
    return { id, campaign_id, name: (c || b).ad_name ?? null, ...own, C, B, state, signals, gates, delivery: deliveryById.get(id) ?? null };
  });
  const campaigns = rows => rows.filter(r => r?.campaign_id).map(r => ({
    id: String(r.campaign_id), name: r.campaign_name ?? null, objective: objectiveOf.get(String(r.campaign_id)) ?? null, objective_group: groupOfCampaign(String(r.campaign_id)), ...statsOf(r),
  }));
  await writeSnap({ store, module: 'fatigue', date: D, ref: D, value: {
    windows, campaigns: { C: campaigns(campC), B: campaigns(campB) }, ads, fetched_at: new Date(Number(now())).toISOString(),
  } });
  return { written: 1 };
}
