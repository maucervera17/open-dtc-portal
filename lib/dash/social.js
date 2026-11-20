import { collectInstagramDaily, collectInstagramPosts } from '../instagram.js';
import { shift } from '../dates.js';
import { writeSnap, datesBetween } from './snapshot.js';
import { K } from './store.js';
import { provisionalFrom, isAdjustable } from './range.js';
import { envelope } from './metrics.js';
import { logEvent } from './log.js';

// followers_count is current-only, so it is stored under the job date from the first run on.
export async function snapshotInstagram({ env, store, fetch, now, D, budget }) {
  const dates = datesBetween(shift(D, -7), shift(D, -1));
  const { followers_count, days, partial } = await collectInstagramDaily(env, { dates, fetch, now, budgetMs: budget });
  if (typeof followers_count === 'number') await writeSnap({ store, module: 'ig-followers', date: D, ref: D, value: followers_count });
  for (const date of dates) await writeSnap({ store, module: 'ig', date, ref: D, value: days[date] });
  return { written: dates.length, partial };
}

// Backfill: IG keeps about 90 days, so callers pass only dates inside that window. Followers are never backfilled.
export async function backfillInstagram({ env, store, fetch, now, D, dates, budget }) {
  const { days } = await collectInstagramDaily(env, { dates, fetch, now, budgetMs: budget });
  for (const date of dates) await writeSnap({ store, module: 'ig', date, ref: D, value: days[date] });
  return { written: dates.length };
}

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const num = v => (isNum(v) ? v : null);
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const sum = values => { const nums = values.filter(isNum); return nums.length ? nums.reduce((a, b) => a + b, 0) : null; };
const ratio = (a, b) => (isNum(a) && isNum(b) && b > 0 ? a / b : null);
const METRICS = ['reach', 'likes', 'accounts_engaged', 'total_interactions', 'views', 'follows', 'unfollows'];

// One stored day, read defensively: anything that is not a finite number is null (never 0). Net is always derived here.
function dayRow(date, doc, D) {
  const source = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc : {};
  const row = { date, ...Object.fromEntries(METRICS.map(k => [k, num(source[k])])) };
  row.net = isNum(row.follows) && isNum(row.unfollows) ? row.follows - row.unfollows : null;
  row.engagement_rate = ratio(row.total_interactions, row.reach);
  row.provisional = date >= provisionalFrom(D);
  row.adjustable = isAdjustable(date, D);
  return row;
}

// Read side of the IG snapshots. Series come from `snap:ig:{date}` (per-day values, Amendment 1); followers from
// `snap:ig-followers:{D}`, keyed by capture date. Only the top-posts block calls Instagram, and it fails soft.
export function createSocialView({ env, store, fetch, now, D }) {
  async function series(days) {
    const dates = datesBetween(shift(D, -days), shift(D, -1));
    const values = await store(['MGET', ...dates.map(date => K.snap('ig', date))]);
    return dates.map((date, i) => dayRow(date, parse(values[i]), D));
  }

  async function followers(days) {
    const dates = datesBetween(shift(D, -days), D);
    const values = await store(['MGET', ...dates.map(date => K.snap('ig-followers', date))]);
    const out = [];
    dates.forEach((date, i) => {
      const count = num(parse(values[i]));
      if (count !== null) out.push({ date, count, provisional: date >= provisionalFrom(D), adjustable: isAdjustable(date, D) });
    });
    return out;
  }

  async function top() {
    try {
      const { profile, posts } = await collectInstagramPosts(env, { fetch, now });
      return { profile, posts, posts_status: 'ok' };
    } catch (error) {
      logEvent('dash_meta', { stage: 'social_posts', code: 'unavailable' });
      return { profile: { followers_count: null, media_count: null }, posts: null, posts_status: 'unavailable' };
    }
  }

  async function social({ days }) {
    const [rows, points, live] = await Promise.all([series(days), followers(days), top()]);
    const totals = Object.fromEntries(METRICS.map(k => [k, sum(rows.map(r => r[k]))]));
    totals.net = isNum(totals.follows) && isNum(totals.unfollows) ? totals.follows - totals.unfollows : null;
    totals.engagement_rate = ratio(totals.total_interactions, totals.reach);
    return {
      ...envelope({ now, D, range: { from: shift(D, -days), to: shift(D, -1) } }),
      ...live, series: rows, followers: points,
      days_expected: rows.length, days_covered: rows.filter(r => METRICS.some(k => isNum(r[k]))).length,
      followers_change: points.length >= 2 ? points.at(-1).count - points[0].count : null,
      // The change is between the first and the last capture, which are not always the ends of the period.
      followers_change_from: points.length >= 2 ? points[0].date : null, followers_change_to: points.length >= 2 ? points.at(-1).date : null,
      totals,
    };
  }

  return { social };
}
