import {createHmac,randomUUID} from 'node:crypto';
import {issueSignedToken,presignUrl} from '@vercel/blob';
import {safeUrl} from './model.js';
const P='dtc:inspiration:';
export function validateTranscript(r){
 if(!r||r.provider!=='faster-whisper'||typeof r.transcript!=='string'||r.transcript.length>100000||!Array.isArray(r.segments)||r.segments.length>3000)throw Error('transcription_failed');
 let last=0;for(const s of r.segments){if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<last||s.end<s.start||s.end>310||typeof s.text!=='string')throw Error('transcription_failed');last=s.start;}
 if(r.transcript!==r.segments.map(s=>s.text).join('\n'))throw Error('transcription_failed');
 return r;
}
export async function transcribeAd(id,{env,store,fetch:fetcher=fetch,now=Date.now}){
 const cached=await store(['GET',P+'transcript:'+id]);if(cached)return {...JSON.parse(cached),cached:true};
 const token=randomUUID(),lock=P+'transcript-lock:'+id;
 if(!await store(['SET',lock,token,'NX','EX',300]))throw Error('transcription_busy');
 try{
  const raw=await store(['GET',P+'ad:'+id]);if(!raw)throw Error('media_unavailable');const ad=JSON.parse(raw);
  const archiveRaw=await store(['GET',P+'archive:'+id]);const file=archiveRaw?JSON.parse(archiveRaw).files?.video:null;
  let source=safeUrl(ad.video_url,true);
  if(file){const validUntil=now()+300000;const signed=await issueSignedToken({pathname:file.pathname,operations:['get'],validUntil});source=(await presignUrl(signed,{operation:'get',pathname:file.pathname,validUntil,access:'private'})).presignedUrl;}
  if(!source)throw Error('media_unavailable');
  if(!env.DASH_SESSION_SECRET||!env.DASH_BASE_URL)throw Error('transcription_unavailable');
  const body=JSON.stringify({id,source,expires:Math.floor(now()/1000)+300,nonce:token});
  const signature=createHmac('sha256',env.DASH_SESSION_SECRET).update('dtc-whisper-v1:'+body).digest('hex');
  const response=await fetcher(new URL('/api/whisper',env.DASH_BASE_URL),{method:'POST',headers:{'Content-Type':'application/json','X-Whisper-Signature':signature},body,redirect:'error',signal:AbortSignal.timeout(270000)});
  const result=await response.json();if(!response.ok)throw Error(['video_too_long','media_too_large','media_unavailable','transcription_busy'].includes(result.error)?result.error:'transcription_failed');
  validateTranscript(result);result.created_at=new Date(now()).toISOString();await store(['SET',P+'transcript:'+id,JSON.stringify(result)]);return result;
 }finally{await store(['EVAL',"if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end",1,lock,token]);}
}
