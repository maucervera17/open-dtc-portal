// Fake Meta Graph API (Marketing API, pixel and Instagram) backed by the fictional world. It answers the same GET
// requests lib/meta-client.js and lib/instagram.js send, with the same response shapes, so the real collectors run.
import { ACCOUNT_ID, PIXEL_ID, IG_ID, IG_USERNAME, BRAND, SITE } from './world.js';
import { shift } from '../lib/dates.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const failure = (message, code = 100, status = 400) => json({ error: { message, type: 'OAuthException', code } }, status);
const parseJson = text => { try { return JSON.parse(text); } catch { return null; } };
const dateOfEpoch = seconds => new Date(Number(seconds) * 1000).toISOString().slice(0, 10);

export function createGraph(world, { now = Date.now } = {}) {
  const adById = new Map(world.ads.map(a => [a.id, a]));
  const postById = new Map(world.posts.map(p => [p.id, p]));
  const storyIds = new Map(world.ads.map(a => [a.storyId, a]));

  const creativeOf = ad => ({
    id: String(Number(ad.id) + 1000), object_type: ad.type, body: ad.body, title: ad.name.split('| ')[1] ?? ad.name,
    thumbnail_url: `/demo-media/fbcdn-ad-${ad.key}.png`, image_url: `/demo-media/fbcdn-ad-${ad.key}.png`,
    effective_object_story_id: ad.storyId, instagram_permalink_url: `https://www.instagram.com/p/EXAMPLEAD${ad.index}/`,
    object_story_spec: { link_data: { message: ad.body, name: ad.name.split('| ')[1] ?? ad.name, link: `${SITE}/products/${ad.key}`, call_to_action: { type: 'SHOP_NOW' } } },
  });
  const statusFilter = params => {
    const filtering = parseJson(params.get('filtering'));
    const fromFilter = Array.isArray(filtering) ? filtering.find(f => f?.field === 'effective_status')?.value : null;
    const direct = parseJson(params.get('effective_status'));
    return Array.isArray(fromFilter) ? fromFilter : Array.isArray(direct) ? direct : null;
  };
  const adObject = ad => ({
    id: ad.id, name: ad.name, effective_status: ad.status, adset_id: ad.adsetId, campaign_id: ad.campaignId,
    adset: { name: ad.adsetName, effective_status: ad.adset.status, end_time: ad.adset.endTime, optimization_goal: ad.adset.goal, destination_type: ad.adset.dest },
    campaign: { name: ad.campaignName, effective_status: ad.campaign.status, stop_time: null, objective: ad.campaign.objective },
    creative: creativeOf(ad),
  });

  function igInsights(params) {
    const dates = [];
    const since = dateOfEpoch(params.get('since')), until = dateOfEpoch(Number(params.get('until')) - 1);
    for (let d = since; d <= until; d = shift(d, 1)) dates.push(d);
    const days = dates.map(world.igDay);
    const total = key => days.reduce((a, d) => a + (d[key] ?? 0), 0);
    if (params.get('breakdown') === 'follow_type') {
      return { data: [{ name: 'follows_and_unfollows', period: 'day', total_value: { value: total('follows') + total('unfollows'), breakdowns: [{ dimension_keys: ['follow_type'], results: [
        { dimension_values: ['FOLLOWER'], value: total('follows') }, { dimension_values: ['NON_FOLLOWER'], value: total('unfollows') },
      ] }] } }] };
    }
    return { data: String(params.get('metric') || '').split(',').filter(Boolean).map(name => ({ name, period: 'day', total_value: { value: total(name) } })) };
  }

  function pixelStats(params) {
    const source = params.get('event_source') === 'SERVER_ONLY' ? 'server' : 'web';
    const first = dateOfEpoch(params.get('start_time')), last = dateOfEpoch(Number(params.get('end_time')) - 1);
    const today = world.D;
    const data = [];
    for (let d = first; d <= last && d <= today; d = shift(d, 1)) {
      const counts = world.pixelDay(d)[source];
      data.push({ start_time: `${d}T06:00:00.000Z`, data: Object.entries(counts).map(([value, count]) => ({ value, count: Math.round(count) })) });
    }
    return { data };
  }

  return async function graphFetch(input) {
    const url = input instanceof URL ? input : new URL(String(input));
    const p = url.searchParams;
    const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop the version
    const [head, tail] = parts;
    if (head === `act_${ACCOUNT_ID}`) {
      switch (tail) {
        case undefined: return json({ id: `act_${ACCOUNT_ID}`, account_id: ACCOUNT_ID, name: `${BRAND} (demo)`, currency: world.profile.currency, timezone_name: world.profile.timezone });
        case 'insights': {
          const range = parseJson(p.get('time_range'));
          if (!range?.since || !range?.until) return failure('time_range required');
          return json({ data: world.insights({ level: p.get('level') || 'account', range, increment: p.get('time_increment'), breakdowns: p.get('breakdowns') }) });
        }
        case 'campaigns': {
          const only = statusFilter(p);
          return json({ data: world.campaigns.filter(c => !only || only.includes(c.status)).map(c => ({ id: c.id, name: c.name, objective: c.objective, effective_status: c.status, stop_time: null, daily_budget: world.budgetOf(c.budget) })) });
        }
        case 'adsets': {
          const only = statusFilter(p);
          return json({ data: world.adsets.filter(s => !only || only.includes(s.status)).map(s => ({
            id: s.id, name: s.name, campaign_id: s.campaignId, effective_status: s.status, end_time: s.endTime, start_time: `${shift(world.D, -70)}T00:00:00${world.offsetAt(shift(world.D, -70))}`,
            daily_budget: world.budgetOf(30000), optimization_goal: s.goal, destination_type: s.dest,
            targeting: { geo_locations: { countries: ['US'] }, age_min: 25, age_max: 54, ...(s.key === 'lookalike' ? { custom_audiences: [{ id: '6001' }] } : {}) },
            learning_stage_info: { status: 'SUCCESS' }, attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 7 }],
          })) });
        }
        case 'ads': {
          const only = statusFilter(p);
          return json({ data: world.ads.filter(a => !only || only.includes(a.status)).map(adObject) });
        }
        case 'adspixels': return json({ data: [{ id: PIXEL_ID, name: `${BRAND} Pixel`, is_unavailable: false }] });
        default: return failure('Unknown edge');
      }
    }
    if (head === 'dataset_quality') {
      return json({ web: [['Purchase', 8.1], ['AddToCart', 7.9], ['InitiateCheckout', 7.6], ['ViewContent', 7.4]].map(([event_name, composite_score]) => ({ event_name, event_match_quality: { composite_score } })) });
    }
    if (/^\d+$/.test(head || '')) {
      if (tail === undefined) {
        if (head === PIXEL_ID) return json({ id: PIXEL_ID, name: `${BRAND} Pixel`, last_fired_time: new Date(now() - 4 * 60000).toISOString(), is_unavailable: false });
        if (head === IG_ID) return json({ id: IG_ID, username: IG_USERNAME, followers_count: world.followersOn(world.D), media_count: 214 });
        const ad = adById.get(head);
        if (ad) return json({ ...adObject(ad), account_id: ACCOUNT_ID });
        return failure('Unsupported get request');
      }
      if (tail === 'stats' && head === PIXEL_ID) return json(pixelStats(p));
      if (tail === 'insights' && head === IG_ID) return json(igInsights(p));
      if (tail === 'insights' && postById.has(head)) {
        const metrics = postById.get(head).metrics;
        return json({ data: String(p.get('metric') || '').split(',').filter(Boolean).map(name => ({ name, period: 'lifetime', values: [{ value: metrics[name] ?? 0 }] })) });
      }
      if (tail === 'media' && head === IG_ID) return json({ data: world.posts.slice(0, Number(p.get('limit')) || 25).map(({ metrics, ...post }) => post) });
      if (tail === 'previews') return json({ data: [] }); // no Facebook-hosted preview exists for a fictional ad
    }
    if (/^\d+_\d+$/.test(head || '') && tail === 'comments') {
      if (!storyIds.has(head)) return json({ data: [] });
      return json({ data: world.comments.map(([message, like_count], i) => ({ id: `${head}_${i + 1}`, message, created_time: `${shift(world.D, -(i + 1))}T15:00:00+0000`, like_count })) });
    }
    return failure('Unsupported get request');
  };
}

