import { shift } from '../dates.js';
import { cleanName } from '../text.js';

// The most recent days, straight from Meta (live, provisional). Meta may still adjust them, so the daily agent's decision rules
// never use them; they exist so the chat can answer "did we sell anything lately?". Built by code from daily campaign rows
// ({date, id, name, objective, m: {spend, purchases, revenue, content, carts, checkout}}), so no number is ever model-made.
export const RECENT_DAYS = 3; // D-2..D
export const WIDE_DAYS = 30; // D-30..D
const MAX_RECENT_CAMPAIGNS = 8;
const MAX_WIDE_CAMPAIGNS = 10;
const NAME_CHARS = 120;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const round = (v, places = 2) => Math.round(v * 10 ** places) / 10 ** places;
const KEYS = ['spend', 'purchases', 'revenue', 'content', 'carts', 'checkout'];

// Rows that are not well formed are dropped; a payload without a row list is unusable (null).
export function cleanRows(data) {
  if (!data || !Array.isArray(data.rows)) return null;
  return data.rows.filter(r => r && ISO.test(String(r.date)) && r.id !== undefined && r.id !== null && r.m && typeof r.m === 'object')
    .map(r => ({ date: String(r.date), id: String(r.id), name: cleanName(r.name, NAME_CHARS), objective: r.objective ?? null, m: r.m }));
}

const sum = (rows, key) => rows.reduce((a, r) => a + (isNum(r.m[key]) ? r.m[key] : 0), 0);

function totals(rows, { funnel = false } = {}) {
  const spend = sum(rows, 'spend'), purchases = sum(rows, 'purchases'), revenue = sum(rows, 'revenue');
  return {
    spend: round(spend), purchases: round(purchases, 0), revenue: round(revenue),
    ...(purchases > 0 ? { cpa: round(spend / purchases) } : {}),
    roas: spend > 0 ? round(revenue / spend) : null,
    ...(funnel ? { content: round(sum(rows, 'content'), 0), carts: round(sum(rows, 'carts'), 0), checkout: round(sum(rows, 'checkout'), 0) } : {}),
  };
}

// Per campaign, busiest first: purchases, then spend, then id.
function byCampaign(rows, groupOf, { funnel, cap }) {
  const groups = new Map();
  for (const r of rows) groups.set(r.id, [...(groups.get(r.id) || []), r]);
  return [...groups.entries()]
    .map(([id, list]) => ({ id, name: list[0].name, objective_group: groupOf(id, list[0].objective), ...totals(list, { funnel }) }))
    .sort((a, b) => b.purchases - a.purchases || b.spend - a.spend || (a.id < b.id ? -1 : 1))
    .slice(0, cap);
}

const days = (from, to) => { const out = []; for (let d = from; d <= to; d = shift(d, 1)) out.push(d); return out; };

// `rows` are cleanRows output. `wide` adds the 30-day summary and last_purchase (chat only).
export function recentFacts({ rows, D, wide = false, groupOf }) {
  const from = shift(D, -(RECENT_DAYS - 1));
  const near = rows.filter(r => r.date >= from && r.date <= D);
  const recent = {
    from, to: D, provisional: true,
    account: totals(near, { funnel: true }),
    days: days(from, D).map(date => ({
      date, provisional: true, ...(date === D ? { today_partial: true } : {}), ...(({ spend, purchases, revenue }) => ({ spend, purchases, revenue }))(totals(near.filter(r => r.date === date))),
    })),
    campaigns: byCampaign(near, groupOf, { funnel: true, cap: MAX_RECENT_CAMPAIGNS }),
  };
  if (!wide) return { recent };

  const start = shift(D, -WIDE_DAYS);
  const month = rows.filter(r => r.date >= start && r.date <= D);
  const last_30d = { from: start, to: D, account: totals(month), campaigns: byCampaign(month, groupOf, { funnel: false, cap: MAX_WIDE_CAMPAIGNS }) };
  const sold = month.filter(r => isNum(r.m.purchases) && r.m.purchases > 0);
  const newest = sold.map(r => r.date).sort().at(-1);
  const last_purchase = newest ? (() => {
    const list = sold.filter(r => r.date === newest);
    return { date: newest, purchases: round(sum(list, 'purchases'), 0), revenue: round(sum(list, 'revenue')), campaigns: [...new Set(list.map(r => r.name))], provisional: newest >= from };
  })() : null;
  return { recent, last_30d, last_purchase };
}
