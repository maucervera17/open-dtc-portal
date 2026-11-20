// In-memory stand-in for the Upstash REST store used by lib/dash/store.js: `store(['CMD', ...args]) -> result`.
// It implements exactly the commands the portal uses, plus the handful of Lua scripts sent through EVAL (matched by
// their text). An unsupported command or script throws loudly instead of guessing.

const wrongType = () => new Error('WRONGTYPE');

export function createMemoryStore({ now = Date.now } = {}) {
  const data = new Map(); // key -> { type, value, expiresAt }

  const live = key => {
    const entry = data.get(key);
    if (!entry) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= now()) { data.delete(key); return null; }
    return entry;
  };
  const read = (key, type) => {
    const entry = live(key);
    if (!entry) return null;
    if (entry.type !== type) throw wrongType();
    return entry.value;
  };
  const write = (key, type, value, keepTtl = true) => {
    const old = live(key);
    data.set(key, { type, value, expiresAt: keepTtl && old ? old.expiresAt : null });
  };
  const expire = (key, seconds) => {
    const entry = live(key);
    if (!entry) return 0;
    entry.expiresAt = now() + Number(seconds) * 1000;
    return 1;
  };
  const str = value => String(value);
  const hash = key => read(key, 'hash') ?? new Map();
  const set = key => read(key, 'set') ?? new Set();
  const zset = key => read(key, 'zset') ?? new Map();
  const slice = (list, start, stop) => {
    const n = list.length;
    let a = Number(start), b = Number(stop);
    if (a < 0) a = Math.max(0, n + a);
    if (b < 0) b = n + b;
    return b < a ? [] : list.slice(a, b + 1);
  };
  const incrBy = (key, by) => {
    const next = Number(read(key, 'string') ?? 0) + Number(by);
    write(key, 'string', str(next));
    return next;
  };

  const SCRIPTS = [
    // MCP key creation: refuse above 10 per owner.
    [/HLEN/, ([key], [id, record, ttl]) => {
      const h = hash(key);
      if (h.size >= 10) return 0;
      h.set(str(id), str(record)); write(key, 'hash', h); expire(key, ttl); return 1;
    }],
    // Owner-checked lock release.
    [/get.*==\s*ARGV\[1\].*del/is, ([key], [owner]) => {
      if (read(key, 'string') !== str(owner)) return 0;
      data.delete(key); return 1;
    }],
    // Rate limiter: INCR and set the TTL on the first hit.
    [/c==1.*EXPIRE/s, ([key], [ttl]) => { const c = incrBy(key, 1); if (c === 1) expire(key, ttl); return c; }],
    // Byte budget: refuse when n + ARGV[1] would pass ARGV[2].
    [/n\+tonumber\(ARGV\[1\]\)>tonumber\(ARGV\[2\]\)/, ([key], [by, cap]) => {
      const n = Number(read(key, 'string') ?? 0);
      return n + Number(by) > Number(cap) ? -1 : incrBy(key, by);
    }],
    // Call budget: refuse when n has reached ARGV[1].
    [/n>=tonumber\(ARGV\[1\]\)/, ([key], [cap]) => (Number(read(key, 'string') ?? 0) >= Number(cap) ? -1 : incrBy(key, 1))],
    // Monotonic cursor.
    [/p<ARGV\[1\]/, ([key], [value]) => { const p = read(key, 'string'); if (p === null || p < str(value)) write(key, 'string', str(value)); return 1; }],
  ];

  async function store(command) {
    const [name, key, ...args] = command;
    switch (String(name).toUpperCase()) {
      case 'GET': return read(key, 'string');
      case 'MGET': return [key, ...args].map(k => { const e = live(k); return e && e.type === 'string' ? e.value : null; });
      case 'SET': {
        const flags = args.slice(1).map(a => String(a).toUpperCase());
        if (flags.includes('NX') && live(key)) return null;
        if (flags.includes('XX') && !live(key)) return null;
        data.set(key, { type: 'string', value: str(args[0]), expiresAt: null });
        const ex = flags.indexOf('EX'), px = flags.indexOf('PX');
        if (ex >= 0) expire(key, args[1 + ex + 1]);
        if (px >= 0) data.get(key).expiresAt = now() + Number(args[1 + px + 1]);
        return 'OK';
      }
      case 'DEL': return [key, ...args].reduce((n, k) => n + (live(k) ? (data.delete(k), 1) : 0), 0);
      case 'GETDEL': { const v = read(key, 'string'); if (v !== null) data.delete(key); return v; }
      case 'EXISTS': return [key, ...args].filter(k => live(k)).length;
      case 'EXPIRE': return expire(key, args[0]);
      case 'TTL': { const e = live(key); return !e ? -2 : e.expiresAt === null ? -1 : Math.ceil((e.expiresAt - now()) / 1000); }
      case 'INCR': return incrBy(key, 1);
      case 'INCRBY': return incrBy(key, args[0]);
      case 'DECR': return incrBy(key, -1);
      case 'HSET': { const h = hash(key); let added = 0; for (let i = 0; i < args.length; i += 2) { if (!h.has(str(args[i]))) added++; h.set(str(args[i]), str(args[i + 1])); } write(key, 'hash', h); return added; }
      case 'HSETNX': { const h = hash(key); if (h.has(str(args[0]))) return 0; h.set(str(args[0]), str(args[1])); write(key, 'hash', h); return 1; }
      case 'HGET': return hash(key).get(str(args[0])) ?? null;
      case 'HMGET': return args.map(f => hash(key).get(str(f)) ?? null);
      case 'HGETALL': return [...hash(key)].flat();
      case 'HLEN': return hash(key).size;
      case 'HDEL': { const h = hash(key); let n = 0; for (const f of args) n += h.delete(str(f)) ? 1 : 0; write(key, 'hash', h); return n; }
      case 'SADD': { const s = set(key); let n = 0; for (const m of args) if (!s.has(str(m))) { s.add(str(m)); n++; } write(key, 'set', s); return n; }
      case 'SREM': { const s = set(key); let n = 0; for (const m of args) n += s.delete(str(m)) ? 1 : 0; write(key, 'set', s); return n; }
      case 'SMEMBERS': return [...set(key)];
      case 'ZADD': { const z = zset(key); let n = 0; for (let i = 0; i < args.length; i += 2) { if (!z.has(str(args[i + 1]))) n++; z.set(str(args[i + 1]), Number(args[i])); } write(key, 'zset', z); return n; }
      case 'ZREM': { const z = zset(key); let n = 0; for (const m of args) n += z.delete(str(m)) ? 1 : 0; write(key, 'zset', z); return n; }
      case 'ZCARD': return zset(key).size;
      case 'ZRANGE': return slice([...zset(key)].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1)).map(e => e[0]), args[0], args[1]);
      case 'ZREVRANGE': return slice([...zset(key)].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1)).map(e => e[0]), args[0], args[1]);
      case 'ZREMRANGEBYSCORE': {
        const z = zset(key), lo = args[0] === '-inf' ? -Infinity : Number(args[0]), hi = args[1] === '+inf' ? Infinity : Number(args[1]);
        let n = 0; for (const [m, s] of [...z]) if (s >= lo && s <= hi) { z.delete(m); n++; }
        write(key, 'zset', z); return n;
      }
      case 'LPUSH': { const l = read(key, 'list') ?? []; for (const v of args) l.unshift(str(v)); write(key, 'list', l); return l.length; }
      case 'LRANGE': return slice(read(key, 'list') ?? [], args[0], args[1]);
      case 'LTRIM': { write(key, 'list', slice(read(key, 'list') ?? [], args[0], args[1])); return 'OK'; }
      case 'EVAL': {
        // EVAL script numkeys key... arg...  (command = ['EVAL', script, numKeys, ...rest]; `key` is the script)
        const numKeys = Number(args[0]);
        const keys = args.slice(1, 1 + numKeys), argv = args.slice(1 + numKeys);
        const found = SCRIPTS.find(([pattern]) => pattern.test(String(key)));
        if (!found) throw new Error('demo store: unsupported Lua script');
        return found[1](keys, argv);
      }
      default: throw new Error(`demo store: unsupported command ${name}`);
    }
  }
  return store;
}
