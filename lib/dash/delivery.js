import { shift } from '../dates.js';

// Real delivery state of an ad, ad set or campaign. Meta's effective_status alone is not enough: a fixed-length ad set
// whose end_time passed, or a paused parent, can leave the child reading ACTIVE while nothing is served.
export const DELIVERY = Object.freeze({ RUNNING: 'running', NO_DELIVERY: 'no_delivery', ENDED: 'ended', PAUSED: 'paused', OTHER: 'other' });

const PAUSED = new Set(['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']);

// Ads worth listing: live ones plus the states that explain why a live-looking ad is not serving.
export const LIVE_STATUSES = ['ACTIVE', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'IN_PROCESS', 'WITH_ISSUES', 'PENDING_REVIEW', 'DISAPPROVED'];
export const AD_DELIVERY_FIELDS = 'id,name,effective_status,adset_id,campaign_id,adset{name,effective_status,end_time},campaign{name,effective_status,stop_time}';

// The same request with the fields that say what each ad is for (campaign objective, ad set goal and destination).
export const AD_FATIGUE_FIELDS = 'id,name,effective_status,adset_id,campaign_id,adset{name,effective_status,end_time,optimization_goal,destination_type},campaign{name,effective_status,stop_time,objective}';

// Meta writes offsets as +0000; Date.parse is only guaranteed on +00:00.
const toMs = value => {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value.replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
  return Number.isFinite(ms) ? ms : null;
};
const isPast = (value, now) => { const ms = toMs(value); return ms !== null && ms <= now; };

// `levels`: effective_status per level (ad, ad set, campaign); missing levels are null and ignored.
// `ends`: ad set end_time and campaign stop_time. `impressions`: last 3 days (2 closed days plus today).
export function deliveryOf({ levels, ends = [], impressions, now }) {
  const known = levels.filter(s => typeof s === 'string' && s);
  if (!known.length) return { state: DELIVERY.OTHER, raw: null };
  if (ends.some(end => isPast(end, now))) return { state: DELIVERY.ENDED, raw: null };
  if (known.some(s => PAUSED.has(s))) return { state: DELIVERY.PAUSED, raw: null };
  const odd = known.find(s => s !== 'ACTIVE');
  if (odd) return { state: DELIVERY.OTHER, raw: odd };
  return { state: Number(impressions) > 0 ? DELIVERY.RUNNING : DELIVERY.NO_DELIVERY, raw: null };
}

export const recentWindow = D => ({ since: shift(D, -2), until: D });

// One insights call at the given level; returns Map(id -> impressions) for the last 3 days.
export async function recentImpressions({ client, accountId, D, level, idKey, extraKeys = '' }) {
  const rows = await client.list(`act_${accountId}/insights`, {
    fields: `impressions,${idKey}${extraKeys ? `,${extraKeys}` : ''}`, level, time_range: JSON.stringify(recentWindow(D)),
  });
  return { rows, byId: new Map(rows.filter(r => r?.[idKey]).map(r => [String(r[idKey]), Number(r.impressions) || 0])) };
}

// Delivery for one ad row fetched with AD_DELIVERY_FIELDS.
export function adDelivery(ad, impressions, now) {
  const out = deliveryOf({
    levels: [ad.effective_status, ad.adset?.effective_status, ad.campaign?.effective_status],
    ends: [ad.adset?.end_time, ad.campaign?.stop_time], impressions, now: Number(now()),
  });
  return { delivery: out.state, delivery_raw: out.raw };
}
