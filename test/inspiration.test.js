import test from 'node:test';
import assert from 'node:assert/strict';
import {createInspiration} from '../lib/inspiration/service.js';
import {normalizeAd,safeUrl,SEED_BRANDS} from '../lib/inspiration/model.js';
import {memoryStore} from '../scripts/inspiration-store.mjs';
import './fixtures/brands.js';
import {createDashHandler} from '../lib/dash/router.js';
import {createSessions} from '../lib/auth/session.js';
import {createInspirationCron} from '../lib/inspiration/cron.js';
import {params,ROUTES} from '../lib/dash/validate.js';
const now=()=>Date.parse('2026-10-29T20:00:00Z');
const raw={ad_archive_id:'12345',page_id:'200000000000002',is_active:true,start_date:1700000000,snapshot:{body:{text:'Anuncio de prueba'},videos:[{video_sd_url:'https://video.xx.fbcdn.net/a.mp4',video_preview_image_url:'https://scontent.xx.fbcdn.net/a.jpg'}]}};
const env={SCRAPECREATORS_API_KEY:'test-only',INSPIRATION_ENABLED:'true',INSPIRATION_CALL_LIMIT:'2'};
function setup(response={success:true,results:[raw],credits_remaining:90}){const store=memoryStore();let calls=0;const service=createInspiration({env,store,now,fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>response};}});return {store,service,calls:()=>calls};}
test('normalizes supported media and rejects foreign advertisers and unsafe URLs',()=>{
 const brand=SEED_BRANDS[1];assert.equal(normalizeAd({...raw,page_id:'1'},brand,'now'),null);
 const a=normalizeAd(raw,brand,'now');assert.equal(a.id,'12345');assert.match(a.video_url,/fbcdn/);assert.equal(a.is_active,true);
 assert.equal(safeUrl('javascript:alert(1)'),null);assert.equal(safeUrl('https://fbcdn.net.evil.test/a',true),null);assert.equal(safeUrl('https://127.0.0.1/a',true),null);
});
test('sync persists real observations, deduplicates, preserves favorites and never infers inactive from omission',async()=>{
 const {service,store}=setup();await service.sync('alpha');await service.annotate({id:'12345',favorite:true,collection:'Hooks',notes:'Idea',tags:['UGC']});
 const later=createInspiration({env,store,now:()=>now()+120000,fetch:async()=>({ok:true,json:async()=>({success:true,results:[raw]})})});
 await later.sync('alpha');const list=await service.list();assert.equal(list.ads.length,1);assert.equal(list.ads[0].favorite,true);assert.equal(list.ads[0].first_seen_at,new Date(now()).toISOString());
 await assert.rejects(later.sync('beta'),/call_limit/);
});
test('provider errors keep observations and count uncertain requests conservatively',async()=>{
 const {service,store}=setup();await service.sync('alpha');const s=createInspiration({env,store,now:()=>now()+120000,fetch:async()=>{throw Error('timeout');}});
 await assert.rejects(s.sync('alpha'),/provider_unavailable/);assert.equal((await s.list()).ads.length,1);assert.equal((await s.list()).calls_used,2);
});
test('rejects malformed provider response, identity changes reset pagination, and pagination uses server cursor',async()=>{
 const {service,store}=setup({success:true,results:[raw],cursor:'next-page'});await service.sync('alpha');
 let body;const s=createInspiration({env,store,now,fetch:async(u,o)=>{body=JSON.parse(o.body);return {ok:true,json:async()=>({success:true,results:[],cursor:'next-page'})};}});
 await s.sync('alpha',true);assert.equal(body.cursor,'next-page');assert.equal((await s.brand('alpha')).cursor,null);
 await s.upsert({id:'alpha',name:'Example Alpha',website:'https://alpha.example.com/',page_id:'99'});assert.equal((await s.brand('alpha')).last_import_at,null);
});
test('AI is opt-in and invalid notes are rejected before storage',async()=>{
 const {service}=setup();await assert.rejects(service.analyze('12345'),/ai_disabled/);
 assert.throws(()=>params(ROUTES['inspiration/note'],{id:'12345',favorite:true,collection:'',notes:'',tags:'bad'},'2026-10-29'));
 assert.equal(params(ROUTES['inspiration/sync'],{id:'alpha',more:true},'2026-10-29').more,true);
});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(s){this.code=s;return this;},json(b){this.body=b;return this;},end(){return this;}});
test('public API denies unauthenticated requests and cross-origin writes',async()=>{
 const store=memoryStore(),e={...env,DASH_ENABLED:'true',DASH_BASE_URL:'https://portal.example.com',DASH_SESSION_SECRET:'x'.repeat(32),DASH_ALLOWED_EMAILS:'test@example.com'};
 const handle=createDashHandler({env:e,store,now});let res=response();await handle({method:'GET',query:{r:'inspiration'},headers:{}},res);assert.equal(res.code,401);
 res=response();await handle({method:'POST',query:{r:'inspiration/sync'},headers:{origin:'https://evil.test','content-type':'application/json'},body:{id:'alpha'}},res);assert.equal(res.code,403);
 const session=await createSessions({env:e,store,now}).create('test@example.com');
 const {sessionCookie}=await import('../lib/auth/cookies.js');res=response();await handle({method:'GET',query:{r:'inspiration'},headers:{cookie:sessionCookie(session.sid,session.maxAge).split(';')[0]}},res);assert.equal(res.code,200);assert.equal(res.body.brands.length,6);assert.equal(JSON.stringify(res.body).includes('test-only'),false);
});
test('cron is disabled by default and requires a secret when enabled',async()=>{let res=response();await createInspirationCron({env:{}})({headers:{}},res);assert.equal(res.body.skipped,'disabled');res=response();await createInspirationCron({env:{...env,INSPIRATION_AUTO_ENABLED:'true',CRON_SECRET:'secret'}})({headers:{},method:'GET'},res);assert.equal(res.code,401);});
test('Gemini analysis uses dashboard model and key, caches output and enforces daily cap',async()=>{
 const {service,store}=setup();await service.sync('alpha');let calls=0;
 const s=createInspiration({env:{...env,GEMINI_API_KEY:'test-gemini',INSPIRATION_AI_ENABLED:'true'},store,now,generateAnalysis:async()=>{calls++;return {text:'Brief de prueba',provider:'gemini'};}});
 assert.equal((await s.list()).ai_enabled,true);await s.analyze('12345');await s.analyze('12345');assert.equal(calls,1);
 await store(['SET','dtc:inspiration:ad:54321',JSON.stringify({id:'54321'})]);await store(['SET','dtc:inspiration:ai-calls:2026-10-29','5']);await assert.rejects(s.analyze('54321'),/ai_limit/);
});
test('Gemini request reuses model and rejects incomplete or blocked answers',async()=>{
 const {analysisRequest,analyzeCopy}=await import('../lib/inspiration/analysis.js');assert.equal(analysisRequest({body:'copy'},{GEMINI_MODEL:'dashboard-model'}).model,'dashboard-model');
 await assert.rejects(analyzeCopy({}, {}, {models:{generateContent:async()=>({candidates:[{finishReason:'MAX_TOKENS'}],text:'partial'})}}),/analysis_incomplete/);
});
test('multimedia analysis uses the archived video when its remote URL expires',async()=>{
 const {service,store}=setup();await service.sync('alpha');
 const file={pathname:'inspiration/12345/video-test',mime:'video/mp4',size:42};
 await store(['SET','dtc:inspiration:archive:12345',JSON.stringify({files:{video:file}})]);
 let used;const s=createInspiration({env:{...env,GEMINI_API_KEY:'test-gemini',INSPIRATION_AI_ENABLED:'true'},store,now,generateAnalysis:async(ad,env,client,media,archive)=>{used={media,archive};return {text:'Transcripción',transcript:'[00:00] Hola.',basis:'video + copy'};}});
 await s.analyze('12345',true);assert.deepEqual(used,{media:true,archive:file});
});
test('malformed provider results are not persisted',async()=>{const {service}=setup({success:true,results:null});await assert.rejects(service.sync('alpha'),/invalid_provider_response/);assert.equal((await service.list()).ads.length,0);});
test('advertiser discovery shares credit cap and returns bounded identifiers',async()=>{
 const store=memoryStore();let url,method;const s=createInspiration({env,store,now,fetch:async(u,o)=>{url=u;method=o.method;return {ok:true,json:async()=>({success:true,credits_remaining:80,searchResults:[{page_id:'12',name:'Marca',ig_username:'marca'},{page_id:'bad',name:'omitida'}]})};}});
 const r=await s.search('Marca MX');assert.equal(method,'GET');assert.match(url,/query=Marca\+MX/);assert.equal(r.results.length,1);assert.equal((await s.list()).calls_used,1);
});
test('Gemini produces a practical three-step recipe and rejects malformed recipes',async()=>{
 const {analyzeCopy}=await import('../lib/inspiration/analysis.js');const recipe={did:'Abre con una pregunta.',why:'Puede despertar curiosidad.',steps:['Elige un producto.','Graba una apertura.','Compara con control.'],hook:'¿Cómo eliges tu siguiente producto?',analysis:'Análisis completo.'};
 const client=value=>({models:{generateContent:async()=>({candidates:[{finishReason:'STOP'}],text:JSON.stringify(value)})}});
 const r=await analyzeCopy({body:'Copy'}, {},client(recipe));assert.deepEqual(r.recipe.steps,recipe.steps);assert.equal(r.text,recipe.analysis);
 await assert.rejects(analyzeCopy({body:'Copy'}, {},client({...recipe,steps:['Solo uno']})),/analysis_incomplete/);
});
test('keyword discovery uses validated filters, caches requests and keeps results out of tracked statistics',async()=>{
 const store=memoryStore();let calls=0,request;
 const service=createInspiration({env,store,now,fetch:async(u,o)=>{calls++;request={u,body:JSON.parse(o.body)};return {ok:true,json:async()=>({success:true,searchResults:[raw,raw],cursor:'page-two',searchResultsCount:500,credits_remaining:90})};}});
 const p={query:'producto ejemplo',country:'MX',media:'VIDEO'};
 const first=await service.discover(p);assert.equal(first.results.length,1);assert.equal(first.has_more,true);assert.equal(first.cursor,undefined);assert.match(request.u,/search\/ads$/);assert.equal(request.body.media_type,'VIDEO');assert.equal(request.body.status,'ACTIVE');
 assert.equal((await service.list()).ads.length,0);
 assert.equal((await service.discover(p)).cached,true);assert.equal(calls,1);
 const next=await service.discover({...p,more:true});assert.equal(request.body.cursor,'page-two');assert.equal(next.has_more,false);assert.equal(calls,2);
 await assert.rejects(service.discover({...p,query:'otra búsqueda'}),/call_limit/);
 await service.annotate({id:'12345',favorite:true,collection:'',notes:'',tags:[]});assert.equal((await service.list()).ads[0].favorite,true);
});
test('keyword discovery rejects bad input and malformed provider data',async()=>{
 assert.throws(()=>params(ROUTES['inspiration/discover'],{query:'a',country:'MX',media:'ALL'},'2026-10-30'));
 assert.throws(()=>params(ROUTES['inspiration/discover'],{query:'test',country:'XX',media:'ALL'},'2026-10-30'));
 const {service}=setup({success:true,searchResults:null});await assert.rejects(service.discover({query:'test',country:'MX',media:'ALL'}),/invalid_provider_response/);
});
test('impression ordering and filter combinations use separate provider searches and retain reported totals',async()=>{
 const store=memoryStore();let requests=[];const service=createInspiration({env:{...env,INSPIRATION_CALL_LIMIT:'5'},store,now,fetch:async(u,o)=>{requests.push(JSON.parse(o.body));return {ok:true,json:async()=>({success:true,searchResults:[raw],cursor:'page-'+requests.length,...(requests.length===1?{searchResultsCount:1000}:{})})};}});
 const input={query:'producto ejemplo',country:'ALL',media:'ALL',sort:'total_impressions',status:'ALL',language:'ES',matching:'keyword_exact_phrase'};
 assert.equal((await service.discover(input)).reported_total,1000);assert.equal(requests[0].sort_by,'total_impressions');assert.equal(requests[0].language,'ES');assert.equal(requests[0].status,'ALL');
 assert.equal((await service.discover({...input,more:true})).reported_total,1000);
 await service.discover({...input,sort:'relevancy_monthly_grouped'});assert.equal(requests.length,3);
 assert.throws(()=>params(ROUTES['inspiration/discover'],{...input,sort:'made-up'},'2026-10-30'));
});

test('extension captures are idempotent, preserve notes, accept inactive ads and organize boards',async()=>{
 const {service,store,calls}=setup();const capture={id:'99111',page_name:'New brand',page_id:'555',body:'Public copy',is_active:false,started_at:'2026-01-01',ended_at:'2026-05-01',image_url:'https://unsafe.example/image'};
 await service.capture(capture);const board=await service.createBoard({name:'Ideas'});assert.equal((await service.createBoard({name:'ideas'})).id,board.id);
 await service.organize({id:capture.id,board_ids:[board.id]});await service.annotate({id:capture.id,favorite:true,collection:'Old',notes:'Keep',tags:['tag']});await service.capture({...capture,body:'Should not erase provider data'});
 const list=await service.list();assert.equal(list.ads.length,1);assert.equal(list.ads[0].is_active,false);assert.equal(list.ads[0].image_url,null);assert.equal(list.ads[0].notes,'Keep');assert.deepEqual(list.ads[0].board_ids,[board.id]);assert.equal(calls(),0);
 const brand=await service.follow(capture.id);assert.equal(brand.page_id,'555');assert.equal((await service.follow(capture.id)).id,brand.id);assert.equal((await service.list()).ads[0].brand_id,brand.id);
 await assert.rejects(service.organize({id:capture.id,board_ids:['missing']}),/board_not_found/);
});
test('historical sync uses ALL and never mixes cursor statuses',async()=>{
 const store=memoryStore();let sent;const service=createInspiration({env,store,now,fetch:async(u,o)=>{sent=JSON.parse(o.body);return {ok:true,json:async()=>({success:true,results:[{...raw,is_active:false,end_date:1750000000}],cursor:'next'})};}});
 await service.sync('alpha',false,'ALL');assert.equal(sent.status,'ALL');assert.equal((await service.list()).ads[0].is_active,false);await assert.rejects(service.sync('alpha',true,'ACTIVE'),/no_more_pages/);await service.sync('alpha',true,'ALL');assert.equal(sent.cursor,'next');
});
test('new extension routes require validated fields',()=>{
 for(const name of ['capture','board','organize','follow'])assert.equal(ROUTES['inspiration/'+name].session,true);
 assert.throws(()=>params(ROUTES['inspiration/capture'],{id:'bad',page_name:'test'},'2026-10-30'));
 assert.throws(()=>params(ROUTES['inspiration/organize'],{id:'123',board_ids:['../../']},'2026-10-30'));
 assert.throws(()=>params(ROUTES['inspiration/sync'],{id:'beta',status:'FAKE'},'2026-10-30'));
});
test('enrichment reads canonical ad detail and preserves board membership',async()=>{
 const {service,store}=setup();await service.capture({id:'99111',page_name:'Brand',page_id:'555',is_active:false});const b=await service.createBoard({name:'Historical'});await service.organize({id:'99111',board_ids:[b.id]});let url;
 const enriched=createInspiration({env,store,now,fetch:async u=>{url=u;return {ok:true,json:async()=>({success:true,adArchiveID:'99111',pageID:'555',pageName:'Brand',isActive:false,startDate:1700000000,endDate:1710000000,snapshot:{body:{text:'Canonical copy'},videos:[{video_sd_url:'https://video.xx.fbcdn.net/a.mp4'}]}})};}});
 await enriched.enrich('99111');const ad=(await enriched.list()).ads[0];assert.equal(ad.body,'Canonical copy');assert.equal(ad.is_active,false);assert.deepEqual(ad.board_ids,[b.id]);assert.match(url,/get_transcript=false/);assert.ok(ad.ended_at);assert.match(ad.video_url,/mp4/);
});
test('video transcript cache rejects legacy null, persists spoken text and remains downloadable after daily cap',async()=>{
 const {service,store}=setup();await service.sync('alpha');
 await store(['SET','dtc:inspiration:media-analysis:12345',JSON.stringify({text:'Legacy',transcript:null})]);
 let calls=0;const transcript='[00:00] Hola.\n[00:03] Esta es la voz original.';
 const s=createInspiration({env:{...env,GEMINI_API_KEY:'test-only',INSPIRATION_AI_ENABLED:'true'},store,now,generateAnalysis:async()=>{calls++;return {text:'Análisis',transcript};}});
 assert.equal((await s.analyze('12345',true)).transcript,transcript);
 await store(['SET','dtc:inspiration:ai-calls:2026-10-29','5']);
 assert.equal((await s.analyze('12345',true)).transcript,transcript);assert.equal(calls,1);
 assert.equal((await s.getAnalysis('12345')).transcript,transcript);
});
test('media analysis rejects missing transcript instead of storing a false success',async()=>{
 const {service,store}=setup();await service.sync('alpha');
 const s=createInspiration({env:{...env,GEMINI_API_KEY:'test-only',INSPIRATION_AI_ENABLED:'true'},store,now,generateAnalysis:async()=>({text:'Analysis without speech'})});
 await assert.rejects(s.analyze('12345',true),/analysis_incomplete/);
 assert.equal(await store(['GET','dtc:inspiration:media-analysis:12345']),null);
});
test('video analysis sends video bytes to Gemini and keeps spoken transcript separate from copy',async()=>{
 const {analyzeCopy}=await import('../lib/inspiration/analysis.js');
 const originalFetch=globalThis.fetch;let request;
 globalThis.fetch=async()=>new Response(new Uint8Array([0,0,0,24]),{headers:{'content-type':'video/mp4'}});
 const recipe={did:'Pregunta',why:'Atención',steps:['Uno','Dos','Tres'],hook:'Hook',analysis:'Análisis',transcript:'[00:00] Palabras del audio.'};
 const client={models:{generateContent:async r=>{request=r;return {candidates:[{finishReason:'STOP'}],text:JSON.stringify(recipe)};}}};
 try{
 const result=await analyzeCopy({video_url:'https://video.xx.fbcdn.net/test.mp4',body:'Copy distinto'}, {},client,true);
 assert.equal(request.contents[0].parts[0].inlineData.mimeType,'video/mp4');
 assert.ok(request.config.responseJsonSchema.required.includes('transcript'));
 assert.equal(result.transcript,recipe.transcript);assert.equal(result.basis,'video + copy');
 recipe.transcript=null;await assert.rejects(analyzeCopy({video_url:'https://video.xx.fbcdn.net/test.mp4'}, {},client,true),/analysis_incomplete/);
 recipe.transcript='';assert.equal((await analyzeCopy({video_url:'https://video.xx.fbcdn.net/test.mp4'}, {},client,true)).transcript,'');
 }finally{globalThis.fetch=originalFetch;}
});

 test('configured lifetime budget above 75 is honored without resetting used calls',async()=>{
 const store=memoryStore();await store(['SET','dtc:inspiration:calls','1066']);let calls=0;
 const service=createInspiration({env:{...env,INSPIRATION_CALL_LIMIT:'1067'},store,now,fetch:async()=>{calls++;return {ok:true,json:async()=>({success:true,searchResults:[],credits_remaining:999})};}});
 assert.equal((await service.list()).call_limit,1067);
 await service.search('Example Sample');
 assert.equal((await service.list()).calls_used,1067);
 await assert.rejects(service.search('Example Sample'),/call_limit/);assert.equal(calls,1);
 });
 test('invalid lifetime budgets fail closed and an omitted budget retains the default',async()=>{
 for(const value of ['NaN','Infinity','-1','1.5','9007199254740992','0']){
 const store=memoryStore();const service=createInspiration({env:{...env,INSPIRATION_CALL_LIMIT:value},store,now,fetch:async()=>{throw Error('unexpected network call');}});
 assert.equal((await service.list()).call_limit,0);await assert.rejects(service.search('Example Sample'),/call_limit/);
 }
 const defaults=createInspiration({env:{SCRAPECREATORS_API_KEY:'test-only'},store:memoryStore(),now});assert.equal((await defaults.list()).call_limit,60);
 });

test('provider balance mode resumes after a top-up despite cached zero and an exhausted local cap',async()=>{
 const store=memoryStore();await store(['SET','dtc:inspiration:calls','1067']);await store(['SET','dtc:inspiration:provider',JSON.stringify({remaining:0})]);let calls=0;
 const service=createInspiration({env:{...env,INSPIRATION_BUDGET_MODE:'provider',INSPIRATION_CALL_LIMIT:'0'},store,now,fetch:async()=>{calls++;return calls===1?{ok:false,status:402,json:async()=>({success:false})}:{ok:true,status:200,json:async()=>({success:true,searchResults:[],credits_remaining:999})};}});
 await assert.rejects(service.search('Example Sample'),/credits_exhausted/);
 assert.equal((await service.list()).provider.remaining,0);
 await service.search('Example Sample');const list=await service.list();
 assert.equal(list.provider.remaining,999);assert.equal(list.call_limit,null);assert.equal(list.budget_mode,'provider');assert.equal(list.calls_used,1069);assert.equal(calls,2);
});
test('the final prepaid credit can return results and unknown budget modes retain the cap',async()=>{
 const store=memoryStore();const fetcher=async()=>({ok:true,status:200,json:async()=>({success:true,searchResults:[],credits_remaining:0})});
 const service=createInspiration({env:{...env,INSPIRATION_BUDGET_MODE:'provider'},store,now,fetch:fetcher});
 assert.deepEqual((await service.search('Example Sample')).results,[]);
 const capped=createInspiration({env:{...env,INSPIRATION_BUDGET_MODE:'typo',INSPIRATION_CALL_LIMIT:'0'},store,now,fetch:fetcher});
 await assert.rejects(capped.search('Example Sample'),/call_limit/);
});
