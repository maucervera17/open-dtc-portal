import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createTokens,TOKEN_TTL} from '../lib/mcp/tokens.js';
import {createPortalMcpHandler,TOOLS} from '../lib/mcp/server.js';
import {createDashHandler} from '../lib/dash/router.js';
import {createSessions} from '../lib/auth/session.js';
function memory(){const m=new Map();return async([op,k,...a])=>{let v=m.get(k);switch(op){
case 'GET':return v||null;case 'SET':m.set(k,a[0]);return 'OK';case 'DEL':return Number(m.delete(k));case 'SADD':return 1;case 'EXPIRE':return 1;
case 'HGETALL':return Object.entries(v||{}).flat();case 'HGET':return v?.[a[0]]||null;case 'HDEL':if(v)delete v[a[0]];return 1;
case 'INCR':m.set(k,Number(v||0)+1);return m.get(k);
case 'EVAL':{const [,actual,id,record]=a;const rows=m.get(actual)||{};if(Object.keys(rows).length>=10)return 0;rows[id]=record;m.set(actual,rows);return 1;}
default:throw Error(op);}};}
const settings=()=>({DASH_ENABLED:'true',DASH_BASE_URL:'https://portal.example.com',DASH_SESSION_SECRET:'test-secret-32-bytes-not-production-value',DASH_ALLOWED_EMAILS:'owner@example.com,member@example.com'});
test('personal MCP keys expire, revoke, isolate owners, enforce allowlist and cap',async()=>{
 const env=settings(),store=memory();let time=Date.now();const tokens=createTokens({env,store,now:()=>time});
 const first=await tokens.create('owner@example.com','Codex');assert.ok(await tokens.check(first.token));
 const listing=await tokens.list('owner@example.com');assert.equal(listing.length,1);assert.equal('token' in listing[0],false);assert.equal('email' in listing[0],false);
 await tokens.revoke('member@example.com',first.id);assert.ok(await tokens.check(first.token));
 env.DASH_ALLOWED_EMAILS='member@example.com';assert.equal(await tokens.check(first.token),null);env.DASH_ALLOWED_EMAILS=settings().DASH_ALLOWED_EMAILS;
 await tokens.revoke('owner@example.com',first.id);assert.equal(await tokens.check(first.token),null);
 const second=await tokens.create('owner@example.com','Claude');time+=TOKEN_TTL*1000+1;assert.equal(await tokens.check(second.token),null);
 for(let i=0;i<10;i++)await tokens.create('owner@example.com',`Key ${i}`);
 await assert.rejects(tokens.create('owner@example.com','overflow'),/token_limit/);
 assert.equal(await tokens.check('invented'),null);
});
test('MCP HTTP protocol authenticates initialize and tools, validates queries and revokes immediately',async()=>{
 const env=settings(),store=memory(),tokens=createTokens({env,store});let calls=0;
 const cred=await tokens.create('owner@example.com','test');
 const handler=createPortalMcpHandler({env,store,routes:{sales:async ctx=>{calls++;assert.equal(ctx.email,'owner@example.com');return {status:200,body:{sales:42,range:ctx.params}};}}});
 const server=http.createServer(async(req,res)=>{res.status=code=>{res.statusCode=code;return res;};res.json=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};let b='';for await(const chunk of req)b+=chunk;req.body=b?JSON.parse(b):undefined;await handler(req,res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url=new URL(`http://127.0.0.1:${server.address().port}/api/mcp`);
 const client=new Client({name:'test',version:'1'});
 try{
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
 assert.equal((await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${cred.token}`,Origin:'https://evil.example'}})).status,403);
 await client.connect(new StreamableHTTPClientTransport(url,{requestInit:{headers:{Authorization:`Bearer ${cred.token}`}}}));
 const list=await client.listTools();assert.equal(list.tools.length,TOOLS.length);assert.ok(list.tools.every(t=>t.annotations.readOnlyHint));
 const result=await client.callTool({name:'get_sales',arguments:{from:'2026-01-01',to:'2026-01-07'}});assert.equal(JSON.parse(result.content[0].text).sales,42);
 const invalid=await client.callTool({name:'get_sales',arguments:{from:'2026-02-30',to:'2026-03-01'}});assert.equal(invalid.isError,true);assert.equal(calls,1);
 await tokens.revoke('owner@example.com',cred.id);await assert.rejects(client.listTools());
 }finally{await client.close();await new Promise(r=>server.close(r));}
});
test('token management requires real session, same origin and owns its keys',async()=>{
 const env=settings(),store=memory(),session=await createSessions({env,store,now:Date.now}).create('owner@example.com');
 const handler=createDashHandler({env,store});
 async function call(headers={},r='mcp/create',method='POST',body={name:'Codex'}){let status,data;const res={setHeader(){},status(n){status=n;return this;},json(d){data=d;return this;},end(){}};await handler({headers,method,query:{r},body},res);return {status,data};}
 assert.equal((await call({origin:env.DASH_BASE_URL,'content-type':'application/json'})).status,401);
 assert.equal((await call({cookie:`__Host-dtc_dash=${session.sid}`,origin:'https://evil.example','content-type':'application/json'})).status,403);
 const good=await call({cookie:`__Host-dtc_dash=${session.sid}`,origin:env.DASH_BASE_URL,'content-type':'application/json'});assert.equal(good.status,201);assert.ok(good.data.token.startsWith('dtcmcp_'));
});
test('keys are read-only and reject unknown scopes',async()=>{
 const tokens=createTokens({env:settings(),store:memory()});
 const read=await tokens.create('owner@example.com','read');assert.equal((await tokens.check(read.token)).scope,'portal:read');
 await assert.rejects(tokens.create('owner@example.com','invalid','admin'),/invalid_scope/);
 await tokens.revoke('owner@example.com',read.id);assert.equal(await tokens.check(read.token),null);
});
