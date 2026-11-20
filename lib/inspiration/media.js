import {safeUrl} from './model.js';
// Read only known Meta CDN media. No redirects, arbitrary URLs or unbounded downloads.
export async function readMedia(ad,fetcher=fetch){
 const url=safeUrl(ad.video_url||ad.image_url,true);if(!url)throw Error('media_unavailable');
 const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(15000)});
 return readMediaResponse(r);
}
export async function readMediaResponse(r){
 if(!r.ok)throw Error('media_unavailable');const mime=r.headers.get('content-type')?.split(';')[0];
 if(!['video/mp4','image/jpeg','image/png','image/webp'].includes(mime))throw Error('media_unavailable');
 const limit=16*1024*1024;if(Number(r.headers.get('content-length'))>limit){await r.body?.cancel();throw Error('media_too_large');}
 const reader=r.body.getReader(),chunks=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('media_too_large');}chunks.push(value);}}finally{reader.releaseLock();}
 return {mime,bytes:Buffer.concat(chunks)};
}

export async function mediaPart(ad,fetcher=fetch){const {mime,bytes}=await readMedia(ad,fetcher);return {inlineData:{mimeType:mime,data:bytes.toString('base64')}};}
