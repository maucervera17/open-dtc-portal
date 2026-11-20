import {transcribeAd} from './transcription.js';
import {createIntelligence} from './intelligence.js';
import {seedLibrary} from './seed.js';
import {createInspiration, InspirationError} from './service.js';
export function validateInspiration(source, mode) {
  const s=source||{};const validString=(v,n)=>typeof v==='string'&&v.length<=n;
  const id=v=>validString(v,80)&&/^[\w-]+$/.test(v);
  const bad=()=>{throw new InspirationError('invalid_input');};
  if(mode==='board'){if(!validString(s.name,60)||!s.name.trim())bad();return {name:s.name.trim()};}
  if(mode==='capture'){
    if(!/^\d{1,25}$/.test(s.id)||!validString(s.page_name,120)||!s.page_name.trim())bad();
    const out={id:s.id,page_name:s.page_name};
    for(const k of ['body','image_url','video_url','landing_url','page_url','started_at','ended_at','page_id']){if(s[k]!=null&&!validString(s[k],k==='body'?8000:4000))bad();out[k]=s[k]||null;}
    out.is_active=typeof s.is_active==='boolean'?s.is_active:null;return out;
  }
  if(mode==='organize'){if(!id(s.id)||!Array.isArray(s.board_ids)||s.board_ids.length>10||s.board_ids.some(v=>!id(v)))bad();return {id:s.id,board_ids:[...new Set(s.board_ids)]};}
  if(mode==='discover'){
    const out={query:s.query,country:s.country,media:s.media,more:s.more===true,status:s.status??'ACTIVE',sort:s.sort??'relevancy_monthly_grouped',language:s.language??'ALL',matching:s.matching??'keyword_unordered'};
    if(!validString(out.query,100)||out.query.trim().length<2||!['MX','ALL','US','ES','CO','AR','CL','GB','DE','FR','CA','AU'].includes(out.country)||!['ALL','IMAGE','VIDEO'].includes(out.media)||!['ALL','ACTIVE','INACTIVE'].includes(out.status)||!['total_impressions','relevancy_monthly_grouped'].includes(out.sort)||!['ALL','ES','EN','PT','FR','DE'].includes(out.language)||!['keyword_unordered','keyword_exact_phrase'].includes(out.matching)||(s.more!==undefined&&typeof s.more!=='boolean'))bad();out.query=out.query.trim();return out;
  }
  if(mode==='search'){if(!validString(s.query,100)||s.query.trim().length<2)bad();return {query:s.query.trim()};}
  if(mode==='profile'){
    const out={};for(const k of ['product','audience','offer','proof','constraints','goal']){if(!validString(s[k],2000))bad();out[k]=s[k];}return out;
  }
  if(mode==='action'){
    if(!id(s.id)||!['1','2','3'].includes(s.action_id)||!['pendiente','produccion','prueba','ganador','descartado'].includes(s.status)||!validString(s.result,2000))bad();
    return {id:s.id,action_id:s.action_id,status:s.status,result:s.result};
  }
  if(mode==='brand'){
    if(!validString(s.name,100)||!s.name.trim()||!validString(s.website,500)||(s.id!==undefined&&!id(s.id))||(s.page_id!==undefined&&s.page_id!==''&&!/^\d{1,25}$/.test(s.page_id))||(s.auto!==undefined&&typeof s.auto!=='boolean'))bad();
    return {id:s.id,name:s.name.trim(),website:s.website,page_id:s.page_id||null,auto:s.auto||false};
  }
  if(!id(s.id))bad();
  if(mode==='follow'){if(s.page_id!==undefined&&!/^\d{1,25}$/.test(s.page_id))bad();return {id:s.id,page_id:s.page_id};}
  if(mode==='analyze'){if(s.media!==undefined&&typeof s.media!=='boolean')bad();return {id:s.id,media:s.media===true};}
  if(mode==='sync'){if(s.more!==undefined&&typeof s.more!=='boolean')bad();if(s.status!==undefined&&!['ACTIVE','INACTIVE','ALL'].includes(s.status))bad();return {id:s.id,more:s.more||false,status:s.status||'ACTIVE'};}
  if(mode==='note'){
    if(typeof s.favorite!=='boolean'||!validString(s.collection,80)||!validString(s.notes,2000)||!Array.isArray(s.tags)||s.tags.length>12||s.tags.some(t=>!validString(t,40)))bad();
    return {id:s.id,favorite:s.favorite,collection:s.collection,notes:s.notes,tags:s.tags};
  }
  return {id:s.id};
}
const wrap=fn=>async ctx=>{
  if(ctx.env.INSPIRATION_ENABLED!=='true')return {status:404,body:{error:'disabled'}};
  try{if(ctx.env.VERCEL_ENV==='production')await seedLibrary(ctx.store);return {status:200,body:await fn(createInspiration(ctx),ctx.params,ctx)}}catch(e){return {status:e instanceof InspirationError?e.status:503,body:{error:e instanceof InspirationError?e.code:['transcription_failed','transcription_busy','transcription_unavailable','video_too_long','ai_disabled','busy','no_ads','plan_limit','analysis_incomplete','media_unavailable','media_too_large','archive_limit','archive_unavailable','ai_busy','ai_unavailable'].includes(e.message)?e.message:'inspiration_unavailable'}};}
};
export const inspirationRoutes={
  'inspiration/transcribe':wrap((s,p,c)=>transcribeAd(p.id,c)),
  'inspiration/transcript':wrap(async(s,p,c)=>{const raw=await c.store(['GET','dtc:inspiration:transcript:'+p.id]);return raw?JSON.parse(raw):null;}),
  'inspiration/enrich':wrap((s,p)=>s.enrich(p.id)),
  'inspiration/capture':wrap((s,p)=>s.capture(p)),
  'inspiration/board':wrap((s,p)=>s.createBoard(p)),
  'inspiration/organize':wrap((s,p)=>s.organize(p)),
  'inspiration/follow':wrap((s,p)=>s.follow(p.id,p.page_id)),
  'inspiration/progress':wrap((s,p,c)=>createIntelligence({...c,service:s}).progress()),
  'inspiration/intelligence':wrap((s,p,c)=>createIntelligence({...c,service:s}).overview()),
  'inspiration/profile':wrap((s,p,c)=>createIntelligence({...c,service:s}).profile(p)),
  'inspiration/plan':wrap((s,p,c)=>createIntelligence({...c,service:s}).generate()),
  'inspiration/action':wrap((s,p,c)=>createIntelligence({...c,service:s}).update(p)),
  'inspiration/archive':wrap((s,p)=>s.archive(p.id)),
  'inspiration/discover':wrap((s,p)=>s.discover(p)),
  'inspiration/search':wrap((s,p)=>s.search(p.query)),
  inspiration:wrap(s=>s.list()),
  'inspiration/brand':wrap((s,p)=>s.upsert(p)),
  'inspiration/sync':wrap((s,p)=>s.sync(p.id,p.more,p.status)),
  'inspiration/note':wrap((s,p)=>s.annotate(p)),
  'inspiration/analysis':wrap((s,p)=>s.getAnalysis(p.id)),
  'inspiration/analyze':wrap((s,p)=>s.analyze(p.id,p.media)),
};
