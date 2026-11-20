import { createHash, randomUUID } from 'node:crypto';
import { K, TTL } from './store.js';
import { logEvent } from './log.js';

const POLL_MS = 250;
const POLL_MAX = 32; // 8 s
const SIGNED_URL = /fbcdn|cdninstagram/i;
// Owner-checked release: only the holder of the lock may delete it.
export const RELEASE = 'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end';

export class BusyError extends Error {
  constructor() { super('busy'); this.name = 'BusyError'; }
}

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
};
export const paramsHash = params => createHash('sha256').update(canonical(params)).digest('hex');
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

// Signed CDN URLs expire, so they never sit in cache or stale copies (D11). Returns a clone with them nulled
// plus the URLs grouped by the nearest enclosing ad id, ready to be stored under media:{ad_id}.
export function stripMedia(input) {
  const media = {};
  const walk = (node, adId) => {
    if (Array.isArray(node)) return node.map(item => walk(item, adId));
    if (!node || typeof node !== 'object') return node;
    const id = typeof node.id === 'string' && (node.creative || node.media_type) ? node.id : adId;
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (typeof value === 'string' && SIGNED_URL.test(value)) {
        if (id) (media[id] ||= {})[key] = value;
        out[key] = null;
      } else out[key] = walk(value, id);
    }
    return out;
  };
  return { payload: walk(input, null), media };
}

// Re-attaches signed URLs from media:* with one MGET (ads and IG posts). A missing entry stays null and the UI shows a placeholder.
async function attachMedia(store, input) {
  const ads = Array.isArray(input?.ads) ? input.ads : [];
  const posts = Array.isArray(input?.posts) ? input.posts : [];
  const ids = [...new Set([...ads, ...posts].map(item => item?.id).filter(id => typeof id === 'string'))];
  if (!ids.length) return input;
  const values = await store(['MGET', ...ids.map(K.media)]);
  const byId = new Map(ids.map((id, i) => [id, parse(values[i]) || {}]));
  return {
    ...input,
    ...(Array.isArray(input.ads) ? { ads: ads.map(ad => {
      const found = byId.get(ad?.id) || {};
      return { ...ad, creative: ad?.creative ? { ...ad.creative, thumbnail_url: found.thumbnail_url ?? null, image_url: found.image_url ?? null } : ad?.creative };
    }) } : {}),
    ...(Array.isArray(input.posts) ? { posts: posts.map(post => ({ ...post, thumbnail_url: (byId.get(post?.id) || {}).thumbnail_url ?? null })) } : {}),
  };
}

// Cache with a stampede lock: one winner loads and writes, losers poll the cache and never call Meta.
export function createCache({ store, now = Date.now, sleep, usage = async () => ({ cacheTtl: TTL.cache, stale: false }), uuid = randomUUID } = {}) {
  const wait = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

  async function read(module, params, { load, refresh = false, media = false } = {}) {
    const hash = paramsHash(params);
    const cacheKey = K.cache(module, hash), staleKey = K.stale(module, hash), lockKey = K.lock(module, hash);
    const finish = async (body, source) => ({ ...(media ? await attachMedia(store, body) : body), source });
    const fromKey = async key => parse(await store(['GET', key]));

    if (!refresh) {
      const hit = await fromKey(cacheKey);
      if (hit) return finish(hit, 'cache');
    }
    const { cacheTtl, stale: serveStale } = await usage();
    if (serveStale) {
      const old = await fromKey(staleKey);
      if (old) return finish(old, 'stale');
    }

    const owner = uuid();
    if (await store(['SET', lockKey, owner, 'NX', 'EX', TTL.lock]) === 'OK') {
      try {
        const live = await load();
        const { payload, media: urls } = stripMedia(live);
        const text = JSON.stringify(payload);
        await store(['SET', cacheKey, text, 'EX', cacheTtl]);
        await store(['SET', staleKey, text, 'EX', TTL.stale]);
        for (const [adId, value] of Object.entries(urls)) await store(['SET', K.media(adId), JSON.stringify(value), 'EX', TTL.media]);
        return { ...live, source: 'live' };
      } catch (error) {
        const old = await fromKey(staleKey);
        if (!old) throw error;
        logEvent('dash_cache', { stage: module, code: 'stale_fallback' });
        return finish(old, 'stale');
      } finally {
        try { await store(['EVAL', RELEASE, 1, lockKey, owner]); } catch { /* the lock expires after 30 s */ }
      }
    }

    for (let i = 0; i < POLL_MAX; i++) {
      await wait(POLL_MS);
      const hit = await fromKey(cacheKey);
      if (hit) return finish(hit, 'cache');
    }
    const old = await fromKey(staleKey);
    if (old) return finish(old, 'stale');
    throw new BusyError();
  }

  return { read };
}
