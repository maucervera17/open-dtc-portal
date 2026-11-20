import { randomBytes } from 'node:crypto';
import { hmac, key } from '../dash/store.js';
import { configuredAllowlist, isAllowed } from '../auth/allowlist.js';
import { secretOk } from '../auth/session.js';
export const TOKEN_TTL = 90 * 86400;
const CREATE = `if redis.call('HLEN',KEYS[1]) >= 10 then return 0 end redis.call('HSET',KEYS[1],ARGV[1],ARGV[2]); redis.call('EXPIRE',KEYS[1],ARGV[3]); return 1`;
export function createTokens({ env, store, now = Date.now }) {
  const digest = value => hmac(env.DASH_SESSION_SECRET, value);
  const userKey = email => key('mcp','tokens',digest(email));
  const allowed = email => secretOk(env) && isAllowed(configuredAllowlist(env),email);
  async function list(email) {
    const raw = await store(['HGETALL',userKey(email)]) || [];
    const records = Array.isArray(raw) ? Object.fromEntries(Array.from({length:raw.length/2},(_,i)=>[raw[i*2],raw[i*2+1]])) : raw;
    const out=[];
    for(const [id,value] of Object.entries(records)) {
      let r; try { r=JSON.parse(value); } catch { continue; }
      if(r.expiresAt<=now()) { await store(['HDEL',userKey(email),id]); continue; }
      out.push({id,name:r.name,scope:r.scope,createdAt:r.createdAt,expiresAt:r.expiresAt});
    }
    return out;
  }
  async function create(email,name,scope='portal:read') {
    if(!allowed(email)) throw Error('unauthorized');
    if(typeof name!=='string'||!name.trim()||name.length>60) throw Error('invalid_name');
    if(!['portal:read'].includes(scope)) throw Error('invalid_scope');
    await list(email);
    const secret=randomBytes(32).toString('base64url'), id=digest(secret);
    const record={email,name:name.trim(),scope,createdAt:now(),expiresAt:now()+TOKEN_TTL*1000};
    const result=await store(['EVAL',CREATE,1,userKey(email),id,JSON.stringify(record),TOKEN_TTL]);
    if(Number(result)!==1) throw Error('token_limit');
    return {token:`dtcmcp_${digest(email)}.${secret}`,id,...record};
  }
  async function check(token) {
    if(!secretOk(env)||typeof token!=='string'||!/^dtcmcp_[\w-]{43}\.[\w-]{43}$/.test(token))return null;
    const [user,secret]=token.slice(7).split('.');
    const raw=await store(['HGET',key('mcp','tokens',user),digest(secret)]);
    let record;try{record=JSON.parse(raw);}catch{return null;}
    if(!record||record.expiresAt<=now()||!['portal:read'].includes(record.scope)||!allowed(record.email)||digest(record.email)!==user)return null;
    return {email:record.email,scope:record.scope,tokenId:digest(secret)};
  }
  async function revoke(email,id) {
    if(!/^[\w-]{43}$/.test(id))throw Error('invalid_id');
    await store(['HDEL',userKey(email),id]);
  }
  return {list,create,check,revoke};
}
