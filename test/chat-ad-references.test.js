import test from 'node:test';
import assert from 'node:assert/strict';
import {adCatalog,extractAdReferences,storedCards} from '../lib/agent/ad-references.js';
import {appendExchange,loadConversation} from '../lib/agent/conversations.js';
import {memoryStore} from '../scripts/inspiration-store.mjs';
test('brand question selects that brand and ranks observable active signals',()=>{
 const ads=[{id:'1',brand_id:'beta',page_name:'Beta Brand',body:'Uno',is_active:true},{id:'2',brand_id:'other',page_name:'Other',body:'Dos',is_active:true},{id:'3',brand_id:'beta',page_name:'Beta Brand',body:'Uno',is_active:false}];
 const catalog=adCatalog(ads,'Cuál es el mejor anuncio de Beta');
 assert.deepEqual(catalog.map(a=>a.id),['1','3']);assert.equal(catalog[0].repetitions,2);
});
test('unknown references cannot create cards and IDs are removed before numeric grounding',()=>{
 const out=extractAdReferences('Esta referencia [[ad:123]] [[ad:fake]] [[ad:123]]',[{id:'123',brand:'Beta'}]);
 assert.equal(out.ads.length,1);assert.equal(out.answer,'Esta referencia');
 assert.deepEqual(storedCards([{id:'https://evil.test',brand:'x'}]),[]);
});
test('ad cards survive persisted conversations without accepting arbitrary media URLs',async()=>{
 const store=memoryStore(),now=()=>Date.now();
 const doc=await appendExchange({store,user:'qa',now,question:'Beta',answer:'Referencia',ads:[{id:'123',brand:'Beta',copy:'Texto',video:true,url:'https://evil.test'}]});
 const loaded=await loadConversation({store,user:'qa',id:doc.id});
 assert.deepEqual(loaded.messages[1].ads,[{id:'123',brand:'Beta',copy:'Texto',video:true}]);
});
