import {issueSignedToken,presignUrl} from '@vercel/blob';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {storage} from '../lib/schedule.js';
import {createSessions} from '../lib/auth/session.js';
import {readSid} from '../lib/auth/cookies.js';
import {safeUrl} from '../lib/inspiration/model.js';
export function createMediaHandler({env=process.env,storeFactory=storage,fetcher=fetch}={}){
return async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store');
 if(req.method!=='GET')return res.status(405).end();
 if(env.INSPIRATION_ENABLED!=='true')return res.status(404).end();
 const id=req.query?.id,kind=req.query?.kind;
 if(!/^\d{1,25}$/.test(id||'')||!['image','video'].includes(kind))return res.status(400).end();
 try{const store=storeFactory(env),sid=readSid(req.headers.cookie);
 if(!sid||!await createSessions({env,store,now:Date.now}).check(sid))return res.status(401).end();
 const raw=await store(['GET','dtc:inspiration:archive:'+id]);const file=raw?JSON.parse(raw).files?.[kind]:null;
 let source;
 if(file){
 const validUntil=Date.now()+5*60*1000;
 const token=await issueSignedToken({pathname:file.pathname,operations:['get'],validUntil});
 const {presignedUrl}=await presignUrl(token,{operation:'get',pathname:file.pathname,validUntil,access:'private'});
 source=presignedUrl;
 }else{
 const adRaw=await store(['GET','dtc:inspiration:ad:'+id]);
 const ad=adRaw?JSON.parse(adRaw):null;
 source=safeUrl(ad?.[kind+'_url'],true);
 if(!source)return res.status(404).end();
 }
 // Serve through the authenticated origin: cross-origin private Blob redirects
 // are blocked by browsers for embedded media. Preserve byte ranges for seeking.
 const headers={};
 if(req.headers.range){
  if(!/^bytes=\d*-\d*$/.test(req.headers.range))return res.status(416).end();
  headers.Range=req.headers.range;
 }
 const upstream=await fetcher(source,{headers,redirect:'error',signal:AbortSignal.timeout(25000)});
 if(![200,206,416].includes(upstream.status)){await upstream.body?.cancel();return res.status([403,404,410].includes(upstream.status)?410:503).end();}
 if(upstream.status!==416&&!['image/jpeg','image/png','image/webp','video/mp4'].includes(upstream.headers.get('content-type')?.split(';')[0])){await upstream.body?.cancel();return res.status(415).end();}
 res.setHeader('Cache-Control','private, max-age=300');
 for(const key of ['content-type','content-length','content-range','accept-ranges']){
  const value=upstream.headers.get(key);if(value)res.setHeader(key,value);
 }
 if(req.query?.download==='1'&&upstream.status!==416){const mime=upstream.headers.get('content-type')?.split(';')[0];const ext={'video/mp4':'mp4','image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime];res.setHeader('Content-Disposition',`attachment; filename="ad-${id}.${ext}"`);}
 res.status(upstream.status);
 if(!upstream.body)return res.end();
 await pipeline(Readable.fromWeb(upstream.body),res);
 }catch{if(!res.headersSent)return res.status(503).end();res.destroy();}
}
}
export default createMediaHandler();
