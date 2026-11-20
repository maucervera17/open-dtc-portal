import test from 'node:test';
import assert from 'node:assert/strict';
import {configuredAllowlist,isAllowed} from '../lib/auth/allowlist.js';
test('team access merges overlapping sources while retaining prior users',()=>{
 const list=configuredAllowlist({DASH_ALLOWED_EMAILS:'owner@example.com',DASH_ADDITIONAL_EMAILS:'existing@example.com',DASH_TEAM_EMAILS:'owner@example.com,new@example.com'});
 assert.equal(list.valid,true);assert.equal(list.count,3);assert.equal(isAllowed(list,'existing@example.com'),true);assert.equal(isAllowed(list,'new@example.com'),true);
});
test('invalid sources and aggregate limits fail closed',()=>{
 assert.equal(configuredAllowlist({DASH_ALLOWED_EMAILS:'a@example.com,a@example.com',DASH_TEAM_EMAILS:'b@example.com'}).valid,false);
 assert.equal(configuredAllowlist({DASH_ALLOWED_EMAILS:Array.from({length:20},(_,i)=>`u${i}@example.com`).join(','),DASH_TEAM_EMAILS:'extra@example.com'}).valid,false);
});
