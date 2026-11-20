import { createHmac } from 'node:crypto';

export const PREFIX = 'dtc:dash:';
export const key = (...parts) => PREFIX + parts.join(':');

// Keyed hash for every identifier that lands in a Redis key (D6). Never plain SHA-256.
export const hmac = (secret, value) => createHmac('sha256', secret).update(String(value)).digest('base64url');

export const TTL = Object.freeze({
  loginToken: 900,
  session: 2592000,
  sessionCap: 90 * 86400,
  user: 7776000,
  rateHour: 3600,
  rateDay: 86400,
  askFacts: 600,
  cache: 600,
  cacheThrottled: 900,
  stale: 86400,
  media: 10800,
  lock: 30,
  jobLock: 300,
  pixelId: 86400,
  preview: 43200,
  refreshMinute: 60,
  agentEmail: 7 * 86400,
  conversation: 180 * 86400,
  alertRead: 30 * 86400,
  diag: 7 * 86400,
});

// Snapshots live 400 days; the per-module index ZSET outlives its oldest member by one day.
export const TTL400 = 34560000;
export const IDX_TTL = 34646400;

export const K = Object.freeze({
  snap: (module, date) => key('snap', module, date),
  idx: module => key('idx', module),
  jobLock: (job, date) => key('lock', 'job', job, date),
  pixelId: acct => key('pixel-id', acct),
  authToken: h => key('auth', 'token', h),
  authSession: h => key('auth', 'session', h),
  authUser: h => key('auth', 'user', h),
  loginIp: h => key('rl', 'login', 'ip', h),
  loginGap: h => key('rl', 'login', 'gap', h),
  loginSend: h => key('rl', 'login', 'send', h),
  cache: (module, hash) => key('cache', module, hash),
  stale: (module, hash) => key('stale', module, hash),
  lock: (module, hash) => key('lock', 'cache', module, hash),
  media: adId => key('media', adId),
  refreshMinute: h => key('rl', 'refresh', h, 'm'),
  refreshHour: h => key('rl', 'refresh', h, 'h'),
  agentRun: date => key('agent', 'run', date),
  journal: week => key('journal', week),
  memory: () => key('memory', 'notes'),
  memoryWrite: h => key('rl', 'memory', h, 'h'),
  agentEmail: date => key('agent', 'email', date),
  askHour: h => key('rl', 'ask', h, 'h'),
  askDay: h => key('rl', 'ask', h, 'd'),
  askFacts: date => key('ask', 'facts', date),
  conv: (user, id) => key('conv', user, id),
  convIdx: user => key('conv', user, 'idx'),
  convMeta: user => key('conv', user, 'meta'),
  alertRead: (user, date) => key('alerts', 'read', user, date),
  diagAsk: () => key('diag', 'ask'),
});
