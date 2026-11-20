import { shift } from '../dates.js';
import { readDashMetrics, funnelOf, envelope as baseEnvelope } from './metrics.js';
import { provisionalFrom, isAdjustable, spanDays } from './range.js';
import { deliveryOf, recentImpressions } from './delivery.js';

// No attribution override params on purpose: numbers follow the Ads Manager default (label shown in the UI).
export const FIELDS = 'spend,impressions,reach,inline_link_clicks,actions,action_values,purchase_roas';
const byPurchases = (a, b) => (b.metrics.purchases ?? -1) - (a.metrics.purchases ?? -1) || (b.metrics.spend ?? -1) - (a.metrics.spend ?? -1);

export function previousRange({ from, to }) {
  const days = spanDays(from, to);
  return { from: shift(from, -days), to: shift(from, -1) };
}

export function createSales({ client, accountId, now, D }) {
  const path = suffix => `act_${accountId}/${suffix}`;
  const insights = (range, extra = {}) => client.list(path('insights'), {
    fields: FIELDS + (extra.fields ? `,${extra.fields}` : ''), time_range: JSON.stringify({ since: range.from, until: range.to }),
    ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'fields')),
  });
  const envelope = range => baseEnvelope({ now, D, range });
  const entityMap = async (suffix, fields) => new Map((await client.list(path(suffix), { fields })).filter(e => e?.id !== undefined).map(e => [String(e.id), e]));
  const recent = (level, idKey, extraKeys) => recentImpressions({ client, accountId, D, level, idKey, extraKeys });
  const view = (entity, ends, impressions) => {
    const out = deliveryOf({ levels: [entity?.effective_status], ends, impressions, now: Number(now()) });
    return { status: entity?.effective_status ?? null, delivery: out.state, delivery_raw: out.raw };
  };

  async function sales(range) {
    const candidate = previousRange(range);
    // Long historical views must not fail because their comparison would go years further back.
    const prev = candidate.from >= shift(D, -1095) ? candidate : null;
    const [total, previous, days, campaigns, statuses, recentCampaigns] = await Promise.all([
      insights(range, { level: 'account' }),
      prev ? insights(prev, { level: 'account' }) : Promise.resolve([]),
      insights(range, { level: 'account', time_increment: '1' }),
      insights(range, { level: 'campaign', fields: 'campaign_id,campaign_name,objective' }),
      entityMap('campaigns', 'id,effective_status,stop_time'),
      recent('campaign', 'campaign_id'),
    ]);
    const totals = readDashMetrics(total[0]);
    const byDate = new Map(days.map(r => [r.date_start, r]));
    const series = [];
    for (let date = range.from; date <= range.to; date = shift(date, 1)) {
      const m = readDashMetrics(byDate.get(date));
      series.push({
        date, spend: m.spend, purchases: m.purchases, carts: m.carts, revenue: m.revenue, roas: m.roas, cpa: m.cpa, ctr: m.ctr, cpm: m.cpm,
        provisional: date >= provisionalFrom(D), adjustable: isAdjustable(date, D),
      });
    }
    return {
      ...envelope(range), previous_range: prev, totals, previous: readDashMetrics(previous[0]), funnel: funnelOf(totals), series,
      campaigns: campaigns.map(r => ({ id: r.campaign_id, name: r.campaign_name, objective: r.objective ?? null, ...view(statuses.get(String(r.campaign_id)), [statuses.get(String(r.campaign_id))?.stop_time], recentCampaigns.byId.get(String(r.campaign_id)) ?? 0), metrics: readDashMetrics(r) })).sort(byPurchases),
    };
  }

  async function campaignTree(range) {
    const [campaigns, adsets, ads, campaignList, adsetList, adList, recentAds] = await Promise.all([
      insights(range, { level: 'campaign', fields: 'campaign_id,campaign_name,objective' }),
      insights(range, { level: 'adset', fields: 'campaign_id,adset_id,adset_name' }),
      insights(range, { level: 'ad', fields: 'campaign_id,adset_id,ad_id,ad_name' }),
      entityMap('campaigns', 'id,effective_status,stop_time'),
      entityMap('adsets', 'id,effective_status,end_time,campaign_id'),
      entityMap('ads', 'id,effective_status,adset_id,campaign_id'),
      recent('ad', 'ad_id', 'adset_id,campaign_id'),
    ]);
    // Impressions of the last 3 days roll up from the ad rows, so ad sets and campaigns need no extra call.
    const sumBy = key => {
      const totals = new Map();
      for (const r of recentAds.rows) if (r?.[key]) totals.set(String(r[key]), (totals.get(String(r[key])) || 0) + (Number(r.impressions) || 0));
      return totals;
    };
    const bySetImpressions = sumBy('adset_id'), byCampaignImpressions = sumBy('campaign_id');
    const campaignOf = id => campaignList.get(String(id));
    const adsetOf = id => adsetList.get(String(id));
    const adsBySet = new Map();
    for (const r of ads) {
      const list = adsBySet.get(String(r.adset_id)) || [];
      const entity = adList.get(String(r.ad_id));
      const set = adsetOf(r.adset_id), camp = campaignOf(r.campaign_id ?? entity?.campaign_id);
      const out = deliveryOf({
        levels: [entity?.effective_status, set?.effective_status, camp?.effective_status], ends: [set?.end_time, camp?.stop_time],
        impressions: recentAds.byId.get(String(r.ad_id)) ?? 0, now: Number(now()),
      });
      list.push({ id: r.ad_id, name: r.ad_name, status: entity?.effective_status ?? null, delivery: out.state, delivery_raw: out.raw, metrics: readDashMetrics(r) });
      adsBySet.set(String(r.adset_id), list);
    }
    const setsByCampaign = new Map();
    for (const r of adsets) {
      const list = setsByCampaign.get(String(r.campaign_id)) || [];
      const set = adsetOf(r.adset_id), camp = campaignOf(r.campaign_id);
      const out = deliveryOf({
        levels: [set?.effective_status, camp?.effective_status], ends: [set?.end_time, camp?.stop_time],
        impressions: bySetImpressions.get(String(r.adset_id)) ?? 0, now: Number(now()),
      });
      list.push({ id: r.adset_id, name: r.adset_name, status: set?.effective_status ?? null, delivery: out.state, delivery_raw: out.raw, metrics: readDashMetrics(r), ads: (adsBySet.get(String(r.adset_id)) || []).sort(byPurchases) });
      setsByCampaign.set(String(r.campaign_id), list);
    }
    return {
      ...envelope(range),
      campaigns: campaigns.map(r => {
        const camp = campaignOf(r.campaign_id);
        return {
          id: r.campaign_id, name: r.campaign_name, objective: r.objective ?? null, ...view(camp, [camp?.stop_time], byCampaignImpressions.get(String(r.campaign_id)) ?? 0),
          metrics: readDashMetrics(r), adsets: (setsByCampaign.get(String(r.campaign_id)) || []).sort(byPurchases),
        };
      }).sort(byPurchases),
    };
  }

  // Daily campaign rows for D-30..D (provisional days included), compact: numbers only, read by the chat facts. One GET query.
  async function dailyCampaigns() {
    const range = { from: shift(D, -30), to: D };
    const rows = await insights(range, { level: 'campaign', time_increment: '1', fields: 'campaign_id,campaign_name,objective' });
    return {
      from: range.from, to: range.to,
      rows: rows.filter(r => r?.date_start && r.campaign_id !== undefined).map(r => {
        const { spend, purchases, revenue, content, carts, checkout } = readDashMetrics(r);
        return { date: r.date_start, id: String(r.campaign_id), name: r.campaign_name ?? '', objective: r.objective ?? null, m: { spend, purchases, revenue, content, carts, checkout } };
      }),
    };
  }

  return { sales, campaigns: campaignTree, dailyCampaigns };
}
