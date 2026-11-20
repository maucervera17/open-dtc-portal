import {createInspiration} from './service.js';
import {storage} from '../schedule.js';
import {authorized} from '../auth/bearer.js';
export function createInspirationCron({env=process.env,store,fetch:fetcher=fetch,now=Date.now}={}){
 return async(req,res)=>{
  res.setHeader('Cache-Control','no-store');
  if(env.INSPIRATION_ENABLED!=='true'||env.INSPIRATION_AUTO_ENABLED!=='true')return res.status(200).json({skipped:'disabled'});
  if(!authorized(req.headers?.authorization,env.CRON_SECRET))return res.status(401).json({error:'unauthorized'});
  if(req.method!=='GET')return res.status(405).json({error:'method_not_allowed'});
  const db=store||storage(env),day=new Date(now()).toISOString().slice(0,10);
  // Idempotency across retries; expire after 48h. No paid retries after uncertain outcomes.
  if(!await db(['SET','dtc:inspiration:cron:'+day,'started','NX','EX',172800]))return res.status(200).json({skipped:'already_started'});
  const service=createInspiration({env,store:db,fetch:fetcher,now}),out=[];
  const started=now();
  for(const b of (await service.brands()).filter(b=>b.page_id&&b.auto)){
   if(now()-started>180000)break;
   try{out.push({id:b.id,...await service.sync(b.id)});}catch(e){out.push({id:b.id,error:e.code||'unavailable'});if(['call_limit','credits_exhausted','provider_unavailable'].includes(e.code))break;}
  }
  return res.status(200).json({results:out});
 };
}
