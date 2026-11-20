// Boots the whole demo: fictional world, in-memory store, fake upstreams, seeded history, local HTTP server.
// Nothing here is imported by api/ or lib/, so a deployment can never reach the demo session or the fake data.
import { randomBytes } from 'node:crypto';
import { today } from '../lib/dash/range.js';
import { createMemoryStore } from './redis.js';
import { createWorld, ACCOUNT_ID, IG_ID, IG_USERNAME, BRAND, DEMO_PROFILE } from './world.js';
import { spendUnit, setActiveProfile } from '../lib/locale.js';
import { createGraph } from './graph.js';
import { createUpstream, isLoopbackHost, DemoNetworkBlocked } from './upstream.js';
import { createDemoAgentClient } from './ai.js';
import { seedDemo, DEMO_EMAIL } from './seed.js';
import { createDemoServer } from './server.js';

const HOST = '127.0.0.1';
export const DEFAULT_PORT = 3060;

// A configuration that names only fictional values. The real process.env is never copied in, so no real key can leak
// into the demo and no real service can be configured by accident.
function demoEnv(port, profile) {
  // The CPA target is written for a 200-unit base and scaled to the demo currency.
  const targetCpa = Math.round(250 * spendUnit(profile.currency) / 200 * 100) / 100;
  return {
    DASH_ENABLED: 'true', DASH_BASE_URL: `http://${HOST}:${port}`, DASH_SESSION_SECRET: randomBytes(48).toString('base64url'), DASH_ALLOWED_EMAILS: DEMO_EMAIL,
    CRON_SECRET: randomBytes(24).toString('base64url'), BRAND_NAME: BRAND, LANDING_HOSTS: 'www.example.com',
    META_AD_ACCOUNT_ID: ACCOUNT_ID, META_ACCESS_TOKEN: 'demo-token', META_API_VERSION: 'v25.0', META_SYSTEM_USER_TOKEN: 'demo-system-user-token', META_TOKEN_EXPIRES_AT: 'never',
    INSTAGRAM_ACCESS_TOKEN: 'demo-token', INSTAGRAM_USER_ID: IG_ID, INSTAGRAM_USERNAME: IG_USERNAME,
    TARGET_CPA: String(targetCpa), TARGET_ROAS: '3',
    AGENT_ENABLED: 'true', AGENT_PROVIDER: 'gemini', GEMINI_API_KEY: 'demo-key',
    INSPIRATION_ENABLED: 'true', INSPIRATION_AI_ENABLED: 'true', SCRAPECREATORS_API_KEY: 'demo-key', INSPIRATION_CALL_LIMIT: '200',
  };
}

// Belt and braces: even code that ignores the injected fetch (SDKs, helpers using the global) cannot leave the machine.
function guardNetwork(upstream) {
  const original = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    let url;
    try { url = new URL(input instanceof Request ? input.url : String(input)); } catch { return Promise.reject(new DemoNetworkBlocked('invalid-url')); }
    return isLoopbackHost(url.hostname) && url.pathname !== '/api/whisper' ? original(input, init) : upstream(input, init);
  };
  return () => { globalThis.fetch = original; };
}

// `profile` is the fictional account's currency and time zone (default USD, America/New_York): the same values the real
// portal would read from the Meta ad account. Any valid ISO currency and IANA zone works.
export async function startDemo({ port = DEFAULT_PORT, log = () => {}, profile = DEMO_PROFILE } = {}) {
  const now = Date.now;
  // `today` follows the active profile, so it has to be the demo account's before the world is built.
  setActiveProfile({ ...profile, source: { currency: 'account', timezone: 'account' } });
  const D = today(now());
  const world = createWorld(D, profile);
  const outbox = [];
  const upstream = createUpstream({ world, graph: createGraph(world, { now }), outbox, now });
  const restoreFetch = guardNetwork(upstream);
  try {
    const store = createMemoryStore({ now });
    const env = demoEnv(port, profile);
    const agentClient = createDemoAgentClient();
    log('Seeding fictional data for Example Co. ...');
    const seeded = await seedDemo({ env, store, fetch: upstream, now, world, agentClient });
    const server = await createDemoServer({ env, store, fetch: upstream, agentClient, now, port });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, HOST, resolve); });
    const actual = server.address().port;
    env.DASH_BASE_URL = `http://${HOST}:${actual}`;
    const stop = () => new Promise(resolve => {
      restoreFetch();
      server.close(() => resolve());
      server.closeAllConnections?.();
    });
    return { server, url: env.DASH_BASE_URL, port: actual, env, store, outbox, seeded, world, stop };
  } catch (error) {
    restoreFetch();
    throw error;
  }
}
