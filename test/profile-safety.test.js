import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDashHandler } from '../lib/dash/router.js';
import { createDashCron } from '../lib/dash/cron.js';
import { createCron } from '../api/cron.js';
import { createSessions } from '../lib/auth/session.js';
import { resolveProfile } from '../lib/account-profile.js';
import { setActiveProfile, resetActiveProfile, activeProfile, profileKey, freshKey } from '../lib/locale.js';

beforeEach(() => resetActiveProfile());

// In-memory Redis stand-in that records every command it receives.
function memory() {
  const data = new Map();
  const log = [];
  const store = async ([cmd, ...args]) => {
    log.push([cmd, ...args]);
    switch (cmd) {
      case 'GET': return data.get(args[0]) ?? null;
      case 'MGET': return args.map(k => data.get(k) ?? null);
      case 'SET': if (args.includes('NX') && data.has(args[0])) return null; data.set(args[0], args[1]); return 'OK';
      case 'DEL': return data.delete(args[0]) ? 1 : 0;
      case 'INCR': { const n = Number(data.get(args[0]) ?? 0) + 1; data.set(args[0], String(n)); return n; }
      case 'EXPIRE': return 1;
      case 'EVAL': return 1;
      default: return null;
    }
  };
  store.data = data; store.log = log;
  return store;
}
const baseEnv = { DASH_ENABLED: 'true', DASH_BASE_URL: 'https://portal.example.com', DASH_SESSION_SECRET: 'test-secret-32-bytes-not-production-value', DASH_ALLOWED_EMAILS: 'owner@example.com' };
const response = () => { const r = { code: 0, body: null, setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const metaFetch = (body, calls = []) => async url => { calls.push(String(url)); return new Response(JSON.stringify(body), { status: 200 }); };
const downFetch = async () => { throw new Error('offline'); };

test('router: anonymous and auth requests never read the profile, and a bad REPORT_* value cannot block sign-in', async () => {
  const store = memory();
  const env = { ...baseEnv, REPORT_TIMEZONE: 'Mars/Olympus' };
  const handler = createDashHandler({ env, store, fetch: downFetch });
  // Anonymous data request: 401, and Redis was never asked for the profile.
  let res = response();
  await handler({ method: 'GET', query: { r: 'sales', from: '2026-01-01', to: '2026-01-07' }, headers: {} }, res);
  assert.equal(res.code, 401);
  assert.equal(store.log.some(c => c[0] === 'MGET' && String(c[1]).includes('profile')), false);
  // Login request works even though REPORT_TIMEZONE is invalid.
  res = response();
  await handler({ method: 'POST', query: { r: 'auth/request' }, headers: { origin: env.DASH_BASE_URL, 'content-type': 'application/json' }, body: { email: 'owner@example.com' } }, res);
  assert.equal(res.code, 200);
  res = response();
  await handler({ method: 'POST', query: { r: 'auth/consume' }, headers: { origin: env.DASH_BASE_URL, 'content-type': 'application/json' }, body: { token: 'x'.repeat(43) } }, res);
  assert.notEqual(res.code, 500);
  assert.equal(store.log.some(c => c[0] === 'MGET' && String(c[1]).includes('profile')), false);
});

test('router: a signed-in user with a bad override gets a generic body (no env var name)', async () => {
  const store = memory();
  const env = { ...baseEnv, REPORT_CURRENCY: 'nope!' };
  const session = await createSessions({ env, store, now: Date.now }).create('owner@example.com');
  const handler = createDashHandler({ env, store, fetch: downFetch });
  const res = response();
  await handler({ method: 'GET', query: { r: 'me' }, headers: { cookie: `__Host-dtc_dash=${session.sid}` } }, res);
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { error: 'config_invalid' });
  assert.doesNotMatch(JSON.stringify(res.body), /REPORT_|ISO/);
});

test('router: dates are validated against the account day, resolved after the session check', async () => {
  const store = memory();
  const env = { ...baseEnv, META_AD_ACCOUNT_ID: '7', META_ACCESS_TOKEN: 't', META_API_VERSION: 'v25.0' };
  const session = await createSessions({ env, store, now: Date.now }).create('owner@example.com');
  // 2026-06-01 03:30 UTC is still May 31 in New York: "to = 2026-06-01" is the future there and must be rejected,
  // while the UTC fallback (June 1) would have accepted it.
  const now = () => Date.parse('2026-06-01T03:30:00Z');
  const fetch = metaFetch({ id: 'act_7', currency: 'USD', timezone_name: 'America/New_York' });
  const handler = createDashHandler({ env, store, fetch, now, routes: { sales: async ctx => ({ status: 200, body: { D: ctx.D } }) } });
  const headers = { cookie: `__Host-dtc_dash=${session.sid}` };
  let res = response();
  await handler({ method: 'GET', query: { r: 'sales', from: '2026-05-25', to: '2026-06-01' }, headers }, res);
  assert.equal(res.code, 400);
  res = response();
  await handler({ method: 'GET', query: { r: 'sales', from: '2026-05-25', to: '2026-05-30' }, headers }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.D, '2026-05-31');
});

test('crons stop without advancing the cursor when the account profile cannot be resolved', async () => {
  // Report cron: Meta unreachable and nothing stored.
  const store = memory();
  let sent = 0;
  const env = { AUTOMATION_ENABLED: 'true', CRON_SECRET: 'c', REPORT_SECRET: 'r', REPORT_START_DATE: '2026-10-30', UPSTASH_REDIS_REST_URL: 'x', UPSTASH_REDIS_REST_TOKEN: 'x', META_AD_ACCOUNT_ID: '7', META_ACCESS_TOKEN: 't', META_API_VERSION: 'v25.0' };
  const realFetch = globalThis.fetch;
  globalThis.fetch = downFetch;
  try {
    const handler = createCron({ env, store, now: () => Date.parse('2026-11-05T12:00:00Z'), runReport: async (req, res) => { sent++; res.status(200).json({ status: 'accepted_by_email_provider' }); } });
    const res = response();
    await handler({ method: 'GET', headers: { authorization: 'Bearer c' } }, res);
    assert.equal(res.code, 503);
    assert.equal(sent, 0);
    assert.equal(store.log.some(c => c[0] === 'EVAL' || (c[0] === 'SET' && String(c[1]).includes('schedule'))), false, 'cursor untouched');
  } finally { globalThis.fetch = realFetch; }

  // Dash cron: same, and no lock, snapshot or agent work happens.
  const dashStore = memory();
  const dashEnv = { ...baseEnv, CRON_SECRET: 'c', META_AD_ACCOUNT_ID: '7', META_ACCESS_TOKEN: 't', META_API_VERSION: 'v25.0' };
  const cron = createDashCron({ env: dashEnv, store: dashStore, fetch: downFetch });
  const res = response();
  await cron({ method: 'GET', headers: { authorization: 'Bearer c' }, query: { job: 'snapshot' } }, res);
  assert.equal(res.code, 503);
  assert.deepEqual(res.body, { error: 'profile_unavailable' });
  assert.equal(dashStore.log.some(c => c[0] === 'SET' && String(c[1]).includes('lock')), false);
});

test('dash cron with a bad REPORT_TIMEZONE answers generically', async () => {
  const cron = createDashCron({ env: { ...baseEnv, CRON_SECRET: 'c', REPORT_TIMEZONE: 'Nope/Zone' }, store: memory(), fetch: downFetch });
  const res = response();
  await cron({ method: 'GET', headers: { authorization: 'Bearer c' }, query: { job: 'snapshot' } }, res);
  assert.equal(res.code, 500);
  assert.deepEqual(res.body, { error: 'config_invalid' });
});

test('an unresolved fallback never overwrites a profile that was already resolved', async () => {
  const good = { currency: 'EUR', timezone: 'Europe/Madrid', source: { currency: 'account', timezone: 'account' } };
  setActiveProfile(good);
  // Direct attempt with the fallback shape.
  setActiveProfile({ currency: 'USD', timezone: 'UTC', source: { currency: 'default', timezone: 'default' } });
  assert.equal(activeProfile().currency, 'EUR');
  // A concurrent request that cannot reach Meta or Redis keeps using the resolved profile instead of UTC.
  const env = { META_AD_ACCOUNT_ID: '7', META_ACCESS_TOKEN: 't', META_API_VERSION: 'v25.0' };
  const out = await resolveProfile({ env, store: memory(), fetch: downFetch });
  assert.equal(out.resolved, true);
  assert.equal(out.profile.timezone, 'Europe/Madrid');
  assert.equal(activeProfile().timezone, 'Europe/Madrid');
  // A different resolved profile (the account really changed) does replace it.
  setActiveProfile({ currency: 'GBP', timezone: 'Europe/London', source: { currency: 'account', timezone: 'account' } });
  assert.equal(activeProfile().currency, 'GBP');
});

test('a changed account currency or time zone is picked up after the freshness window, with its warning', async () => {
  const env = { META_AD_ACCOUNT_ID: '7', META_ACCESS_TOKEN: 't', META_API_VERSION: 'v25.0' };
  const store = memory();
  const calls = [];
  const first = await resolveProfile({ env, store, fetch: metaFetch({ id: 'act_7', currency: 'USD', timezone_name: 'America/New_York' }, calls), now: () => 1000 });
  assert.equal(first.profile.currency, 'USD');
  // Fresh: the stored profile is used and Meta is not read, even though the account has meanwhile changed.
  const changed = metaFetch({ id: 'act_7', currency: 'EUR', timezone_name: 'Europe/Madrid' }, calls);
  const cached = await resolveProfile({ env, store, fetch: changed, now: () => 2000 });
  assert.equal(cached.profile.currency, 'USD');
  assert.equal(calls.length, 1);
  // The freshness stamp expires (Redis TTL): the next resolve re-reads the account, and the stored profile does not mask it.
  store.data.delete(freshKey('7'));
  const after = await resolveProfile({ env, store, fetch: changed, now: () => 3000 });
  assert.deepEqual([after.profile.currency, after.profile.timezone], ['EUR', 'Europe/Madrid']);
  assert.equal(calls.length, 2);
  assert.equal(after.change.from.currency, 'USD');
  assert.equal(after.change.to.currency, 'EUR');
  assert.equal(JSON.parse(store.data.get(profileKey('7'))).currency, 'EUR');
  // Meta down when the stamp has expired: the stored values keep working.
  store.data.delete(freshKey('7'));
  const offline = await resolveProfile({ env, store, fetch: downFetch });
  assert.equal(offline.profile.currency, 'EUR');
  assert.equal(offline.resolved, true);
});
