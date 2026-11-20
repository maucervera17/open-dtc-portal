import {archiveAd} from './archive.js';
import { analyzeCopy } from './analysis.js';
import { createHash, randomUUID } from 'node:crypto';
import { SEED_BRANDS, normalizeAd, text, safeUrl } from './model.js';
const P = 'dtc:inspiration:';
const json = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
export class InspirationError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }
export const fail = (code, status) => { throw new InspirationError(code, status); };
// Optional lifetime cap; provider mode uses the prepaid balance. Never purchases credits.
const RESERVE = "local n=tonumber(redis.call('GET',KEYS[1]) or '0'); if n>=tonumber(ARGV[1]) then return -1 end; return redis.call('INCR',KEYS[1])";
const UNLOCK = "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end";
export function createInspiration({env, store, fetch: fetcher = fetch, now = Date.now, generateAnalysis = analyzeCopy, agentClient}) {
  const get = async k => json(await store(['GET', P + k]));
  const set = (k,v) => store(['SET',P+k,JSON.stringify(v)]);
  const providerBudget = env.INSPIRATION_BUDGET_MODE === 'provider';
  const configuredCap = Number(env.INSPIRATION_CALL_LIMIT ?? 60);
  const cap = Number.isSafeInteger(configuredCap) && configuredCap >= 0 ? configuredCap : 0;
  const timestamp = () => new Date(now()).toISOString();
  async function locked(k, fn) {
    const token=randomUUID(); if(!await store(['SET',P+'lock:'+k,token,'NX','EX',240])) fail('busy',409);
    try{return await fn();}finally{await store(['EVAL',UNLOCK,1,P+'lock:'+k,token]);}
  }
  async function request(path, params, method='POST') {
    if (!env.SCRAPECREATORS_API_KEY) fail('scraper_not_configured',503);
    return locked('provider',async()=>{
      // A cached zero must not prevent detecting a later top-up. The provider
      // authorizes each request against its current balance; no payment is attempted.
      const reservation=providerBudget?await store(['INCR',P+'calls']):await store(['EVAL',RESERVE,1,P+'calls',cap]);
      if(reservation===-1) fail('call_limit',429);
      let r,d;
      try {r=await fetcher('https://api.scrapecreators.com/v1/facebook/adLibrary/'+path+(method==='GET'?'?'+new URLSearchParams(params):''),{method,headers:{'x-api-key':env.SCRAPECREATORS_API_KEY,'Content-Type':'application/json'},...(method==='POST'?{body:JSON.stringify(params)}:{}),signal:AbortSignal.timeout(55000)});d=await r.json();}
      catch { fail('provider_unavailable',502); }
      if(typeof d.credits_remaining==='number') await set('provider',{remaining:d.credits_remaining,checked_at:timestamp()});
      if(r.status===402 || (d.success===false && d.credits_remaining===0)){await set('provider',{remaining:0,checked_at:timestamp()});fail('credits_exhausted',402);}
      if(!r.ok || d.success===false) fail('provider_unavailable',502);
      return d;
    });
  }
  async function search(query){const d=await request('search/companies',{query},'GET');if(!Array.isArray(d.searchResults))fail('invalid_provider_response',502);return {results:d.searchResults.slice(0,20).filter(b=>/^\d{1,25}$/.test(String(b.page_id))).map(b=>({page_id:String(b.page_id),name:text(b.name,100),instagram:text(b.ig_username,100),category:text(b.category,100)}))};}
  async function discoveryResponse(result,cached){const results=await Promise.all(result.results.map(async ad=>({...ad,...await get('note:'+ad.id)})));return {...result,results,cursor:undefined,cached};}
  async function discover({query,country='MX',media='ALL',more=false,status='ACTIVE',sort='relevancy_monthly_grouped',language='ALL',matching='keyword_unordered'}){
    const key='discovery:'+createHash('sha256').update(JSON.stringify(['v2',query.toLowerCase().trim(),country,media,status,sort,language,matching])).digest('hex');
    return locked(key,async()=>{
      const cached=await get(key);
      if(!more&&cached&&now()-Date.parse(cached.observed_at)<3600000)return discoveryResponse(cached,true);
      if(more&&(!cached?.cursor||cached.pages>=10))fail('no_more_pages');
      const d=await request('search/ads',{query,country,media_type:media,status,search_type:matching,sort_by:sort,...(language!=='ALL'?{language}:{}),ad_type:'all',...(more?{cursor:cached.cursor}:{})});
      if(!Array.isArray(d.searchResults))fail('invalid_provider_response',502);
      const time=timestamp(),known=await brands(),found=new Map((more?cached.results:[]).map(a=>[a.id,a]));
      for(const raw of d.searchResults.slice(0,100)){
        const pageId=String(raw.page_id??raw.snapshot?.page_id??'');if(!/^\d{1,25}$/.test(pageId))continue;
        const b=known.find(b=>b.page_id===pageId)||{id:'discovered-'+pageId,page_id:pageId};
        const ad=normalizeAd(raw,b,time);if(!ad)continue;
        // Search results stay outside the tracked library until the user saves one.
        await store(['SET',P+'ad:'+ad.id,JSON.stringify({...ad,first_seen_at:time}),'NX','EX',86400]);
        const note=await get('note:'+ad.id);found.set(ad.id,{...ad,...note});
      }
      const pages=more?cached.pages+1:1;
      const cursor=typeof d.cursor==='string'&&d.cursor.length<=30000&&d.cursor!==cached?.cursor?d.cursor:null;
      const result={results:[...found.values()],query,country,media,status,sort,language,matching,pages,cursor,has_more:Boolean(cursor)&&pages<10,page_limit:pages>=10,observed_at:time,reported_total:Number.isFinite(d.searchResultsCount)?d.searchResultsCount:(more?cached.reported_total:null),remaining:d.credits_remaining??null};
      await store(['SET',P+key,JSON.stringify(result),'EX',3600]);
      return discoveryResponse(result,false);
    });
  }
  async function brands() {
    const stored=await store(['HGETALL',P+'brands']); const map=Array.isArray(stored)?Object.fromEntries(Array.from({length:stored.length/2},(_,i)=>[stored[i*2],json(stored[i*2+1])])):Object.fromEntries(Object.entries(stored||{}).map(([k,v])=>[k,json(v)]));
    return [...SEED_BRANDS.map(b=>({...b,...map[b.id]})),...Object.values(map).filter(b=>b&&!SEED_BRANDS.some(s=>s.id===b.id))];
  }
  async function brand(id){return (await brands()).find(b=>b.id===id)||fail('brand_not_found',404);}
  async function saveBrand(b){await store(['HSET',P+'brands',b.id,JSON.stringify(b)]);return b;}
  async function list(){
    const ids=await store(['ZREVRANGE',P+'ads',0,999]);
    const values=ids?.length?await store(['MGET',...ids.map(id=>P+'ad:'+id)]):[];
    const notes=ids?.length?await store(['MGET',...ids.map(id=>P+'note:'+id)]):[];
    const archives=ids?.length?await store(['MGET',...ids.map(id=>P+'archive:'+id)]):[];
    return {preview:env.INSPIRATION_PREVIEW==='true',boards:await get('boards')||[],brands:await brands(),ads:values.map((v,i)=>({...json(v),...json(notes[i]),archived_files:Object.keys(json(archives[i])?.files||{})})).filter(a=>a.id),
      calls_used:Number(await store(['GET',P+'calls'])||0),call_limit:providerBudget?null:cap,budget_mode:providerBudget?'provider':'capped',provider:await get('provider'),
      configured:Boolean(env.SCRAPECREATORS_API_KEY),ai_enabled:env.INSPIRATION_AI_ENABLED==='true'&&Boolean(env.GEMINI_API_KEY),
      auto_enabled:env.INSPIRATION_AUTO_ENABLED==='true',archive_enabled:Boolean(env.BLOB_STORE_ID||env.BLOB_READ_WRITE_TOKEN),limit:1000};
  }
  async function upsert(input){
    return locked('brands',async()=>{
      const existing=input.id?await brand(input.id):null;
      if(!existing&&(await brands()).length>=30) fail('brand_limit');
      const b={...existing,id:existing?.id||randomUUID(),name:text(input.name,100),website:safeUrl(input.website),query:text(input.name,100),page_id:input.page_id||null,auto:input.auto===true};
      if(!b.name||!b.website) fail('invalid_brand');
      if(b.page_id&&!/^\d{1,25}$/.test(b.page_id)) fail('invalid_page');
      // Changing advertiser identity starts pagination afresh; old observations retain their own page_id.
      if(existing?.page_id!==b.page_id){b.cursor=null;b.last_import_at=null;}
      return saveBrand(b);
    });
  }
  async function sync(id, more=false, status='ACTIVE'){
    return locked('brand:'+id,async()=>{
      const b=await brand(id); if(!b.page_id) fail('page_required');
      if(more&&(!b.cursor||status!==(b.cursor_status||'ACTIVE'))) fail('no_more_pages');
      if(!more&&b.last_import_at&&now()-Date.parse(b.last_import_at)<60000) fail('recent_import',429);
      const d=await request('company/ads',{pageId:b.page_id,country:'ALL',status,sort_by:'relevancy_monthly_grouped',...(more?{cursor:b.cursor}:{})});
      if(!Array.isArray(d.results)) fail('invalid_provider_response',502);
      const time=timestamp();let added=0,updated=0,skipped=0;
      for(const raw of d.results){
        const a=normalizeAd(raw,b,time);if(!a){skipped++;continue;}
        const old=await get('ad:'+a.id);
        if(!old && Number(await store(['ZCARD',P+'ads']))>=1000){skipped++;continue;}
        await set('ad:'+a.id,{...old,...a,first_seen_at:old?.first_seen_at||time});
        await store(['ZADD',P+'ads',Date.parse(a.started_at||time),a.id]);old?updated++:added++;
      }
      const cursor=typeof d.cursor==='string'&&d.cursor.length<=30000&&d.cursor!==b.cursor?d.cursor:null;
      await saveBrand({...b,cursor,cursor_status:status,last_import_at:time,last_result:{added,updated,skipped,received:d.results.length},last_error:null});
      return {added,updated,skipped,received:d.results.length,has_more:Boolean(cursor),remaining:d.credits_remaining??null};
    });
  }
  async function annotate(input){
    const ad=await get('ad:'+input.id);if(!ad) fail('ad_not_found',404);
    if(input.favorite)await locked('library-save',async()=>{const ids=await store(['ZREVRANGE',P+'ads',0,999]);if(!ids.includes(input.id)&&ids.length>=1000)fail('library_limit');await set('ad:'+input.id,ad);await store(['ZADD',P+'ads',Date.parse(ad.started_at||ad.observed_at),input.id]);});
    const note=await locked('note:'+input.id,async()=>{const old=await get('note:'+input.id)||{};const note={...old,saved_at:old.saved_at||(input.favorite?timestamp():null),favorite:input.favorite,collection:text(input.collection,80),notes:text(input.notes,2000),tags:input.tags.map(t=>text(t,40))};await set('note:'+input.id,note);return note;});
    if(input.favorite&&(env.BLOB_STORE_ID||env.BLOB_READ_WRITE_TOKEN)){try{return {...note,archive:await archive(input.id)};}catch(e){return {...note,archive_error:['media_too_large','archive_limit'].includes(e.message)?e.message:'media_unavailable'};}}return note;
  }

  async function createBoard({name}){return locked('boards',async()=>{const boards=await get('boards')||[];const existing=boards.find(b=>b.name.toLowerCase()===name.toLowerCase());if(existing)return existing;if(boards.length>=50)fail('board_limit');const b={id:randomUUID(),name:text(name,60),created_at:timestamp()};await set('boards',[...boards,b]);return b;});}
  async function organize({id,board_ids}){const boards=await get('boards')||[];if(board_ids.some(id=>!boards.some(b=>b.id===id)))fail('board_not_found');if(!await get('ad:'+id))fail('ad_not_found',404);return locked('note:'+id,async()=>{const old=await get('note:'+id)||{};const note={...old,board_ids};await set('note:'+id,note);return note;});}
  async function capture(input){
    await locked('library-save',async()=>{
      const old=await get('ad:'+input.id),ids=await store(['ZREVRANGE',P+'ads',0,999]);if(!ids.includes(input.id)&&ids.length>=1000)fail('library_limit');
      const time=timestamp(),page_id=/^\d{1,25}$/.test(input.page_id||'')?input.page_id:null;
      const known=page_id?(await brands()).find(b=>b.page_id===page_id):null;
      const date=v=>v&&Number.isFinite(Date.parse(v))&&Date.parse(v)<=now()?new Date(v).toISOString():null;
      const start=date(input.started_at),end=date(input.ended_at);
      const captured={id:input.id,page_id,brand_id:known?.id||'captured-'+(page_id||input.id),page_name:text(input.page_name,120),body:text(input.body),image_url:safeUrl(input.image_url,true),video_url:safeUrl(input.video_url,true),landing_url:safeUrl(input.landing_url),page_url:safeUrl(input.page_url),is_active:input.is_active,started_at:start,ended_at:end&&(!start||end>=start)?end:null,observed_at:time,first_seen_at:time,cards:[],format:input.video_url?'VIDEO':'IMAGE',source_url:`https://www.facebook.com/ads/library/?id=${input.id}`};
      // Existing provider observations remain authoritative; importing never erases their metrics.
      await set('ad:'+input.id,{...captured,...old,...(typeof input.is_active==='boolean'?{is_active:input.is_active,observed_at:time}:{}),...(captured.image_url?{image_url:captured.image_url}:{}),...(captured.video_url?{video_url:captured.video_url}:{}),...(captured.ended_at&&input.is_active===false?{ended_at:captured.ended_at}:{}),capture_source:'chrome_extension',captured_at:time});
      await store(['ZADD',P+'ads',Date.parse(old?.started_at||start||time),input.id]);
    });
    const old=await get('note:'+input.id)||{};return annotate({id:input.id,favorite:true,collection:old.collection||'',notes:old.notes||'',tags:old.tags||[]});
  }
  async function enrich(id){return locked('enrich:'+id,async()=>{const old=await get('ad:'+id);if(!old)fail('ad_not_found',404);const d=await request('ad',{id,get_transcript:'false'},'GET');const pageId=String(d.pageID??d.page_id??'');if(!/^\d{1,25}$/.test(pageId)||String(d.adArchiveID??d.ad_archive_id)!==id)fail('invalid_provider_response',502);const known=(await brands()).find(b=>b.page_id===pageId);const b=known||{id:old.brand_id,page_id:pageId};const fresh=normalizeAd({...d,ad_archive_id:id,page_id:pageId,page_name:d.pageName??d.page_name,is_active:d.isActive??d.is_active,start_date:d.startDate??d.start_date,end_date:d.endDate??d.end_date,collation_count:d.collationCount??d.collation_count},b,timestamp());if(!fresh)fail('invalid_provider_response',502);await set('ad:'+id,{...old,...fresh,first_seen_at:old.first_seen_at});let archive_error=null;if(env.BLOB_STORE_ID||env.BLOB_READ_WRITE_TOKEN){try{await archive(id);}catch{archive_error='media_unavailable';}}return {id,archive_error};});}
  async function follow(id,pageId){const ad=await get('ad:'+id);if(!ad)fail('ad_not_found',404);if(!ad.page_id&&pageId){ad.page_id=pageId;await set('ad:'+id,ad);}if(!ad.page_id)fail('page_required');return locked('brands',async()=>{const all=await brands();let b=all.find(b=>b.page_id===ad.page_id);if(!b){if(all.length>=30)fail('brand_limit');b=await saveBrand({id:'meta-'+ad.page_id,name:ad.page_name,query:ad.page_name,page_id:ad.page_id,website:ad.landing_url||`https://www.facebook.com/${ad.page_id}`,auto:false});}const ids=await store(['ZREVRANGE',P+'ads',0,999]);for(const adId of ids){const item=await get('ad:'+adId);if(item?.page_id===ad.page_id&&item.brand_id!==b.id)await set('ad:'+adId,{...item,brand_id:b.id});}return b;});}
  async function analyze(id,media=false){
    if(env.INSPIRATION_AI_ENABLED!=='true') fail('ai_disabled',403);
    if(!env.GEMINI_API_KEY) fail('ai_not_configured',503);
    return locked('analysis:'+id,async()=>{
      const ad=await get('ad:'+id);if(!ad)fail('ad_not_found',404);
      const analysisKey=(media?'media-analysis:':'analysis:')+id;
      const existing=await get(analysisKey);if(existing&&(!media||typeof existing.transcript==='string'))return existing;
      const day=timestamp().slice(0,10);if(await store(['EVAL',RESERVE,1,P+'ai-calls:'+day,5])===-1)fail('ai_limit',429);
      const archived=media?await get('archive:'+id):null;
      const archivedFile=archived?.files?.[(ad.video_url||ad.archived_files?.includes('video')||archived?.files?.video)?'video':'image'];
      const result={...await generateAnalysis(ad,env,agentClient,media,archivedFile),created_at:timestamp()};
      if(!result.text||(media&&typeof result.transcript!=='string'))fail('analysis_incomplete',502);await set(analysisKey,result);return result;
    });
  }
  async function archive(id){return locked('archive:'+id,async()=>{const ad=await get('ad:'+id);if(!ad)fail('ad_not_found',404);return archiveAd(ad,{env,store,fetch:fetcher});});}
  return {enrich,capture,createBoard,organize,follow,discover,search,archive,brands,brand,list,upsert,sync,annotate,analyze,getAnalysis:async id=>(await get('media-analysis:'+id))||(await get('analysis:'+id))};
}
