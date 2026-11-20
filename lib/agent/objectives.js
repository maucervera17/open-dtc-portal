import { OBJECTIVE_GROUPS, isGroup } from '../dash/objective.js';

// Per objective group, the primary KPIs of the current window, computed by code from the facts and stored with the run so the
// Alertas page can head each group with real numbers. Nothing here comes from the model.
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;
const total = (list, key) => { const known = list.map(c => c?.C?.[key]).filter(isNum); return known.length ? known.reduce((a, b) => a + b, 0) : null; };
const per = (a, b, scale = 1) => (isNum(a) && isNum(b) && b > 0 ? round((a / b) * scale) : null);
const keep = kpis => Object.fromEntries(Object.entries(kpis).filter(([, v]) => isNum(v)));

const KPIS = {
  sales: (list, spend) => { const purchases = total(list, 'purchases'); const revenue = total(list, 'revenue'); return { purchases, cpa: per(spend, purchases), roas: per(revenue, spend) }; },
  traffic_site: (list, spend) => { const clicks = total(list, 'link_clicks'); return { link_clicks: clicks, cpc: per(spend, clicks), landing_page_views: total(list, 'landing_page_views') }; },
  profile_growth: (list, spend) => { const visits = total(list, 'profile_visits'); return { profile_visits: visits, cost_per_profile_visit: per(spend, visits), follows: total(list, 'follows') }; },
  engagement: (list, spend) => { const interactions = total(list, 'interactions'); return { interactions, cost_per_interaction: per(spend, interactions) }; },
  awareness: (list, spend) => { const impressions = total(list, 'impressions'); return { impressions, cpm: per(spend, impressions, 1000) }; },
};

export function objectiveSummary(facts) {
  const campaigns = Array.isArray(facts?.campaigns) ? facts.campaigns : [];
  return OBJECTIVE_GROUPS.map(group => {
    const list = campaigns.filter(c => (isGroup(c?.objective_group) ? c.objective_group : 'other') === group);
    if (!list.length) return null;
    const spend = total(list, 'spend');
    return { group, campaigns: list.length, spend: isNum(spend) ? round(spend) : null, kpis: keep(KPIS[group]?.(list, spend) ?? {}) };
  }).filter(Boolean);
}

// What the dashboard may read back from a stored run: closed group list, finite numbers, known KPI keys only.
const KPI_KEYS = new Set(['purchases', 'cpa', 'roas', 'link_clicks', 'cpc', 'landing_page_views', 'profile_visits', 'cost_per_profile_visit', 'follows', 'interactions', 'cost_per_interaction', 'impressions', 'cpm']);
export function cleanObjectives(list) {
  return (Array.isArray(list) ? list : []).filter(e => e && typeof e === 'object' && isGroup(e.group)).map(e => ({
    group: e.group, campaigns: isNum(e.campaigns) ? e.campaigns : 0, spend: isNum(e.spend) ? e.spend : null,
    kpis: Object.fromEntries(Object.entries(e.kpis && typeof e.kpis === 'object' ? e.kpis : {}).filter(([k, v]) => KPI_KEYS.has(k) && isNum(v))),
  }));
}
