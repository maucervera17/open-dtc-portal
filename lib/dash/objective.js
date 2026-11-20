// Every campaign is judged by what it is for. Meta states that in three fields: the campaign objective, the ad set
// optimization_goal and the ad set destination_type. They are folded into one closed group so a profile-growth campaign is
// never read as a failed sales campaign. Unknown or missing values fall to "other".
export const OBJECTIVE_GROUPS = Object.freeze(['sales', 'traffic_site', 'profile_growth', 'engagement', 'leads', 'awareness', 'other']);

// Only these two can be told apart from a tracking outage: they are expected to leave pixel events behind.
export const TRACKING_GROUPS = Object.freeze(new Set(['sales', 'traffic_site']));

// Groups whose success is measured in purchases (other stays here: an unknown objective keeps the old sales-first reading).
export const PURCHASE_GROUPS = Object.freeze(new Set(['sales', 'other']));

const upper = value => (typeof value === 'string' ? value.trim().toUpperCase() : '');
const has = (set, value) => value !== '' && set.has(value);

const PROFILE_GOALS = new Set(['PROFILE_VISIT', 'VISIT_INSTAGRAM_PROFILE', 'PAGE_LIKES', 'PROFILE_AND_PAGE_ENGAGEMENT']);
const LEAD_OBJECTIVES = new Set(['OUTCOME_LEADS', 'LEAD_GENERATION']);
const SALES_OBJECTIVES = new Set(['OUTCOME_SALES', 'CONVERSIONS', 'PRODUCT_CATALOG_SALES']);
const SALES_GOALS = new Set(['OFFSITE_CONVERSIONS', 'VALUE']);
const TRAFFIC_GOALS = new Set(['LINK_CLICKS', 'LANDING_PAGE_VIEWS']);
const ENGAGEMENT_OBJECTIVES = new Set(['OUTCOME_ENGAGEMENT', 'POST_ENGAGEMENT', 'VIDEO_VIEWS', 'EVENT_RESPONSES']);
const ENGAGEMENT_GOALS = new Set(['POST_ENGAGEMENT', 'THRUPLAY', 'ENGAGED_USERS', 'EVENT_RESPONSES']);
const AWARENESS_OBJECTIVES = new Set(['OUTCOME_AWARENESS', 'BRAND_AWARENESS', 'REACH']);
const AWARENESS_GOALS = new Set(['REACH', 'IMPRESSIONS', 'AD_RECALL_LIFT']);

export function objectiveGroup(fields) {
  const { objective, optimization_goal: goal, destination_type: destination } = fields && typeof fields === 'object' ? fields : {};
  const obj = upper(objective), opt = upper(goal), dest = upper(destination);
  // The destination and goal are the most specific signals: a profile-traffic campaign has the OUTCOME_TRAFFIC objective too.
  if (dest === 'INSTAGRAM_PROFILE' || has(PROFILE_GOALS, opt)) return 'profile_growth';
  if (has(LEAD_OBJECTIVES, obj)) return 'leads';
  if (has(SALES_OBJECTIVES, obj) || has(SALES_GOALS, opt)) return 'sales';
  if (obj === 'LINK_CLICKS' || has(TRAFFIC_GOALS, opt)) return 'traffic_site';
  if (obj === 'OUTCOME_TRAFFIC') return dest === 'WEBSITE' ? 'traffic_site' : 'other';
  if (has(ENGAGEMENT_OBJECTIVES, obj) || has(ENGAGEMENT_GOALS, opt)) return 'engagement';
  if (has(AWARENESS_OBJECTIVES, obj) || has(AWARENESS_GOALS, opt)) return 'awareness';
  if (has(LEAD_OBJECTIVES, obj) || opt === 'LEAD_GENERATION' || opt === 'QUALITY_LEAD') return 'leads';
  return 'other';
}

export const isGroup = value => typeof value === 'string' && OBJECTIVE_GROUPS.includes(value);

// A campaign has no ad set fields of its own: when its ad sets agree on one group that group wins, otherwise the objective alone.
export function campaignGroup(objective, adGroups = []) {
  const known = [...new Set(adGroups.filter(g => isGroup(g) && g !== 'other'))];
  return known.length === 1 ? known[0] : objectiveGroup({ objective });
}
