import test from 'node:test';
import assert from 'node:assert/strict';
import {signalsFor,observedDays,marketSnapshot} from '../public/app/views/creative-signals.js';
const now=Date.parse('2026-10-29T12:00:00Z');
const a={id:'1',brand_id:'a',page_name:'A',body:'Un mensaje',is_active:true,format:'VIDEO',started_at:'2026-09-01T12:00:00Z',observed_at:'2026-10-29T12:00:00Z'};
test('creative evidence groups exact copy within a brand and only active ads',()=>{
 const ads=[a,{...a,id:'2',body:' UN mensaje  '},{...a,id:'3',brand_id:'b'},{...a,id:'4',is_active:false}];
 assert.equal(signalsFor(a,ads,now).variants,2);assert.equal(marketSnapshot(ads,now).repeated.length,1);assert.equal(marketSnapshot(ads,now).active,3);
});
test('duration stops at observation and missing dates never become measured zero',()=>{
 assert.equal(observedDays({...a,observed_at:'2026-09-03T12:00:00Z'}),2);assert.equal(observedDays({...a,started_at:null}),null);assert.equal(signalsFor({...a,observed_at:'2026-09-03T12:00:00Z'},[a],now).stale,true);
});
test('recent launches exclude future dates and inactive ads',()=>{
 const s=marketSnapshot([a,{...a,id:'2',started_at:'2026-10-28T12:00:00Z'},{...a,id:'3',started_at:'2026-11-02T12:00:00Z'},{...a,id:'4',is_active:false,started_at:'2026-10-28T12:00:00Z'}],now);
 assert.equal(s.new7,1);assert.equal(s.long,1);assert.deepEqual(s.formats,[['VIDEO',3]]);
});
test('candidate label requires fresh activity, persistence and repeated copy together',()=>{const rows=[a,{...a,id:'2'}];assert.equal(signalsFor(a,rows,now).candidate,true);assert.equal(signalsFor(a,[a],now).candidate,false);assert.equal(signalsFor({...a,is_active:false},rows,now).candidate,false);assert.equal(signalsFor({...a,observed_at:'2026-10-01'},rows,now).candidate,false);});

test('classification has no arbitrary cap and preserves equally supported variants',async()=>{
 const {prioritizeAds}=await import('../public/app/views/creative-signals.js');
 const rows=Array.from({length:20},(_,i)=>({...a,id:String(i),brand_id:String(Math.floor(i/4))}));
 const result=prioritizeAds(rows,now);
 assert.equal([...result.values()].filter(x=>x.tier==='priority').length,20);
 assert.ok([...result.values()].every(x=>!x.label.includes('ganador')));
});
test('new, undated, stale and inactive references need review',async()=>{
 const {prioritizeAds}=await import('../public/app/views/creative-signals.js');
 const rows=[{...a,id:'1',started_at:null},{...a,id:'2',is_active:false},{...a,id:'3',observed_at:'2026-09-01'},{...a,id:'4',started_at:'2026-10-28T12:00:00Z'}];
 const result=prioritizeAds(rows,now);
 assert.equal(result.get('1').tier,'insufficient');assert.equal(result.get('4').tier,'insufficient');
 assert.equal(result.get('2').tier,'insufficient');assert.equal(result.get('3').tier,'insufficient');
});
test('repetition excludes duplicate IDs and observations that are stale or in the future',()=>{
 const rows=[a,a,{...a,id:'2',observed_at:'2026-10-01'},{...a,id:'3',observed_at:'2026-11-01'}];
 assert.equal(signalsFor(a,rows,now).variants,1);assert.equal(signalsFor(a,rows,now).candidate,false);
});
test('related gallery contains exactly the unique, fresh same-brand ads used by the repetition count',async()=>{
 const {relatedAds}=await import('../public/app/views/creative-signals.js');
 const rows=[a,a,{...a,id:'2'},{...a,id:'3',brand_id:'b'},{...a,id:'4',body:'Otro texto'},{...a,id:'5',is_active:false},{...a,id:'6',observed_at:'2026-10-01'}];
 const family=relatedAds(a,rows,now);assert.deepEqual(family.map(x=>x.id),['1','2']);assert.equal(family.length,signalsFor(a,rows,now).variants);
});
test('priority explanation identifies an already selected message and gives a concrete comparison',async()=>{
 const {prioritizeAds,creativeReading}=await import('../public/app/views/creative-signals.js');
 const sibling={...a,id:'2'};const priorities=prioritizeAds([a,sibling],now);
 assert.equal(priorities.get('2').tier,priorities.get('1').tier);
 assert.match(priorities.get('2').reason,/compara sus ejecuciones/);
 const reading=creativeReading({...a,body:'Razones para elegirnos\n✨ Un argumento\n✅ Otro argumento\n⚡ Tercer argumento\nHasta 40% OFF'});
 assert.match(reading.did,/Razones para elegirnos/);assert.match(reading.did,/40% OFF/);assert.ok(reading.action);
});

test('multiple qualified messages per brand retain priority without counting variants',async()=>{
 const {prioritizeAds,referenceFamilies}=await import('../public/app/views/creative-signals.js');
 const rows=[a,{...a,id:'2'}, {...a,id:'3'}, {...a,id:'4',body:'Alternativa'}, {...a,id:'5',body:'Alternativa'}, {...a,id:'6',body:'Nueva',started_at:'2026-10-28T12:00:00Z'}];
 const p=prioritizeAds(rows,now),families=referenceFamilies(rows,p);
 assert.equal(families.length,3);
 assert.deepEqual(families.map(a=>p.get(a.id).tier),['priority','priority','insufficient']);
 assert.equal(rows.length,6);
});

test('classification is independent of unrelated brands and includes distinct partial evidence',async()=>{
 const {prioritizeAds}=await import('../public/app/views/creative-signals.js');
 const repeated={...a,id:'repeat',body:'young repeated',started_at:'2026-10-15T12:00:00Z'};
 const rows=[a,{...a,id:'2'},repeated,{...repeated,id:'repeat2'},{...a,id:'single',body:'old single'},{...a,id:'weak',body:'weak',started_at:'2026-10-15T12:00:00Z'}];
 const before=prioritizeAds(rows,now),after=prioritizeAds([...rows,...rows.map(x=>({...x,id:'other-'+x.id,brand_id:'other'}))],now);
 for(const ad of rows)assert.equal(before.get(ad.id).tier,after.get(ad.id).tier);
 assert.equal(before.get('repeat').tier,'test');assert.equal(before.get('single').tier,'test');assert.equal(before.get('weak').tier,'insufficient');
});
