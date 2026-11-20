import { randomUUID } from 'node:crypto';
import { createMetaClient, MetaError, MetaReadOnlyError } from '../meta-client.js';
import { storage } from '../schedule.js';
import { shift } from '../dates.js';
import { authorized } from '../auth/bearer.js';
import { RELEASE } from './cache.js';
import { K, TTL } from './store.js';
import { today } from './range.js';
import { logEvent } from './log.js';
import { createSales } from './sales.js';
import { createCache } from './cache.js';
import { snapshotSales, snapshotCreatives, snapshotFatigue, salesRange, writeSnap } from './snapshot.js';
import { snapshotPixel, snapshotEmq, createEmqClient, resolvePixelId, pixelClientFor, pixelStatsEnabled } from './pixel.js';
import { snapshotInstagram } from './social.js';
import { parseBackfill, runBackfill } from './backfill.js';
import { isPermissionError } from './status.js';
import { createAgent } from '../agent/run.js';
import { computeJournal } from '../agent/journal.js';

export const JOB_DEADLINE_MS = 270000;
const JOBS = ['snapshot', 'agent', 'backfill'];
const DEFAULT_VERSION = 'v25.0';

// Order matters: a missed pixel day cannot be recovered, so it runs first. Budgets are per module (ms).
const SNAPSHOT_ORDER = [['pixel', 50000], ['sales', 60000], ['fatigue', 50000], ['ig', 50000], ['creatives', 30000]];

// Pixel days always cover the trailing week, so a missed day is refilled by the next run.
const weekWindow = D => ({ from: shift(D, -7), to: shift(D, -1) });

const accountOf = env => {
  const id = String(env.META_AD_ACCOUNT_ID ?? '');
  if (!/^\d+$/.test(id)) throw new MetaError('Meta account id is not configured', { code: 'config' });
  return id;
};

function failureCode(error) {
  if (error instanceof MetaError) return error.code ?? 'unknown';
  if (error instanceof MetaReadOnlyError) return 'read_only';
  return 'internal';
}

export function createDashCron({
  env = process.env, store, fetch: fetcher = (...args) => globalThis.fetch(...args), now = Date.now, sleep, modules: override = {}, uuid = randomUUID, anthropic, agentClient = anthropic,
} = {}) {
  const version = env.META_API_VERSION || DEFAULT_VERSION;
  const withMeta = fn => ctx => {
    const accountId = accountOf(env);
    const client = createMetaClient({ token: env.META_ACCESS_TOKEN, version, accountId, fetch: ctx.fetch, now, sleep, store: ctx.store, deadlineMs: ctx.budget, enabled: true });
    return fn({ ...ctx, client, accountId, version });
  };
  // Pixel days first. EMQ is an optional extra: it only runs with the system-user token and never fails the module.
  async function pixelJob(ctx) {
    // Pixel /stats only reaches 7 days back from request time, so D-7 00:00 CDMX is out of range later in the day.
    const client = pixelClientFor({ env, client: ctx.client, version, accountId: ctx.accountId, fetch: ctx.fetch, now, sleep, store: ctx.store, deadlineMs: ctx.budget });
    // /stats can be denied (e.g. a pixel shared from another business) while Dataset Quality still works with the
    // same token, so EMQ runs either way and the /stats failure is re-thrown afterwards.
    let out = null;
    let statsError = null;
    if (!pixelStatsEnabled(env)) out = { written: 0, attributed: true };
    else try { out = await snapshotPixel({ ...ctx, client, from: shift(ctx.D, -6), to: shift(ctx.D, -1) }); } catch (error) { statsError = error; }
    const emqClient = createEmqClient({ env, version, accountId: ctx.accountId, fetch: ctx.fetch, now, sleep, store: ctx.store, deadlineMs: 20000 });
    let emqOk = false;
    if (emqClient) {
      try {
        const pixelId = out?.pixelId ?? await resolvePixelId({ env, client, store: ctx.store, accountId: ctx.accountId });
        emqOk = (await snapshotEmq({ emqClient, pixelId, store: ctx.store, now, D: ctx.D })).written > 0;
      } catch (error) { logEvent('dash_snapshot', { stage: 'emq', code: failureCode(error) }); }
    }
    if (statsError) throw statsError;
    if (!emqClient || emqOk) return out;
    return { ...out, partial: [...(out.partial || []), 'emq'] };
  }
  const modules = {
    pixel: withMeta(pixelJob),
    sales: withMeta(ctx => snapshotSales({ ...ctx, ...salesRange(ctx.D) })),
    fatigue: withMeta(snapshotFatigue),
    ig: ctx => snapshotInstagram({ ...ctx, env }),
    creatives: withMeta(snapshotCreatives),
    ...override,
  };

  return async function handler(req, res) {
    const respond = (code, body) => res.status(code).json(body);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    // Amendment 7: authentication has no I/O and runs first, so an unauthenticated caller always gets 401.
    if (!authorized(req.headers?.authorization, env.CRON_SECRET)) return respond(401, { error: 'unauthorized' });
    if (env.DASH_ENABLED !== 'true') return respond(404, { error: 'disabled' });

    const job = req.query?.job;
    if (typeof job !== 'string' || !JOBS.includes(job)) return respond(400, { error: 'bad_request' });
    if (req.method !== (job === 'backfill' ? 'POST' : 'GET')) return respond(405, { error: 'method_not_allowed' });
    const D = today(now());
    let range = null;
    if (job === 'backfill') {
      range = parseBackfill(req.body, D);
      if (!range) return respond(400, { error: 'bad_request' });
    }

    const db = store || storage(env);
    const owner = uuid();
    const lockKey = K.jobLock(job, D);
    try {
      if (await db(['SET', lockKey, owner, 'NX', 'EX', TTL.jobLock]) !== 'OK') return respond(200, { status: 'locked' });
      try {
        const base = { env, store: db, fetch: fetcher, now, sleep, D };
        if (job === 'backfill') return await backfill(base, range, respond);
        if (job === 'agent') return await agentJob(base, respond);
        return await snapshot(base, respond);
      } finally {
        try { await db(['EVAL', RELEASE, 1, lockKey, owner]); } catch { /* the lock expires after 300 s */ }
      }
    } catch (error) {
      logEvent('dash_error', { stage: `cron_${job}`, code: failureCode(error) });
      return respond(500, { error: 'internal' });
    }
  };

  async function snapshot(base, respond) {
    const started = Number(now());
    const results = {};
    for (const [name, budget] of SNAPSHOT_ORDER) {
      if (Number(now()) - started >= JOB_DEADLINE_MS) { results[name] = { ok: false, code: 'deadline' }; continue; }
      try {
        const out = await modules[name]({ ...base, budget });
        results[name] = out?.skipped
          ? { ok: false, skipped: true, code: out.skipped }
          : { ok: true, written: out?.written ?? 0, ...(out?.attributed ? { code: 'attributed' } : {}), ...(out?.partial?.length ? { partial: out.partial } : {}) };
      } catch (error) {
        const code = failureCode(error);
        logEvent('dash_snapshot', { stage: error?.step ? `${name}:${error.step}` : name, code, subcode: error instanceof MetaError ? error.subcode ?? undefined : undefined });
        // A permission failure gets its own status so the UI can say so; the raw Meta code is kept next to it.
        results[name] = isPermissionError(error) ? { ok: false, code: 'no_permission', meta_code: code } : { ok: false, code };
      }
    }
    // Weekly journal rows from the snapshots just written: pure computation, no Meta call and no model. It is not a snapshot
    // module (the status payload is unchanged) and a failure here never fails the job.
    if (Number(now()) - started < JOB_DEADLINE_MS) {
      try { await computeJournal({ store: base.store, D: base.D }); } catch { logEvent('dash_snapshot', { stage: 'journal', code: 'internal' }); }
    }
    const at = new Date(Number(now())).toISOString();
    const status = Object.fromEntries(Object.entries(results).map(([name, r]) => [name, { ok: r.ok, at, ...(r.code !== undefined ? { code: r.code } : {}), ...(r.meta_code !== undefined ? { meta_code: r.meta_code } : {}), ...(r.partial ? { partial: r.partial } : {}) }]));
    await writeSnap({ store: base.store, module: 'status', date: base.D, value: status, ref: base.D });
    const counted = Object.values(results).filter(r => !r.skipped);
    const failed = counted.filter(r => !r.ok).length;
    const state = failed === 0 ? 'ok' : failed === counted.length ? 'failed' : 'partial';
    return respond(state === 'failed' ? 502 : 200, { status: state, date: base.D, modules: results });
  }

  // Pixel days are unrecoverable, so the agent job first refills them when the snapshot job did not (capped at 50 s).
  // A failure here never stops the agent: it works from whatever snapshots exist.
  async function catchUpPixel(base) {
    if (!pixelStatsEnabled(env)) return;
    const statusKey = K.snap('status', base.D);
    try {
      let status = {};
      try { status = JSON.parse(await base.store(['GET', statusKey])) || {}; } catch { status = {}; }
      if (status.pixel?.ok === true || status.pixel?.code === 'no_permission') return;
      const out = await modules.pixel({ ...base, budget: 50000 });
      if (out?.skipped) return;
      status.pixel = { ok: true, at: new Date(Number(now())).toISOString() };
      await writeSnap({ store: base.store, module: 'status', date: base.D, value: status, ref: base.D });
    } catch (error) {
      logEvent('dash_snapshot', { stage: 'pixel_catchup', code: failureCode(error) });
    }
  }

  async function agentJob(base, respond) {
    const deadlineAt = Number(now()) + JOB_DEADLINE_MS;
    await catchUpPixel(base);
    if (env.AGENT_ENABLED !== 'true') return respond(200, { status: 'agent_disabled' });
    // The last 3 days (provisional) ride along as context; the playbook keeps them out of every decision. Any failure only
    // marks the block unavailable.
    const recentSource = async () => {
      const accountId = accountOf(env);
      const client = createMetaClient({ token: env.META_ACCESS_TOKEN, version, accountId, fetch: base.fetch, now, sleep, store: base.store, deadlineMs: 20000, enabled: true });
      const cache = createCache({ store: base.store, now, sleep, usage: () => client.usage() });
      const sales = createSales({ client, accountId, now, D: base.D });
      return cache.read('recent', { D: base.D }, { load: () => sales.dailyCampaigns() });
    };
    const agent = createAgent({ client: agentClient, store: base.store, now, env, recentSource, fetch: base.fetch, sleep });
    const out = await agent.run({ D: base.D, deadlineAt });
    return respond(out.status === 'failed' ? 502 : 200, out);
  }

  async function backfill(base, range, respond) {
    try {
      const accountId = accountOf(env);
      const budget = 200000;
      const client = createMetaClient({ token: env.META_ACCESS_TOKEN, version, accountId, fetch: base.fetch, now, sleep, store: base.store, deadlineMs: budget, enabled: true });
      const out = await runBackfill({ ...range, ...base, client, accountId, version, budget });
      return respond(200, out);
    } catch (error) {
      logEvent('dash_backfill', { stage: 'sales', code: failureCode(error) });
      return respond(502, { error: 'backfill_failed' });
    }
  }
}
