import test from 'node:test';import assert from 'node:assert/strict';
import {intelligence,validatePlan,createIntelligence} from '../lib/inspiration/intelligence.js';
import {memoryStore} from '../scripts/inspiration-store.mjs';
import {validateInspiration} from '../lib/inspiration/routes.js';
import {mediaPart} from '../lib/inspiration/media.js';
const now=()=>Date.parse('2026-10-29T20:00:00Z');
const ad={id:'123',brand_id:'brand',page_name:'Brand',body:'Hook. Oferta',title:'Title',format:'VIDEO',started_at:'2026-10-01T00:00:00Z',observed_at:'2026-10-20T00:00:00Z',source_url:'https://www.facebook.com/ads/library/?id=123',landing_url:'https://example.com/p?utm=1'};
const brands=[{id:'brand',name:'Brand',cursor:'next'}];
const action={title:'Probar ritual',why:'Copy de referencia',hypothesis:'Mayor claridad',priority:'P1',effort:'1 hora',source_ids:['123'],own_ad_ids:[],hooks:['Uno','Dos','Tres'],script:'Guion original',visuals:'Plano cenital',cta:'Conoce el producto',test:'Cambiar únicamente el hook',success:'Comparar CTR con control tras suficiente muestra',risks:['Confirmar beneficios']};
const plan={summary:'Producir una variante original',gaps:['Falta precio'],actions:[action]};
test('market metrics disclose partial coverage and stop duration at observation',()=>{const m=intelligence([ad],brands,now());assert.equal(m.longest[0].days,19);assert.equal(m.brands[0].partial,true);assert.equal(m.landings[0].label,'https://example.com/p');assert.equal(m.brands[0].new7,0);});
test('rejects invented evidence and malformed plans',()=>{assert.throws(()=>validatePlan({...plan,actions:[{...action,source_ids:['fake']}]},new Set(['123']),new Set()),/ungrounded_plan/);assert.throws(()=>validatePlan({...plan,actions:[]},new Set(),new Set()),/invalid_plan/);});
test('plan generation persists evidence, caches identical input and saves learning',async()=>{
 const store=memoryStore();let calls=0;const s=createIntelligence({env:{INSPIRATION_AI_ENABLED:'true',GEMINI_API_KEY:'test'},store,now,service:{list:async()=>({ads:[ad],brands,ai_enabled:true})},client:{models:{generateContent:async()=>{calls++;return {text:JSON.stringify(plan),candidates:[{finishReason:'STOP'}]};}}}});
 const p=await s.generate();assert.equal(p.actions[0].status,'pendiente');assert.equal(p.evidence[0].id,'123');assert.equal((await s.generate()).id,p.id);assert.equal(calls,1);
 await s.update({id:p.id,action_id:'1',status:'prueba',result:'Hook B está en prueba'});assert.equal((await s.overview()).plans[0].actions[0].result,'Hook B está en prueba');
});
test('production task and profile inputs are bounded',()=>{assert.throws(()=>validateInspiration({id:'abc',action_id:'1',status:'inventado',result:''},'action'));assert.throws(()=>validateInspiration({product:'x'.repeat(2001)},'profile'));});
test('media reader rejects arbitrary hosts, oversize responses and wrong content types',async()=>{
 await assert.rejects(mediaPart({video_url:'https://example.com/private'}),/media_unavailable/);
 let cancelled=false;await assert.rejects(mediaPart({video_url:'https://video.xx.fbcdn.net/test'},async()=>({ok:true,headers:new Headers({'content-type':'video/mp4','content-length':20*1024*1024}),body:{cancel:async()=>{cancelled=true}}})),/media_too_large/);assert.equal(cancelled,true);
 await assert.rejects(mediaPart({image_url:'https://scontent.xx.fbcdn.net/test'},async()=>({ok:true,headers:new Headers({'content-type':'text/html'})})),/media_unavailable/);
});
test('contingency plan is explicit and references only observed advertisers',async()=>{
 const {rulePlan}=await import('../lib/inspiration/intelligence.js');const p=rulePlan([ad],{own:null});assert.match(p.summary,/contingencia/);validatePlan(p,new Set(['123']),new Set());assert.equal(p.actions.length,3);assert.equal(p.actions[0].own_ad_ids.length,0);
});
test('private archived media endpoint denies anonymous access before reading storage',async()=>{
 const {default:handler}=await import('../api/inspiration-media.js');const prev=process.env.INSPIRATION_ENABLED;process.env.INSPIRATION_ENABLED='true';
 const res={setHeader(){},status(code){this.code=code;return this;},end(){}};
 try{await handler({method:'GET',query:{id:'123',kind:'image'},headers:{}},res);assert.equal(res.code,401);}finally{if(prev===undefined)delete process.env.INSPIRATION_ENABLED;else process.env.INSPIRATION_ENABLED=prev;}
});
test('generation reports real stages and failed validation never reports success',async()=>{
 const base=memoryStore(),stages=[];
 const store=async args=>{if(args[0]==='SET'&&args[1].endsWith('plan-progress'))stages.push(JSON.parse(args[2]).stage);return base(args);};
 const make=result=>createIntelligence({env:{INSPIRATION_AI_ENABLED:'true',GEMINI_API_KEY:'test'},store,now,service:{list:async()=>({ads:[ad],brands})},client:{models:{generateContent:async()=>{assert.equal((await base(['GET','dtc:inspiration:plan-progress'])).includes('generating'),true);return result;}}}});
 const s=make({text:JSON.stringify(plan),candidates:[{finishReason:'STOP'}]});
 await s.generate();assert.deepEqual(stages,['collecting','generating','validating','saving','complete']);
 stages.length=0;await s.generate();assert.deepEqual(stages,['collecting','complete']);
 const fresh=createIntelligence({env:{INSPIRATION_AI_ENABLED:'true',GEMINI_API_KEY:'test'},store:memoryStore(),now,service:{list:async()=>({ads:[],brands})}});
 await assert.rejects(fresh.generate(),/no_ads/);assert.equal((await fresh.progress()).stage,'failed');
});
