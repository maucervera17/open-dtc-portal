import {graphUrl,metaGet} from './meta-client.js';
import {shift,dayStartMs} from './dates.js';
import {truncate} from './text.js';
const metrics=['reach','profile_views','total_interactions','views','likes','comments','shares','saves'];
export const profileKpis=[['Nuevos seguidores','follows'],['Bajas de seguidores','unfollows'],['Crecimiento neto','net'],['Visitas al perfil','profile_views'],['Visualizaciones','views'],['Cuentas alcanzadas','reach'],['Interacciones','total_interactions'],['Me gusta','likes'],['Comentarios','comments'],['Compartidos','shares'],['Guardados','saves']];
const value=n=>typeof n==='number'&&Number.isFinite(n)?n:null;
export function parseInsights(body){return Object.fromEntries((body.data||[]).map(m=>[m.name,value(m.total_value?.value??m.values?.[0]?.value)]));}
export function parseFollows(body){
 const breakdown=body.data?.find(m=>m.name==='follows_and_unfollows')?.total_value?.breakdowns?.find(b=>b.dimension_keys?.includes('follow_type'));
 const index=breakdown?.dimension_keys.indexOf('follow_type');
 const find=key=>value(breakdown?.results?.find(r=>r.dimension_values?.[index]===key)?.value);
 const follows=find('FOLLOWER'),unfollows=find('NON_FOLLOWER');
 return {follows,unfollows,net:follows!==null&&unfollows!==null?follows-unfollows:null};
}
// Day boundaries are midnight in the account's time zone (daylight saving aware), as unix seconds.
export function insightBounds(since,until,timeZone){return {since:String(dayStartMs(since,timeZone)/1000),until:String(dayStartMs(shift(until,1),timeZone)/1000)};}
export async function collectInstagram(window,env,fetcher=fetch){
 const token=env.INSTAGRAM_ACCESS_TOKEN,ID=String(env.INSTAGRAM_USER_ID??''),USERNAME=env.INSTAGRAM_USERNAME;
 if(!token||!ID||!USERNAME)throw Error('Instagram credential missing');
 const version=env.META_API_VERSION||'v25.0';if(!/^v\d+\.\d+$/.test(version))throw Error('API version invalid');
 const deadline=Date.now()+65000;
 const get=async(path,params={})=>{
  if(Date.now()>deadline)throw Error('Instagram deadline exceeded');
  const r=await metaGet(graphUrl(version,path,params),{token,fetch:fetcher});
  const j=await r.json();if(!r.ok||j.error)throw Error('Instagram request failed');return j;
 };
 const profile=await get(ID,{fields:'id,username,followers_count,media_count'});
 if(profile.id!==ID||profile.username!==USERNAME)throw Error('Unexpected Instagram account');
 const period=async(since,until)=>{
  const bounds=insightBounds(since,until);
  const responses=await Promise.all([get(ID+'/insights',{metric:metrics.join(','),period:'day',metric_type:'total_value',...bounds}),get(ID+'/insights',{metric:'follows_and_unfollows',period:'day',metric_type:'total_value',breakdown:'follow_type',...bounds})]);
  const parsed={...parseInsights(responses[0]),...parseFollows(responses[1])};
  if(parsed.follows===null||parsed.unfollows===null||parsed.profile_views==null)throw Error('Instagram core metrics unavailable');
  return parsed;
 };
 const [current,previous]=await Promise.all([period(window.since,window.until),period(window.previousSince,window.previousUntil)]);
 const bounds=insightBounds(window.since,window.until),posts=[],warnings=[];let after;
 for(let page=0;page<10;page++){
  const result=await get(ID+'/media',{fields:'id,caption,media_type,permalink,timestamp',limit:'50',...(after?{after}:{})});
  const rows=result.data;if(!Array.isArray(rows))throw Error('Instagram media missing');
  for(const m of rows){const t=Date.parse(m.timestamp)/1000;if(t>=Number(bounds.since)&&t<Number(bounds.until))posts.push(m);}
  if(rows.some(m=>Date.parse(m.timestamp)/1000<Number(bounds.since))||!result.paging?.next)break;
  after=result.paging?.cursors?.after;if(!after)throw Error('Instagram pagination missing');
  if(page===9)throw Error('Instagram media pagination incomplete');
 }
 if(posts.length>40)throw Error('Instagram media exceeds report limit');
 for(let i=0;i<posts.length;i+=3)await Promise.all(posts.slice(i,i+3).map(async p=>{
  try{p.metrics=parseInsights(await get(p.id+'/insights',{metric:'views,reach,likes,comments,shares,saved,total_interactions'}));}
  catch{p.metrics={};warnings.push('No se pudieron consultar las métricas de una publicación reciente; se muestra sin ranking.');}
 }));
 posts.sort((a,b)=>(b.metrics.views??-1)-(a.metrics.views??-1));
 return {profile,current,previous,posts,warnings:[...new Set(warnings)],collectedAt:new Date().toISOString()};
}
export function contentSuggestions(ig){
 const ranked=ig.posts.filter(p=>p.metrics?.views!=null);
 if(!ranked.length)return ['Publicar dos piezas esta semana: una demostración de uso y una respuesta a una pregunta frecuente. Medir guardados, compartidos y visitas al perfil antes de repetir el formato.'];
 const best=ranked[0],title=(best.caption||'Publicación reciente').split('\n')[0],shortTitle=truncate(title,130);
 const kind=best.media_type==='VIDEO'?'reel':best.media_type==='CAROUSEL_ALBUM'?'carrusel':'publicación';
 return [`Crear una segunda versión del ${kind} «${shortTitle}». Conservar el tema y cambiar el inicio por una pregunta concreta. Registró ${best.metrics.views} visualizaciones acumuladas; revisar el enlace antes de producir.`,ranked.length===1?'Solo hubo una publicación nueva en el periodo: todavía no hay una comparación entre contenidos. Publicar otra pieza del mismo formato para construir una referencia.':'Comparar la nueva versión a los siete días de publicada: usar guardados y compartidos por alcance, además de visualizaciones. Las publicaciones actuales tienen edades y exposición distintas; el ranking no prueba causalidad.',ig.current.net>0?'Mantener la frecuencia y añadir una invitación concreta a seguir el perfil en la próxima pieza. Evaluar si el crecimiento neto y las visitas se sostienen la semana siguiente.':'Revisar la promesa de la biografía y fijar una pieza que explique qué obtiene quien sigue la cuenta. Medir el cambio en visitas y crecimiento neto la próxima semana.'];
}

const DAILY_METRICS=['likes','total_interactions','accounts_engaged','reach','views'];
class BudgetError extends Error{}
// Daily series for the dashboard snapshots (Amendment 1). `total_value` metrics return a range total, never per-day
// values, so every day gets its own one-day request. The account comes from env only: there is no fallback id.
export async function collectInstagramDaily(env,{dates,fetch:fetcher=fetch,now=Date.now,budgetMs=50000,concurrency=3}={}){
 const token=env.INSTAGRAM_ACCESS_TOKEN,id=String(env.INSTAGRAM_USER_ID??''),username=env.INSTAGRAM_USERNAME;
 if(!token||!/^\d+$/.test(id)||!username)throw Error('Instagram configuration missing');
 const version=env.META_API_VERSION||'v25.0';if(!/^v\d+\.\d+$/.test(version))throw Error('API version invalid');
 const deadline=Number(now())+budgetMs;
 const get=async(path,params={})=>{
  if(Number(now())>deadline)throw new BudgetError('Instagram budget exhausted');
  const r=await metaGet(graphUrl(version,path,params),{token,fetch:fetcher});
  const j=await r.json();if(!r.ok||j.error)throw Error('Instagram request failed');return j;
 };
 const profile=await get(id,{fields:'id,username,followers_count'});
 if(profile.id!==id||profile.username!==username)throw Error('Unexpected Instagram account');
 const partial=new Set();
 const attempt=async(fn,label)=>{
  try{return await fn();}catch(error){partial.add(error instanceof BudgetError?'budget':label);return null;}
 };
 const oneDay=async date=>{
  const bounds=insightBounds(date,date);
  const plain=Object.fromEntries(DAILY_METRICS.map(m=>[m,null]));
  let batch=null;
  try{batch=parseInsights(await get(id+'/insights',{metric:DAILY_METRICS.join(','),period:'day',metric_type:'total_value',...bounds}));}
  catch(error){
   if(error instanceof BudgetError)partial.add('budget');
   else for(const metric of DAILY_METRICS){
    const body=await attempt(()=>get(id+'/insights',{metric,period:'day',metric_type:'total_value',...bounds}),metric);
    if(body)plain[metric]=parseInsights(body)[metric]??null;
    if(plain[metric]===null)partial.add(metric);
   }
  }
  if(batch)for(const metric of DAILY_METRICS){plain[metric]=batch[metric]??null;if(plain[metric]===null)partial.add(metric);}
  const body=await attempt(()=>get(id+'/insights',{metric:'follows_and_unfollows',period:'day',metric_type:'total_value',breakdown:'follow_type',...bounds}),'follows_and_unfollows');
  const follows=body?parseFollows(body):{follows:null,unfollows:null,net:null};
  if(body&&(follows.follows===null||follows.unfollows===null))partial.add('follows_and_unfollows');
  return {reach:plain.reach,likes:plain.likes,accounts_engaged:plain.accounts_engaged,total_interactions:plain.total_interactions,views:plain.views,...follows};
 };
 const results=new Array(dates.length);let next=0;
 await Promise.all(Array.from({length:Math.min(concurrency,dates.length)},async()=>{
  while(next<dates.length){const i=next++;results[i]=await oneDay(dates[i]);}
 }));
 return {followers_count:value(profile.followers_count),days:Object.fromEntries(dates.map((d,i)=>[d,results[i]])),partial:[...partial].sort()};
}

const POST_FIELDS='id,caption,media_type,permalink,timestamp,thumbnail_url,media_url';
const POST_METRICS=['views','reach','likes','comments','shares','saved','total_interactions'];
// Recent posts with their own insights for the dashboard. Reads env only (no fallback id); a post whose insights
// fail keeps null metrics instead of failing the list. `thumbnail_url` falls back to `media_url` for image posts.
export async function collectInstagramPosts(env,{fetch:fetcher=fetch,now=Date.now,limit=12,budgetMs=20000,concurrency=3}={}){
 const token=env.INSTAGRAM_ACCESS_TOKEN,id=String(env.INSTAGRAM_USER_ID??''),username=env.INSTAGRAM_USERNAME;
 if(!token||!/^\d+$/.test(id)||!username)throw Error('Instagram configuration missing');
 const version=env.META_API_VERSION||'v25.0';if(!/^v\d+\.\d+$/.test(version))throw Error('API version invalid');
 const deadline=Number(now())+budgetMs;
 const get=async(path,params={})=>{
  if(Number(now())>deadline)throw Error('Instagram budget exhausted');
  const r=await metaGet(graphUrl(version,path,params),{token,fetch:fetcher});
  const j=await r.json();if(!r.ok||j.error)throw Error('Instagram request failed');return j;
 };
 const profile=await get(id,{fields:'id,username,followers_count,media_count'});
 if(profile.id!==id||profile.username!==username)throw Error('Unexpected Instagram account');
 const media=await get(id+'/media',{fields:POST_FIELDS,limit:String(limit)});
 if(!Array.isArray(media.data))throw Error('Instagram media missing');
 const posts=media.data.filter(m=>m&&typeof m.id==='string').slice(0,limit).map(m=>({
  id:m.id,caption:typeof m.caption==='string'?m.caption:null,media_type:typeof m.media_type==='string'?m.media_type:null,
  permalink:typeof m.permalink==='string'?m.permalink:null,timestamp:typeof m.timestamp==='string'?m.timestamp:null,
  thumbnail_url:typeof m.thumbnail_url==='string'?m.thumbnail_url:typeof m.media_url==='string'?m.media_url:null,
  metrics:Object.fromEntries(POST_METRICS.map(k=>[k,null])),
 }));
 let next=0;
 await Promise.all(Array.from({length:Math.min(concurrency,posts.length)},async()=>{
  while(next<posts.length){
   const post=posts[next++];
   try{const got=parseInsights(await get(post.id+'/insights',{metric:POST_METRICS.join(',')}));for(const k of POST_METRICS)post.metrics[k]=got[k]??null;}
   catch{/* metrics stay null: the post is listed without a ranking */}
  }
 }));
 posts.sort((a,b)=>(b.metrics.views??-1)-(a.metrics.views??-1));
 return {profile:{followers_count:value(profile.followers_count),media_count:value(profile.media_count)},posts};
}
