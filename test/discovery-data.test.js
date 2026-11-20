import test from 'node:test';
import assert from 'node:assert/strict';
import {reportedMetric,normalizeAd,SEED_BRANDS} from '../lib/inspiration/model.js';
import './fixtures/brands.js';
import {discoverySignals,sortDiscovery,estimatedSpend} from '../public/app/views/discovery-data.js';
const now=Date.parse('2026-10-30T12:00:00Z'),a={id:'1',brand_id:'a',body:'Mensaje',is_active:true,started_at:'2026-10-01',observed_at:'2026-10-30T10:00:00Z'};
test('reported metrics preserve missing data and never treat impression index as a count',()=>{
 assert.equal(reportedMetric(null),null);assert.equal(reportedMetric(-1),null);assert.equal(reportedMetric(''),null);assert.deepEqual(reportedMetric({lower_bound:0,upper_bound:100}),{lower:0,upper:100});
 const ad=normalizeAd({ad_archive_id:'123',page_id:SEED_BRANDS[0].page_id,impressions_with_index:{impressions_index:5},snapshot:{}},SEED_BRANDS[0],'2026-10-30');assert.equal(ad.impressions,null);
});
test('CPM estimates require actual impressions, never reach or rank',()=>{
 assert.equal(estimatedSpend({reach:1000,impressions_text:'unknown'},12),null);assert.equal(estimatedSpend({impressions:1000},12),12);assert.deepEqual(estimatedSpend({impressions:{lower:1000,upper:2000}},12),{lower:12,upper:24});
});
test('Trending requires recent launch, current observation and repetition',()=>{
 assert.equal(discoverySignals(a,[a],now).trending,false);assert.equal(discoverySignals({...a,collation_count:3},[a],now).trending,true);assert.equal(discoverySignals({...a,collation_count:3,is_active:false},[a],now).trending,false);assert.equal(discoverySignals({...a,collation_count:3,started_at:'2025-01-01'},[a],now).trending,false);
});
test('sorting keeps missing reach last and distinguishes favorites from global popularity',()=>{
 const rows=[{...a,id:'1',reach:null},{...a,id:'2',reach:300},{...a,id:'3',reach:100,favorite:true}];assert.deepEqual(sortDiscovery(rows,'reach').map(x=>x.id),['2','3','1']);assert.equal(sortDiscovery(rows,'saved')[0].id,'3');
});
test('Trending groups repeated families rather than filling the feed with the same message',async()=>{
 const {groupTrending}=await import('../public/app/views/discovery-data.js');assert.equal(groupTrending([a,{...a,id:'2'},{...a,id:'3',body:'Otro mensaje'}]).length,2);
});

test('remote filter changes invalidate pagination while local filters do not',async()=>{
 const {sameDiscoveryQuery}=await import('../public/app/views/discovery-data.js');
 const q={query:'adaptogenos',country:'ALL',media:'ALL',status:'ALL',language:'ALL',matching:'keyword_unordered',sort:'total_impressions'};
 assert.equal(sameDiscoveryQuery(q,null),false);
 for(const k of Object.keys(q))assert.equal(sameDiscoveryQuery({...q,[k]:'different'},q),false,k);
 assert.equal(sameDiscoveryQuery({...q,platform:'INSTAGRAM',age:'30'},q),true);
});
test('format filters include video and image assets in dynamic ads',async()=>{
 const {matchesDiscoveryFormat:matches}=await import('../public/app/views/discovery-data.js');
 assert.equal(matches({format:'DCO',video_url:'https://example.com/video'},'VIDEO'),true);
 assert.equal(matches({format:'DCO',video_url:'https://example.com/video',image_url:'poster'},'IMAGE'),false);
 assert.equal(matches({format:'CAROUSEL',cards:[{image_url:'image'}]},'IMAGE'),true);
 assert.equal(matches({format:'IMAGE'},'VIDEO'),false);
});
