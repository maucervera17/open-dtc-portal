import { activeProfile } from '../locale.js';
import { readMetrics } from '../model.js';
import { provisionalFrom, adjustableFrom } from './range.js';

// Pixel event types. Same action types the legacy readMetrics uses, so numbers agree with the reports.
export const ACTION = Object.freeze({
  content: 'offsite_conversion.fb_pixel_view_content',
  carts: 'offsite_conversion.fb_pixel_add_to_cart',
  checkout: 'offsite_conversion.fb_pixel_initiate_checkout',
  purchases: 'offsite_conversion.fb_pixel_purchase',
});

const numeric = value => (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value));
// Meta omits action types whose count is zero. For a row that exists (the account delivered) a missing action is 0;
// only a missing row (no delivery at all) is N/D, and that case never reaches this function.
const actionValue = (list, type) => {
  const found = Array.isArray(list) ? list.find(a => a?.action_type === type) : undefined;
  return found === undefined ? 0 : numeric(found.value);
};
const divide = (a, b) => (a === null || b === null || b <= 0 ? null : a / b);

const exactAction = (list, types) => {
  for (const type of types) {
    const found = Array.isArray(list) ? list.find(a => a?.action_type === type) : undefined;
    if (found !== undefined && numeric(found.value) !== null) return numeric(found.value);
  }
  return null;
};

export const EMPTY_METRICS = Object.freeze({
  spend: null, impressions: null, reach: null, clicks: null, content: null, carts: null, checkout: null, purchases: null,
  revenue: null, cpa: null, roas: null, ctr: null, cpm: null, roas_reported: null, content_all: null, carts_all: null, checkout_all: null,
});

// Raw numbers only: ctr is a ratio, money is in the account currency (envelope.currency). Formatting belongs to the client.
export function readDashMetrics(row) {
  if (!row) return { ...EMPTY_METRICS };
  const base = readMetrics(row);
  const purchases = actionValue(row.actions, ACTION.purchases);
  const revenue = actionValue(row.action_values, ACTION.purchases);
  const spend = base.spend, impressions = base.impressions, clicks = base.clicks;
  return {
    spend, impressions, reach: base.reach, clicks,
    content: actionValue(row.actions, ACTION.content),
    carts: actionValue(row.actions, ACTION.carts),
    checkout: actionValue(row.actions, ACTION.checkout),
    purchases, revenue,
    // Omni totals include actions inside Instagram and Facebook. Secondary on purpose: the website counts above are the ones that
    // line up with purchases. Unknown (null) when Meta did not report them, never 0.
    content_all: exactAction(row.actions, ['omni_view_content']), carts_all: exactAction(row.actions, ['omni_add_to_cart']), checkout_all: exactAction(row.actions, ['omni_initiated_checkout']),
    cpa: purchases !== null && purchases > 0 ? divide(spend, purchases) : null, // no purchases, no CPA
    roas: divide(revenue, spend),
    ctr: divide(clicks, impressions),
    cpm: impressions !== null && impressions > 0 && spend !== null ? (spend / impressions) * 1000 : null,
    roas_reported: Array.isArray(row.purchase_roas) ? numeric(row.purchase_roas[0]?.value) : null,
  };
}

// Counts the non-sales objectives are judged by. Profile visits and follows are N/D (null) when Meta reports neither the
// field nor the action, never a made-up 0; link clicks and reach come from the row itself.
export function readObjectiveMetrics(row) {
  if (!row) return {};
  const base = readMetrics(row);
  return {
    reach: base.reach, link_clicks: base.clicks,
    landing_page_views: actionValue(row.actions, 'landing_page_view'),
    profile_visits: numeric(row.instagram_profile_visits) ?? exactAction(row.actions, ['instagram_profile_visit', 'onsite_conversion.instagram_profile_visit']),
    follows: exactAction(row.actions, ['instagram_follow', 'onsite_conversion.instagram_follow']),
    interactions: actionValue(row.actions, 'post_engagement'),
    cpm: Number(row.impressions) > 0 && base.spend !== null ? (base.spend / Number(row.impressions)) * 1000 : null,
  };
}

// Step conversion: each step over the previous one. A missing or zero denominator is null.
export function funnelOf(m) {
  return {
    content: m.content, carts: m.carts, checkout: m.checkout, purchases: m.purchases,
    content_all: m.content_all ?? null, carts_all: m.carts_all ?? null, checkout_all: m.checkout_all ?? null,
    rates: { carts: divide(m.carts, m.content), checkout: divide(m.checkout, m.carts), purchases: divide(m.purchases, m.checkout) },
  };
}

// Fields shared by every data payload.
export const envelope = ({ now, D, range }) => ({
  generated_at: new Date(Number(now())).toISOString(), currency: activeProfile().currency, timezone: activeProfile().timezone, attribution: 'ads_manager_default',
  provisional_from: provisionalFrom(D), adjustable_from: adjustableFrom(D), range,
});
