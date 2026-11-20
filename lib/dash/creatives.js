import { shift } from '../dates.js';
import { K, TTL } from './store.js';
import { paramsHash } from './cache.js';
import { FIELDS } from './sales.js';
import { readDashMetrics, envelope } from './metrics.js';
import { STATES } from './fatigue.js';
import { inspectPreviewBody, validatePreviewSrc } from './preview.js';
import { MetaError } from '../meta-client.js';
import { logEvent, logPreviewSrc } from './log.js';
import { LIVE_STATUSES, AD_DELIVERY_FIELDS, adDelivery, recentImpressions } from './delivery.js';


// A fatigue snapshot up to 3 days old is still shown (dated by `as_of`); anything older counts as missing (Amendment 4).
const FATIGUE_MAX_AGE_DAYS = 3;
const PREVIEW_FALLBACK = ['MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_REELS'];
const byspend = (a, b) => (b.metrics.spend ?? -1) - (a.metrics.spend ?? -1);
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

export function createCreatives({ client, accountId, store, now, D }) {
  const path = suffix => `act_${accountId}/${suffix}`;

  async function latestFatigue() {
    const dates = Array.from({ length: FATIGUE_MAX_AGE_DAYS + 1 }, (_, i) => shift(D, -i));
    const values = await store(['MGET', ...dates.map(d => K.snap('fatigue', d))]);
    for (let i = 0; i < dates.length; i++) {
      const doc = parse(values[i]);
      if (doc && Array.isArray(doc.ads)) return { doc, date: dates[i] };
    }
    return { doc: null, date: null };
  }

  function fatigueOf(snap, ad) {
    if (!snap.doc) return { state: STATES.INSUFFICIENT_SAMPLE, signals: null, gates: null, as_of: null, evidence: null };
    const found = snap.doc.ads.find(a => String(a?.id) === String(ad.id));
    if (!found) return { state: STATES.INSUFFICIENT_SAMPLE, signals: null, gates: null, as_of: snap.date, evidence: null };
    return { state: found.state, signals: found.signals ?? null, gates: found.gates ?? null, as_of: snap.date, evidence: { C: found.C ?? null, B: found.B ?? null } };
  }

  // Active inventory with the range's metrics and the latest fatigue state. Signed CDN URLs travel in this payload only;
  // the cache layer strips them into media:* before anything is stored.
  async function creatives(range) {
    const [ads, rows, snap, recent] = await Promise.all([
      client.list(path('ads'), {
        fields: `${AD_DELIVERY_FIELDS},creative.thumbnail_width(600).thumbnail_height(600){object_type,thumbnail_url,image_url}`,
        filtering: JSON.stringify([{ field: 'effective_status', operator: 'IN', value: LIVE_STATUSES }]),
      }),
      client.list(path('insights'), {
        fields: `${FIELDS},frequency,ad_id,ad_name`, level: 'ad', time_range: JSON.stringify({ since: range.from, until: range.to }),
      }),
      latestFatigue(),
      recentImpressions({ client, accountId, D, level: 'ad', idKey: 'ad_id' }),
    ]);
    const byAd = new Map(rows.filter(r => r?.ad_id).map(r => [String(r.ad_id), r]));
    const list = ads.filter(ad => ad?.id).map(ad => {
      const row = byAd.get(String(ad.id));
      const frequency = Number(row?.frequency);
      return {
        id: String(ad.id), name: ad.name ?? null, status: ad.effective_status ?? null, ...adDelivery(ad, recent.byId.get(String(ad.id)) ?? 0, now),
        campaign_id: ad.campaign_id ?? null, campaign_name: ad.campaign?.name ?? null,
        adset_id: ad.adset_id ?? null, adset_name: ad.adset?.name ?? null,
        creative: { type: ad.creative?.object_type ?? null, thumbnail_url: ad.creative?.thumbnail_url ?? null, image_url: ad.creative?.image_url ?? null },
        metrics: { ...readDashMetrics(row), frequency: row?.frequency !== undefined && Number.isFinite(frequency) ? frequency : null },
        fatigue: fatigueOf(snap, ad),
      };
    }).sort(byspend);
    return { ...envelope({ now, D, range }), ads: list };
  }

  // The stored value is a facebook.com URL, never Meta's HTML body and never an fbcdn URL, so 12 h is safe.
  // A format the ad does not support fails or comes back empty, so the next one is tried until a body arrives.
  async function preview({ ad_id, format }) {
    const key = K.cache('preview', paramsHash({ ad_id, format }));
    const hit = validatePreviewSrc(await store(['GET', key]));
    if (hit) return hit;
    let failure = null;
    for (const candidate of [...new Set([format, ...PREVIEW_FALLBACK])]) {
      let body;
      try { body = await client.get(`${ad_id}/previews`, { ad_format: candidate }); } catch (error) {
        if (!(error instanceof MetaError) || error.code === 'config') throw error;
        failure = error;
        continue;
      }
      const first = body?.data?.[0]?.body;
      if (typeof first !== 'string' || first.length === 0) continue;
      const found = inspectPreviewBody(first);
      if (!found.src) {
        logEvent('dash_preview', { stage: 'rejected', code: found.code });
        logPreviewSrc(found);
        return null;
      }
      await store(['SET', key, found.src, 'EX', TTL.preview]);
      return found.src;
    }
    if (failure) throw failure;
    logEvent('dash_preview', { stage: 'rejected', code: 'no_body' });
    return null;
  }

  return { creatives, preview };
}
