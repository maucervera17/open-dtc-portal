import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {transcribeAd,validateTranscript} from '../lib/inspiration/transcription.js';
import {memoryStore} from '../scripts/inspiration-store.mjs';
import {toSrt} from '../public/app/views/transcript-export.js';
const result={provider:'faster-whisper',transcript:'Hola.\nUn ejemplo.',segments:[{start:0,end:1.5,text:'Hola.'},{start:2,end:4.123,text:'Un ejemplo.'}]};
test('Whisper uses a signed server request, caches without Gemini and exports timed subtitles',async()=>{
 const store=memoryStore();await store(['SET','dtc:inspiration:ad:123',JSON.stringify({video_url:'https://video.xx.fbcdn.net/a.mp4'})]);let calls=0;
 const env={DASH_BASE_URL:'https://portal.example.com',DASH_SESSION_SECRET:'test-secret'};
 const fetch=async(url,o)=>{calls++;assert.equal(String(url),'https://portal.example.com/api/whisper');assert.equal(o.headers['X-Whisper-Signature'],createHmac('sha256','test-secret').update('dtc-whisper-v1:'+o.body).digest('hex'));assert.equal(JSON.parse(o.body).source,'https://video.xx.fbcdn.net/a.mp4');return {ok:true,json:async()=>structuredClone(result)};};
 assert.equal((await transcribeAd('123',{env,store,fetch})).transcript,result.transcript);
 assert.equal((await transcribeAd('123',{env,store,fetch})).cached,true);assert.equal(calls,1);
 assert.equal(toSrt(result.segments),'1\n00:00:00,000 --> 00:00:01,500\nHola.\n\n2\n00:00:02,000 --> 00:00:04,123\nUn ejemplo.\n');
});
test('Whisper never caches malformed output and releases lock after failure',async()=>{
 const store=memoryStore();await store(['SET','dtc:inspiration:ad:123',JSON.stringify({video_url:'https://video.xx.fbcdn.net/a.mp4'})]);
 await assert.rejects(transcribeAd('123',{env:{DASH_BASE_URL:'https://portal.example.com',DASH_SESSION_SECRET:'test'},store,fetch:async()=>({ok:true,json:async()=>({...result,transcript:'invented'})})}),/transcription_failed/);
 assert.equal(await store(['GET','dtc:inspiration:transcript:123']),null);assert.equal(await store(['GET','dtc:inspiration:transcript-lock:123']),null);
 assert.throws(()=>validateTranscript({...result,segments:[{start:5,end:1,text:'Hola.'}]}),/transcription_failed/);
});
test('Whisper requires a stored video and does not fetch arbitrary URLs',async()=>{
 const store=memoryStore();await store(['SET','dtc:inspiration:ad:123',JSON.stringify({video_url:'http://127.0.0.1/private'})]);
 await assert.rejects(transcribeAd('123',{env:{},store,fetch:()=>{throw Error('must not fetch');}}),/media_unavailable/);
});
