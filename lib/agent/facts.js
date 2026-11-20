import { createHash } from 'node:crypto';
import { shift } from '../dates.js';
import { K } from '../dash/store.js';
import { FATIGUE, windowsFor } from '../dash/fatigue.js';
import { activeProfile, minSpendFor } from '../locale.js';
import { PLAYBOOK_VERSION } from './playbook.js';
import { SKILL_VERSION } from './skills/claude-ads-meta.js';
import { cleanName } from '../text.js';
import { readJournal, journalFacts } from './journal.js';
import { objectiveGroup, campaignGroup, isGroup, TRACKING_GROUPS, PURCHASE_GROUPS } from '../dash/objective.js';
import { pixelStatsEnabled } from '../dash/pixel.js';
import { cleanRows, recentFacts } from './recent.js';

// Facts come only from snapshots (snap:*): the agent makes no live Meta read. Every window ends at D-3, so provisional
// days never enter. Nothing time-varying (fetched_at, last-fired time) is included, which keeps input_hash stable.
const MAX_CAMPAIGNS = 30;
const MAX_ADS = 40;
const NAME_CHARS = 120;
const FATIGUE_LOOKBACK_DAYS = 3;

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = (v, places = 2) => (isNum(v) ? Math.round(v * 10 ** places) / 10 ** places : null);
const clean = value => cleanName(value, NAME_CHARS);
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = shift(d, 1)) out.push(d); return out; };
const positive = raw => { const n = Number(raw); return raw !== undefined && raw !== '' && Number.isFinite(n) && n > 0 ? n : null; };

const usable = doc => doc && typeof doc === 'object' && Array.isArray(doc.ads) && Array.isArray(doc.campaigns?.C) && Array.isArray(doc.campaigns?.B)
  && doc.windows?.C?.to && doc.windows?.B?.to;

async function newestFatigue(store, D) {
  const dates = Array.from({ length: FATIGUE_LOOKBACK_DAYS + 1 }, (_, i) => shift(D, -i));
  const raw = await store(['MGET', ...dates.map(d => K.snap('fatigue', d))]);
  for (let i = 0; i < dates.length; i++) {
    const doc = parse(raw?.[i]);
    if (usable(doc)) return { doc, date: dates[i] };
  }
  return null;
}

// Each objective group is read through its own KPIs. Purchases, CPA and ROAS stay only where they are the goal (sales, and other
// for an unknown objective); a profile-growth, engagement or awareness entity never carries them, so nothing can judge it by them.
const ratio = (a, b) => (isNum(a) && isNum(b) && b > 0 ? round(a / b) : null);
const windowFacts = (stat, withRevenue, group = 'other') => {
  if (!stat) return null;
  const spend = round(stat.spend);
  const out = { impressions: round(stat.impressions, 0), spend };
  if (PURCHASE_GROUPS.has(group)) {
    out.purchases = round(stat.purchases, 0);
    // Revenue is read from the same windowed row as purchases and spend: one source, one age for ROAS and CPA.
    if (withRevenue) { out.revenue = round(stat.revenue); out.roas = isNum(stat.revenue) && isNum(stat.spend) && stat.spend > 0 ? round(stat.revenue / stat.spend) : null; }
    out.cpa = round(stat.cpa);
  }
  out.ctr_pct = isNum(stat.ctr) ? round(stat.ctr * 100) : null;
  out.frequency = round(stat.frequency);
  // Website (pixel) counts, with the omni totals (they include Instagram and Facebook) as separate secondary fields.
  if (group === 'sales') {
    for (const key of ['content', 'carts', 'checkout', 'content_all', 'carts_all', 'checkout_all']) if (isNum(stat[key])) out[key] = round(stat[key], 0);
  }
  if (group === 'traffic_site') {
    Object.assign(out, { link_clicks: round(stat.link_clicks, 0), landing_page_views: round(stat.landing_page_views, 0), cpc_link: ratio(stat.spend, stat.link_clicks) });
    if (isNum(stat.carts)) out.carts = round(stat.carts, 0);
  }
  if (group === 'profile_growth') Object.assign(out, { profile_visits: round(stat.profile_visits, 0), cost_per_profile_visit: ratio(stat.spend, stat.profile_visits), follows: round(stat.follows, 0) });
  if (group === 'engagement') Object.assign(out, { interactions: round(stat.interactions, 0), cost_per_interaction: ratio(stat.spend, stat.interactions) });
  if (group === 'awareness') Object.assign(out, { reach: round(stat.reach, 0), cpm: round(stat.cpm) });
  return out;
};

// Spend with no content view, cart, checkout or purchase at all across the window points at a tracking outage, not at a bad
// entity. Snapshots written before the funnel counts existed lack the fields and are never judged.
const trackingSuspect = (stat, group) => TRACKING_GROUPS.has(group) && Boolean(stat) && isNum(stat.spend) && stat.spend > 0
  && [stat.content, stat.carts, stat.checkout, stat.purchases].every(v => v === 0);
const flag = (stat, group) => (trackingSuspect(stat, group) ? { tracking_suspect: true } : {});

// Sales-only totals (CPA and ROAS are only meaningful where purchases are the goal) and blended totals over every campaign.
const sumAccount = list => {
  const total = key => { const known = list.map(c => c[key]).filter(isNum); return known.length ? known.reduce((a, b) => a + b, 0) : 0; };
  const spend = total('spend'), purchases = total('purchases'), revenue = total('revenue');
  return { spend: round(spend), purchases: round(purchases, 0), revenue: round(revenue), cpa: purchases > 0 ? round(spend / purchases) : null, roas: spend > 0 && list.some(c => isNum(c.revenue)) ? round(revenue / spend) : null };
};
const sumAll = list => {
  const total = key => { const known = list.map(c => c[key]).filter(isNum); return known.length ? known.reduce((a, b) => a + b, 0) : 0; };
  return { spend: round(total('spend')), purchases: round(total('purchases'), 0), revenue: round(total('revenue')) };
};

// Account level: the same test over the campaigns that are expected to leave pixel events (sales and site traffic), summed together.
const accountSuspect = list => {
  if (!list.length) return false;
  const sum = key => (list.every(c => isNum(c[key])) ? list.reduce((a, c) => a + c[key], 0) : null);
  return trackingSuspect({ spend: sum('spend'), content: sum('content'), carts: sum('carts'), checkout: sum('checkout'), purchases: sum('purchases') }, 'sales');
};

// The stored group when it is one of the closed list, otherwise recomputed from the raw Meta fields (old snapshots: "other").
const storedGroup = entry => (isGroup(entry?.objective_group) ? entry.objective_group : null);

async function pixelFacts(store, windows, D, env) {
  const dates = days(windows.C.from, windows.C.to);
  const raw = await store(['MGET', ...dates.map(d => K.snap('pixel', d))]);
  // Web and server events can describe the same purchase (deduplicated by event id), so they are reported apart and never summed.
  const totals = { web: null, server: null };
  let complete = true;
  for (const text of raw || []) {
    const purchase = parse(text)?.events?.Purchase;
    if (![purchase?.web, purchase?.server].some(isNum)) { complete = false; continue; }
    for (const source of ['web', 'server']) if (isNum(purchase?.[source])) totals[source] = (totals[source] ?? 0) + purchase[source];
  }
  const emqDates = Array.from({ length: FATIGUE_LOOKBACK_DAYS + 1 }, (_, i) => shift(D, -i));
  const emqRaw = await store(['MGET', ...emqDates.map(d => K.snap('emq', d))]);
  const emqDocs = (emqRaw || []).map(parse);
  const emqAt = emqDocs.findIndex(doc => isNum(doc?.score));
  const emq = emqAt >= 0 ? emqDocs[emqAt] : null;
  const emqScore = emq ? round(emq.score, 1) : null;
  const emq_as_of = emq ? emqDates[emqAt] : null;
  // A pixel shared by another business exposes only the events Meta attributes to the ads (plus EMQ). That is the design, not a fault.
  if (!pixelStatsEnabled(env)) return { complete: true, facts: { full_stats: 'not_available_by_design', events_source: 'ad_attributed', purchase_events_web_7d: null, purchase_events_server_7d: null, emq: emqScore, emq_as_of } };
  return { complete, facts: { full_stats: 'available', purchase_events_web_7d: complete ? totals.web : null, purchase_events_server_7d: complete ? totals.server : null, emq: emqScore, emq_as_of } };
}

// Returns the facts object, or null when no usable fatigue snapshot exists (run fails with stage no_facts).
// `recentSource` (optional, live and already cached by the caller) returns the daily campaign rows of D-30..D. With it the facts
// carry `recent` (D-2..D, provisional; the playbook keeps it out of every decision) and, when `wide`, the 30-day block for the chat.
// A failing source never fails the facts: the block becomes {unavailable: true}.
export async function buildFacts({ store, D, env = {}, recentSource, wide = false }) {
  const found = await newestFatigue(store, D);
  if (!found) return null;
  const { doc, date } = found;
  const windows = { C: { from: doc.windows.C.from, to: doc.windows.C.to }, B: { from: doc.windows.B.from, to: doc.windows.B.to } };
  const gaps = [];
  if (date !== D) gaps.push(`fatigue_snapshot_from_${date}`);

  const targets = { cpa: positive(env.TARGET_CPA), roas: positive(env.TARGET_ROAS) };
  const hasTargets = targets.cpa !== null || targets.roas !== null;

  const pixel = await pixelFacts(store, windows, D, env);
  if (!pixel.complete) gaps.push('pixel_days_missing');

  const byId = list => new Map(list.filter(c => c?.id !== undefined).map(c => [String(c.id), c]));
  const cur = byId(doc.campaigns.C), base = byId(doc.campaigns.B);
  const ids = [...new Set([...cur.keys(), ...base.keys()])];

  // Group per ad first (stored group, else the raw fields), then per campaign (stored group, else its ad sets, else its objective).
  const adGroup = a => storedGroup(a) || objectiveGroup(a);
  const adGroupsOf = new Map();
  for (const a of doc.ads) if (a?.id !== undefined && a.campaign_id !== null && a.campaign_id !== undefined) adGroupsOf.set(String(a.campaign_id), [...(adGroupsOf.get(String(a.campaign_id)) || []), adGroup(a)]);
  const campaignGroupOf = id => {
    const entry = cur.get(id) || base.get(id);
    return storedGroup(entry) || campaignGroup(entry?.objective, adGroupsOf.get(id) || []);
  };

  const campaigns = ids.map(id => {
    const c = cur.get(id), b = base.get(id), group = campaignGroupOf(id);
    return { id, name: clean((c || b).name), objective_group: group, ...flag(c, group), C: windowFacts(c, true, group), B: windowFacts(b, true, group) };
  }).sort((a, b) => (b.C?.spend ?? -1) - (a.C?.spend ?? -1) || (a.id < b.id ? -1 : 1)).slice(0, MAX_CAMPAIGNS);

  // An old snapshot (written before revenue was stored with the window) leaves ROAS unknown rather than mixing two sources.
  if (campaigns.some(c => PURCHASE_GROUPS.has(c.objective_group) && c.C && c.C.revenue === null)) gaps.push('sales_revenue_incomplete');

  const ads = doc.ads.filter(a => a?.id !== undefined).map(a => {
    const group = adGroup(a);
    return {
      id: String(a.id), campaign_id: a.campaign_id === null || a.campaign_id === undefined ? null : String(a.campaign_id), name: clean(a.name), objective_group: group,
      ...flag(a.C, group), delivery: typeof a.delivery === 'string' ? a.delivery : null, fatigue_state: typeof a.state === 'string' ? a.state : 'INSUFFICIENT_SAMPLE', signals: a.signals && typeof a.signals === 'object' ? a.signals : null,
      C: windowFacts(a.C, false, group), B: windowFacts(a.B, false, group),
    };
  }).sort((a, b) => (b.C?.spend ?? -1) - (a.C?.spend ?? -1) || (a.id < b.id ? -1 : 1)).slice(0, MAX_ADS);

  // Weekly history computed by code from the stored snapshots; absent until the first journal row exists.
  const journal = journalFacts(await readJournal({ store, D }), D);
  const salesOnly = list => list.filter(c => PURCHASE_GROUPS.has(campaignGroupOf(String(c?.id))));
  const account = { C: sumAccount(salesOnly(doc.campaigns.C)), B: sumAccount(salesOnly(doc.campaigns.B)), ...(accountSuspect(doc.campaigns.C.filter(c => TRACKING_GROUPS.has(campaignGroupOf(String(c?.id))))) ? { tracking_suspect: true } : {}) };
  const reference = targets.cpa ?? account.B.cpa ?? account.C.cpa ?? null;
  let live = {};
  if (typeof recentSource === 'function') {
    try {
      const rows = cleanRows(await recentSource());
      if (!rows) throw new Error('shape');
      const groupOf = (id, objective) => (cur.has(id) || base.has(id) ? campaignGroupOf(id) : campaignGroup(objective, []));
      live = recentFacts({ rows, D, wide, groupOf });
    } catch { live = { recent: { unavailable: true } }; }
  }
  return {
    // Every amount in these facts is in this currency; days are days of this time zone.
    currency: activeProfile().currency,
    timezone: activeProfile().timezone,
    as_of: windows.C.to,
    windows,
    targets: hasTargets ? targets : null,
    account,
    account_all: { C: sumAll(doc.campaigns.C), B: sumAll(doc.campaigns.B) },
    gates: { min_impressions: FATIGUE.MIN_IMPRESSIONS, min_spend: minSpendFor(env), min_purchases: FATIGUE.MIN_PURCHASES, stop_min_spend_c: reference === null ? null : round(reference * 2) },
    campaigns,
    ads,
    pixel: pixel.facts,
    ...live,
    ...(journal ? { journal } : {}),
    data_gaps: gaps.sort(),
  };
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

// `memory` is the <memory> block sent next to the facts: a changed note is a changed input.
export const inputHash = (facts, model, skillVersion = SKILL_VERSION, memory = '') => createHash('sha256').update(canonicalJson(facts) + PLAYBOOK_VERSION + skillVersion + model + memory).digest('hex');
