import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDemo } from '../demo/start.js';
import { shift } from '../lib/dates.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const realFetch = globalThis.fetch;
let demo, cookie, range;

before(async () => {
  demo = await startDemo({ port: 0 });
  const D = demo.world.D;
  range = new URLSearchParams({ from: shift(D, -29), to: shift(D, -1) }).toString();
  cookie = (await fetch(`${demo.url}/app/`)).headers.getSetCookie()[0].split(';')[0];
});
after(async () => {
  await demo.stop();
  assert.equal(globalThis.fetch, realFetch, 'stop() must restore the global fetch');
});

const api = async (route, query = '') => {
  const response = await fetch(`${demo.url}/api/dash/${route}${query ? `?${query}` : ''}`, { headers: { cookie } });
  return { status: response.status, body: await response.json() };
};

// Raw request: keeps the path exactly as written (fetch would normalize dot segments) and lets a test choose the Host.
const raw = (pathname, host = `127.0.0.1:${demo.port}`) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: demo.port, path: pathname, headers: { Host: host } }, res => { res.resume(); resolve(res.statusCode); });
  req.on('error', reject);
  req.end();
});

test('the demo server binds to the loopback address only', () => {
  const { address, family } = demo.server.address();
  assert.equal(address, '127.0.0.1');
  assert.equal(family, 'IPv4');
  assert.match(demo.url, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('serves / and the SPA, and the demo banner exists only in demo responses', async () => {
  assert.equal((await fetch(`${demo.url}/`)).status, 200);
  const app = await fetch(`${demo.url}/app/`);
  assert.equal(app.status, 200);
  const html = await app.text();
  assert.match(html, /id="app"/);
  assert.match(html, /\/demo\/banner\.js/);
  assert.equal((await fetch(`${demo.url}/demo/banner.js`)).status, 200);
  const source = await readFile(path.join(root, 'public/app/index.html'), 'utf8');
  assert.doesNotMatch(source, /demo/i);
  assert.equal((await fetch(`${demo.url}/app/app.js`)).status, 200);
});

test('static serving cannot leave public/', async () => {
  assert.equal(await raw('/app/../../package.json'), 404); // normalized to /package.json, which is not under public/
  assert.equal(await raw('/app/%2e%2e/%2e%2e/package.json'), 404); // so is the percent-encoded form
  assert.equal(await raw('/app/..%2f..%2fpackage.json'), 400); // an encoded slash survives URL parsing and is refused outright
});

test('applies the vercel.json rewrite and the portal auth: no session, no data', async () => {
  assert.equal((await fetch(`${demo.url}/api/dash/me`)).status, 401);
  const me = await api('me');
  assert.equal(me.status, 200);
  assert.equal(me.body.email, 'demo@example.com');
  assert.equal(me.body.brand, 'Example Co.');
});

test('the portal origin check still guards state changes', async () => {
  const forged = await fetch(`${demo.url}/api/dash/memory/add`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ text: 'x' }) });
  assert.equal(forged.status, 403);
});

test('refuses requests whose Host is not the loopback address (DNS rebinding)', async () => {
  assert.equal(await raw('/api/dash/me', 'attacker.example'), 421);
});

test('every screen has data from the real handlers', async () => {
  const sales = await api('sales', range);
  assert.equal(sales.status, 200);
  assert.ok(sales.body.totals.spend > 0 && sales.body.totals.purchases > 0);
  assert.equal(sales.body.series.length, 29);
  // The fictional account is USD and America/New_York by default, as the fake Graph reports it.
  assert.equal(sales.body.currency, 'USD');
  assert.equal(sales.body.timezone, 'America/New_York');
  const me = await api('me');
  assert.equal(me.body.profile.currency, 'USD');
  assert.equal(me.body.profile.timezone, 'America/New_York');
  assert.equal(me.body.profile.warning, null);
  const campaigns = await api('campaigns', range);
  assert.ok(campaigns.body.campaigns.length >= 5);
  assert.ok(new Set(campaigns.body.campaigns.flatMap(c => c.adsets.flatMap(s => s.ads.map(a => a.delivery)))).size >= 3);
  const creatives = await api('creatives', range);
  assert.ok(creatives.body.ads.length >= 10);
  assert.ok(creatives.body.ads.every(ad => ad.creative.thumbnail_url?.startsWith('/demo-media/')));
  assert.ok(creatives.body.ads.some(ad => ad.fatigue.state === 'FATIGUED'));
  const pixel = await api('pixel');
  assert.equal(pixel.body.pixel_status, 'ok');
  assert.ok(pixel.body.days.length >= 7 && pixel.body.emq?.score > 0);
  const social = await api('social', 'days=30');
  assert.equal(social.body.posts_status, 'ok');
  assert.ok(social.body.posts.length >= 10 && social.body.days_covered === 30 && social.body.followers.length > 20);
  const alerts = await api('alerts');
  assert.ok(alerts.body.run.recommendations.length >= 4 && alerts.body.history.length >= 3);
  const status = await api('status');
  assert.ok(status.body.sources.every(s => s.state === 'connected'), JSON.stringify(status.body.sources));
  assert.ok((await api('journal')).body.weeks.length >= 6);
  const memory = (await api('memory')).body;
  assert.ok(memory.notes.length >= 3 && memory.pending.length >= 1);
  assert.equal((await api('conversations')).body.conversations.length, 1);
  const analytics = await api('analytics', `${range}&mode=performance&level=campaign&dimension=age&granularity=week`);
  assert.ok(analytics.body.rows.length > 5 && analytics.body.series.length >= 4);
  const creative = await api('analytics', `${range}&mode=creative`);
  assert.ok(creative.body.ads.length >= 10 && creative.body.settings.metric === 'roas');
  const library = (await api('inspiration')).body;
  assert.ok(library.ads.length >= 20 && library.brands.length === 4 && library.boards.length === 2 && library.ads.some(a => a.favorite));
  const intelligence = (await api('inspiration/intelligence')).body;
  assert.ok(intelligence.insights.total >= 20 && intelligence.plans.length === 1 && intelligence.plans[0].actions.length >= 1);
});

test('the demo world scales to another currency and time zone (deterministic)', async () => {
  const { createWorld, offsetAt } = await import('../demo/world.js');
  const D = demo.world.D;
  const usd = createWorld(D);
  const jpy = createWorld(D, { currency: 'JPY', timezone: 'Asia/Tokyo' });
  const total = world => world.sums(world.ads, shift(D, -7), shift(D, -1)).spend;
  assert.ok(total(jpy) > total(usd) * 100 && total(jpy) < total(usd) * 200, 'spend scales with the currency size');
  assert.equal(total(createWorld(D)), total(usd), 'same day, same numbers');
  // Budgets arrive in the currency's own minor unit: cents for USD, whole yen for JPY.
  assert.equal(usd.budgetOf(90000), '4500');
  assert.equal(jpy.budgetOf(90000), String(Math.round(900 * 7.5)));
  assert.equal(offsetAt('2026-07-01', 'America/New_York'), '-0400');
  assert.equal(offsetAt('2026-01-15', 'America/New_York'), '-0500');
});

test('the AI chat answers with a labelled, grounded canned reply', async () => {
  const response = await fetch(`${demo.url}/api/dash/ask`, { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: demo.url }, body: JSON.stringify({ question: '¿Qué anuncios tienen fatiga?', context_view: 'creativos' }) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.answer, /^\[Demo\]/);
  assert.doesNotMatch(body.answer, /no se encontraron en los datos/);
  assert.ok(body.conversation_id);
});

test('inspiration media is served through the portal proxy from generated placeholders', async () => {
  const image = await fetch(`${demo.url}/api/inspiration-media?id=9000000010001&kind=image`, { headers: { cookie } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await image.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
});

test('no outbound network call can leave the demo', async () => {
  await assert.rejects(fetch('https://example.org/'), /network access to example\.org is blocked/);
  await assert.rejects(fetch('https://graph.facebook.com.evil.example/v25.0/me'), /blocked/);
  await assert.rejects(fetch('not a url'), /blocked/);
});

test('the deployment code never imports the demo', async () => {
  const files = async dir => (await readdir(path.join(root, dir), { recursive: true, withFileTypes: true })).filter(e => e.isFile() && /\.(js|mjs)$/.test(e.name)).map(e => path.join(e.parentPath ?? e.path, e.name));
  for (const file of [...await files('api'), ...await files('lib')]) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /from\s+['"][./]*\/demo\//, `${path.relative(root, file)} must not import the demo`);
    assert.doesNotMatch(source, /\bimport\s*\(\s*[^)]*\/demo\//, `${path.relative(root, file)} must not dynamically import the demo`);
    assert.doesNotMatch(source, /\brequire\s*\(\s*[^)]*\/demo\//, `${path.relative(root, file)} must not require the demo`);
    assert.doesNotMatch(source, /\bimport\s+['"][./]*\/demo\//, `${path.relative(root, file)} must not side-effect import the demo`);
  }
});

test('npm run demo entry: starts on the requested port, serves data, binds to 127.0.0.1', async () => {
  const child = spawn(process.execPath, ['demo/run.mjs'], { cwd: root, env: { PATH: process.env.PATH, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`demo did not start: ${output}`)), 20000);
      const check = () => { const match = /(http:\/\/127\.0\.0\.1:\d+)\/app\//.exec(output); if (match) { clearTimeout(timer); resolve(match[1]); } };
      child.stdout.on('data', check);
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`demo exited ${code}: ${output}`)); });
    });
    assert.equal((await realFetch(`${url}/`)).status, 200);
    const app = await realFetch(`${url}/app/`);
    const session = app.headers.getSetCookie()[0].split(';')[0];
    const me = await realFetch(`${url}/api/dash/me`, { headers: { cookie: session } });
    assert.equal((await me.json()).email, 'demo@example.com');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => child.once('exit', resolve));
  }
});
