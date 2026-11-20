import test from 'node:test';
import assert from 'node:assert/strict';
import {marketActivity} from '../public/app/views/market-data.js';
const now=Date.parse('2026-10-30T12:00:00Z');
const ad=(id,date,body='energía')=>({id,brand_id:'a',page_name:'Marca',started_at:date,body});
test('launch cadence uses distinct dates, deduplicates ads and excludes future launches',()=>{
 const a=ad('1','2026-10-01T12:00:00Z');
 const result=marketActivity([a,a,ad('2','2026-10-01T18:00:00Z'),ad('3','2026-10-08T12:00:00Z'),ad('4','2026-11-01T12:00:00Z')],now);
 assert.equal(result.brands[0].gap,7);assert.equal(result.brands[0].launchDays,2);assert.equal(result.recent,1);
});
test('topic growth compares shares and never invents a comparison without a prior cohort',()=>{
 const r=marketActivity([ad('1','2026-10-29T12:00:00Z'),ad('2','2026-09-20T12:00:00Z','sueño'),ad('3','2026-10-29T12:00:00Z','descanso')],now);
 assert.equal(r.topics.find(t=>t.label==='Energía y enfoque').delta,50);
 const solo=marketActivity([ad('1','2026-10-29T12:00:00Z')],now);assert.equal(solo.topics[0].delta,null);
});
