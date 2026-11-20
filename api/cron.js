import report, {authorized} from './report.js';
import {scheduledWindow,storage} from '../lib/schedule.js';
export function createCron({env=process.env,runReport=report,store,now,kind='sales'}={}){
 return async function(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET')return res.status(405).json({error:'Method not allowed'});
  if(!authorized(req.headers.authorization,env.CRON_SECRET))return res.status(401).json({error:'Unauthorized'});
  if(env.AUTOMATION_ENABLED!=='true'||(kind==='social'&&env.SOCIAL_ENABLED!=='true'))return res.status(200).json({status:'disabled'});
  const start=kind==='social'?env.SOCIAL_START_DATE:env.REPORT_START_DATE;
  const needed=['REPORT_SECRET','UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN'];
  if(!start||needed.some(k=>!env[k]))return res.status(503).json({error:'Configuration incomplete'});
  const redis=store||storage(env);
  const cursorKey=`dtc:schedule:${env.META_AD_ACCOUNT_ID||'unset'}:${kind}:${start}`;
  try{
   const last=await redis(['GET',cursorKey]);
   const due=scheduledWindow(start,last,now,kind==='social'?7:3);
   if(!due)return res.status(200).json({status:'not_due'});
   let code=500,result={error:'No response from report'};
   const capture={setHeader(){},status(value){code=value;return this;},json(value){result=value;return this;}};
   await runReport({method:'POST',headers:{authorization:`Bearer ${env.REPORT_SECRET}`},body:{kind,mode:'send',since:due.window.since,until:due.window.until}},capture);
   if(code===200&&['accepted_by_email_provider','already_sent','no_active_campaigns'].includes(result.status)){
    // Monotonic cursor prevents an older concurrent completion moving the schedule backwards.
    await redis(['EVAL','local p=redis.call("GET",KEYS[1]); if (not p) or p<ARGV[1] then redis.call("SET",KEYS[1],ARGV[1]); end; return 1',1,cursorKey,due.delivery]);
   }
   return res.status(code).json({...result,delivery:due.delivery});
  }catch{
   console.error('Meta report schedule failed; cursor was not advanced.');
   return res.status(502).json({error:'Schedule failed; review deployment logs'});
  }
 };
}
export default createCron();
