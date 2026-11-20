import {put} from '@vercel/blob';
import {readMedia} from './media.js';
const P='dtc:inspiration:';
const RESERVE="local n=tonumber(redis.call('GET',KEYS[1]) or '0'); if n+tonumber(ARGV[1])>tonumber(ARGV[2]) then return -1 end; return redis.call('INCRBY',KEYS[1],ARGV[1])";
export async function archiveAd(ad,{env,store,fetch:fetcher=fetch}){
 if(!env.BLOB_STORE_ID&&!env.BLOB_READ_WRITE_TOKEN)throw Error('archive_unavailable');
 const key=P+'archive:'+ad.id;const existing=await store(['GET',key]);let saved=existing?JSON.parse(existing):{id:ad.id,files:{}};
 for(const kind of ['image','video']){if(saved.files[kind]||!ad[kind+'_url'])continue;
  const {mime,bytes}=await readMedia({[kind+'_url']:ad[kind+'_url']},fetcher);
  // 256 MB lifetime budget leaves headroom inside Hobby's 1 GB. No paid upgrade or automatic eviction.
  if(await store(['EVAL',RESERVE,1,P+'archive-bytes',bytes.length,256*1024*1024])===-1)throw Error('archive_limit');
  const blob=await put(`inspiration/${ad.id}/${kind}`,bytes,{access:'private',addRandomSuffix:true,contentType:mime,storeId:env.BLOB_STORE_ID,token:env.BLOB_READ_WRITE_TOKEN,abortSignal:AbortSignal.timeout(20000)});
  saved.files[kind]={pathname:blob.pathname,mime,size:bytes.length};saved.created_at=new Date().toISOString();await store(['SET',key,JSON.stringify(saved)]);
 }
 if(!Object.keys(saved.files).length)throw Error('media_unavailable');return {archived:true,files:Object.keys(saved.files),created_at:saved.created_at};
}
