import {graphUrl,metaGet} from './meta-client.js';
import {accountValues,buildProfile,envOverrides} from './locale.js';
async function query(path, parameters, env, fetcher) {
  const result = [];
  const cursors=new Set();
  let after;
  for (let page = 0; page < 1000; page++) {
    const url = graphUrl(env.META_API_VERSION, path, { ...parameters, limit: '100', ...(after ? { after } : {}) });
    if(env._deadline && Date.now()>env._deadline)throw Error('Extraction deadline reached');
    const response = await metaGet(url, { token: env.META_ACCESS_TOKEN, fetch: fetcher });
    if (!response.ok) throw new Error(`Meta HTTP ${response.status}`);
    const body = await response.json();
    if (body.error || !Array.isArray(body.data)) throw new Error('Invalid Meta response');
    result.push(...body.data);
    if (!body.paging?.next) return result;
    after = body.paging?.cursors?.after;
    if (!after || cursors.has(after)) throw new Error('Meta pagination unavailable or repeated');
    cursors.add(after);
  }
  throw new Error('Meta pagination limit');
}
async function mapLimited(items, fn, concurrency = 3) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{
    while(next<items.length){const i=next++;out[i]=await fn(items[i]);}
  })); return out;
}
export async function collect(window, env, fetcher = fetch) {
  env={...env,_deadline:Date.now()+210000};
  const account = String(env.META_AD_ACCOUNT_ID || '');
  if(!/^\d+$/.test(account)) throw Error('Invalid account ID');
  const accountResponse=await metaGet(graphUrl(env.META_API_VERSION,`act_${account}`,{fields:'id,currency,timezone_name'}),{token:env.META_ACCESS_TOKEN,fetch:fetcher});
  if(!accountResponse.ok)throw Error('Account metadata unavailable');
  const accountInfo=await accountResponse.json();
  // Any currency and time zone is accepted: the account's own values are the source of truth (optionally overridden by env).
  const accountValuesRead=accountValues(accountInfo);
  if(accountInfo.id!==`act_${account}` || !accountValuesRead)throw Error('Account metadata invalid');
  const profile=buildProfile(accountValuesRead,envOverrides(env));
  const warnings = [];
  const fields = 'campaign_id,campaign_name,objective,account_currency,spend,impressions,reach,inline_link_clicks,instagram_profile_visits,actions';
  const params = (since, until) => ({ fields, time_range: JSON.stringify({ since, until }), use_unified_attribution_setting: 'true', action_report_time: 'impression' });
  const [inventory,present,previous,ads,adsets,creativeAds] = await Promise.all([
    query(`act_${account}/campaigns`,{fields:'id,name,objective,effective_status',effective_status:JSON.stringify(['ACTIVE','PAUSED','ARCHIVED'])},env,fetcher),
    query(`act_${account}/insights`,{...params(window.since,window.until),level:'campaign'},env,fetcher),
    query(`act_${account}/insights`,{...params(window.previousSince,window.previousUntil),level:'campaign'},env,fetcher),
    query(`act_${account}/insights`,{...params(window.since,window.until),level:'ad',fields:fields+',ad_id,ad_name'},env,fetcher),
    query(`act_${account}/adsets`,{fields:'id,campaign_id,destination_type,optimization_goal',effective_status:JSON.stringify(['ACTIVE'])},env,fetcher),
    query(`act_${account}/ads`,{fields:'id,creative{instagram_permalink_url,effective_object_story_id}',effective_status:JSON.stringify(['ACTIVE'])},env,fetcher),
  ]);
  for(const row of [...present,...previous]) if(row.account_currency!==accountValuesRead.currency) throw Error('Unexpected currency');
  const campaigns=new Map(inventory.map(c=>[c.id,c]));
  for(const row of [...present,...previous]) if(!campaigns.has(row.campaign_id)) campaigns.set(row.campaign_id,{id:row.campaign_id,name:row.campaign_name,objective:row.objective,effective_status:'UNKNOWN'});
  const breakdowns=await mapLimited(ads,async ad=>{
    const found=[];
    for(const type of ['video_asset','image_asset']) {
      try {
        const rows=await query(`${ad.ad_id}/insights`,{...params(window.since,window.until),fields:'ad_id,ad_name,spend,impressions,inline_link_clicks,instagram_profile_visits,actions',breakdowns:type},env,fetcher);
        found.push(...rows.filter(r=>r[type] && (r[type].id||r[type].hash)).map(r=>({...r,campaign_id:ad.campaign_id,comparisonLevel:'asset'})));
      } catch {
        if(Date.now()>env._deadline)throw Error('Extraction deadline reached');
        warnings.push(`${ad.campaign_name} / ${ad.ad_name}: desglose ${type==='video_asset'?'de video':'de imagen'} no disponible; no se asume que esté completo.`);
      }
    }
    if(!found.length){warnings.push(`${ad.campaign_name} / ${ad.ad_name}: sin desglose de medios; se muestran métricas del anuncio, no de cada arte.`);return [{...ad,comparisonLevel:'ad'}];}
    return found;
  });
  const allAssets=breakdowns.flat().map(a=>{const c=creativeAds.find(x=>x.id===a.ad_id)?.creative;return {...a,postUrl:c?.instagram_permalink_url||(/^\d+_\d+$/.test(c?.effective_object_story_id||'')?'https://www.facebook.com/'+c.effective_object_story_id:null)};});
  const data=Array.from(campaigns.values()).map(c=>({...c,adsets:adsets.filter(a=>a.campaign_id===c.id),current:present.find(r=>r.campaign_id===c.id),previous:previous.find(r=>r.campaign_id===c.id),assets:allAssets.filter(r=>r.campaign_id===c.id)}));
  data.sort((a,b)=>Number(b.current?.spend||0)-Number(a.current?.spend||0)||a.name.localeCompare(b.name));
  if(!data.length)throw Error('No accessible campaigns; cannot report zero performance');
  return {data,warnings,profile,account:accountValuesRead};
}
