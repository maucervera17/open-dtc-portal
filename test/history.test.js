import test from 'node:test';
import assert from 'node:assert/strict';
import { range, days, BadRequestError } from '../lib/dash/validate.js';
import { parseAllowlist, isAllowed } from '../lib/auth/allowlist.js';
import { createSales } from '../lib/dash/sales.js';

test('accepts two years including a leap day and historical custom periods', () => {
  assert.deepEqual(range('2024-10-28', '2026-10-28', '2026-10-28'), {from:'2024-10-28',to:'2026-10-28'});
  assert.doesNotThrow(() => range('2024-01-01','2025-12-31','2026-10-28'));
  assert.doesNotThrow(() => range('2024-10-01','2024-10-31','2026-10-28'));
  for (const [a,b] of [['2023-01-01','2026-01-01'],['2026-10-28','2026-10-27'],['2026-02-30','2026-03-01'],['2026-10-28','2026-10-29']]) assert.throws(() => range(a,b,'2026-10-28'),BadRequestError);
  assert.equal(days('90'),90); assert.throws(() => days('730'),BadRequestError);
});
test('explicit invitation retains existing users and rejects unlisted or malformed entries', () => {
  const list=parseAllowlist('owner@example.com,second@example.com,third@example.com');
  for(const email of ['owner@example.com','second@example.com','third@example.com']) assert.equal(isAllowed(list,email),true);
  assert.equal(isAllowed(list,'unknown@example.com'),false);
  assert.equal(parseAllowlist('owner@example.com,OWNER@example.com').valid,false);
  assert.equal(parseAllowlist('owner@example.com,broken').valid,false);
  assert.equal(parseAllowlist('').valid,false);
});
test('historical campaign queries retain archived campaigns and skip out-of-history comparison', async () => {
  const calls=[];
  const client={list:async (path,params) => {
    calls.push({path,params});
    if(path.endsWith('/campaigns')) return [{id:'123',effective_status:'ARCHIVED'}];
    if(!path.endsWith('/insights')) return [];
    if(params.level==='campaign' && params.fields.includes('campaign_name')) return [{campaign_id:'123',campaign_name:'Historical campaign',spend:'12',impressions:'100'}];
    return [];
  }};
  const api=createSales({client,accountId:'1',D:'2026-10-28',now:()=>Date.parse('2026-10-28T12:00:00Z')});
  const r={from:'2024-10-28',to:'2026-10-27'};
  const tree=await api.campaigns(r);
  assert.equal(tree.campaigns[0].name,'Historical campaign');
  assert.equal(tree.campaigns[0].status,'ARCHIVED');
  const summary=await api.sales(r);
  assert.equal(summary.previous_range,null);
  assert.equal(summary.previous.spend,null);
  assert.equal(summary.series.length,730);
  assert(calls.filter(c=>c.params.time_range).every(c=>JSON.parse(c.params.time_range).since>='2024-10-28'));
  calls.length=0;
  const recent=await api.sales({from:'2026-10-21',to:'2026-10-27'});
  assert.deepEqual(recent.previous_range,{from:'2026-10-14',to:'2026-10-20'});
});
