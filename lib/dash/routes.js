import {reviewCreative} from './analytics-review.js';
import { createAnalytics } from './analytics.js';
import { inspirationRoutes } from '../inspiration/routes.js';
import { createMetaClient, MetaError, MetaReadOnlyError, DisabledError } from '../meta-client.js';
import { createCache, BusyError } from './cache.js';
import { createSales } from './sales.js';
import { createCreatives } from './creatives.js';
import { createPixelView, createEmqClient, pixelClientFor } from './pixel.js';
import { createSocialView } from './social.js';
import { refreshGate, askGate, askRefund, memoryWriteGate } from './ratelimit.js';
import { logEvent } from './log.js';
import { readAlerts } from '../agent/alerts.js';
import { readIds, updateRead } from '../agent/alert-read.js';
import { readConnections, agentState } from './connections.js';
import { answerQuestion, chatClient, CHAT_DEADLINE_MS, raceDeadline } from '../agent/chat.js';
import { maybeSummarize } from '../agent/summary.js';
import { buildRecord, logDiag, writeDiag, readDiag } from '../agent/diag.js';
import { modelShort } from '../agent/chain.js';
import { readJournal, JOURNAL } from '../agent/journal.js';
import { readMemory, addNote, editNote, deleteNote, addProposals, approveProposal, discardProposal, memoryBlock } from '../agent/memory.js';
import { provisionalFrom } from './range.js';
import { userHash, loadConversation, appendExchange, listConversations, renameConversation, deleteConversation, promptTurns } from '../agent/conversations.js';

// Modules the refresh route can rebuild, and how each one loads. `media` marks payloads that carry signed CDN URLs.
const LOADERS = {
  sales: { load: (c, range) => c.sales.sales(range) },
  campaigns: { load: (c, range) => c.sales.campaigns(range) },
  creatives: { load: (c, range) => c.creatives.creatives(range), media: true },
  pixel: { load: c => c.pixel.pixel(), refreshable: false },
  // Daily snapshots plus a live top-posts block; nothing here can rewrite a snapshot, so no manual refresh.
  social: { load: (c, range) => c.social.social(range), media: true, refreshable: false },
};

function context(ctx, deadlineMs=25000) {
  const { env, store, now, fetch, sleep, D } = ctx;
  const accountId = String(env.META_AD_ACCOUNT_ID ?? '');
  if (!/^\d+$/.test(accountId)) throw new MetaError('Meta account id is not configured', { code: 'config' });
  const client = createMetaClient({ token: env.META_ACCESS_TOKEN, version: env.META_API_VERSION, accountId, fetch, now, sleep, store, enabled: true, deadlineMs });
  const cache = createCache({ store, now, sleep, usage: () => client.usage() });
  const emqClient = createEmqClient({ env, version: env.META_API_VERSION, accountId, fetch, now, sleep, store });
  return {
    client, cache, sales: createSales({ client, accountId, now, D }), creatives: createCreatives({ client, accountId, store, now, D }),
    pixel: createPixelView({ client: pixelClientFor({ env, client, version: env.META_API_VERSION, accountId, fetch, now, sleep, store }), emqClient, accountId, env, store, now, D }),
    social: createSocialView({ env, store, fetch, now, D }),
  };
}

// Maps failures to fixed, detail-free bodies. Nothing from Meta (message, URL, token) reaches the browser.
function fail(error, stage) {
  if (error instanceof BusyError) return { status: 503, body: { error: 'busy' } };
  if (error instanceof DisabledError) return { status: 404, body: { error: 'disabled' } };
  if (error instanceof MetaError && error.code !== 'config') {
    logEvent('dash_meta', { stage, code: error.code ?? 'unknown', subcode: error.subcode ?? undefined });
    return { status: 502, body: { error: 'meta_unavailable', ...(error.retryAfter ? { retry_after: error.retryAfter } : {}) } };
  }
  logEvent('dash_error', { stage, code: error instanceof MetaReadOnlyError ? 'read_only' : 'internal' });
  return { status: 500, body: { error: 'internal' } };
}

async function serve(ctx, module, refresh = false) {
  const parts = context(ctx);
  const range = ctx.params.from ? { from: ctx.params.from, to: ctx.params.to } : ctx.params.days ? { days: ctx.params.days } : {};
  const { load, media = false } = LOADERS[module];
  const body = await parts.cache.read(module, range, { refresh, media, load: () => load(parts, range) });
  return { status: 200, body };
}

const guarded = (module, stage = module) => async ctx => {
  try { return await serve(ctx, module); } catch (error) { return fail(error, stage); }
};

async function refresh(ctx) {
  const module = Object.hasOwn(LOADERS, ctx.params.module) && LOADERS[ctx.params.module].refreshable !== false ? ctx.params.module : null;
  if (!module) return { status: 404, body: { error: 'not_found' } };
  const gate = await refreshGate({ store: ctx.store, secret: ctx.env.DASH_SESSION_SECRET, email: ctx.email, now: ctx.now });
  if (!gate.ok) return { status: 429, body: { error: 'rate_limited', retry_after: gate.retry_after } };
  try {
    const out = await serve(ctx, module, true);
    // The Campañas page shows the account totals from the sales module next to its own list: one refresh rebuilds both, so the
    // two numbers never carry different ages. A failure there leaves the older (stale) totals and never fails this refresh.
    if (module === 'campaigns') {
      try { await serve(ctx, 'sales', true); } catch (error) { logEvent('dash_cache', { stage: 'sales', code: error instanceof BusyError ? 'busy' : 'refresh_companion' }); }
    }
    return out;
  } catch (error) { return fail(error, 'refresh'); }
}

// Lazy preview: loads only when the user clicks. The src is validated server side before it is ever returned.
async function preview(ctx) {
  try {
    const { creatives } = context(ctx);
    const src = await creatives.preview({ ad_id: ctx.params.ad_id, format: ctx.params.format });
    return { status: 200, body: src ? { src } : { error: 'preview_unavailable' } };
  } catch (error) { return fail(error, 'preview'); }
}

// Stored agent runs only: no Meta client is built and nothing outside Redis is read.
async function alerts(ctx) {
  try {
    const found = await readAlerts({ store: ctx.store, D: ctx.D, date: ctx.params.date });
    const read = found.run ? await readIds({ store: ctx.store, user: userOf(ctx), date: found.run.date, run: found.run }) : [];
    return { status: 200, body: { ...found, read, agent: agentState(ctx.env) } };
  } catch (error) { return fail(error, 'alerts'); }
}

// Read state for one run: session and Origin gated, validated, per user. Ids outside the run are ignored.
const alertWrite = (stage, mode) => async ctx => {
  try {
    const { run } = await readAlerts({ store: ctx.store, D: ctx.D, date: ctx.params.date });
    if (!run) return notFound;
    const ids = mode === 'all' ? run.recommendations.map(r => r.id) : ctx.params.ids;
    const read = await updateRead({ store: ctx.store, user: userOf(ctx), date: run.date, run, ids, read: mode !== 'unread' });
    return { status: 200, body: { date: run.date, read, unread: run.recommendations.length - read.length } };
  } catch (error) { return fail(error, stage); }
};

// The weekly optimization journal: stored rows only (numbers computed by the daily job), no Meta call.
async function journal(ctx) {
  try { return { status: 200, body: { weeks: await readJournal({ store: ctx.store, D: ctx.D, weeks: JOURNAL.ROUTE_WEEKS }), provisional_from: provisionalFrom(ctx.D) } }; } catch (error) { return fail(error, 'journal'); }
}

// Connection status: Redis and env flags only. No Meta call, and the body holds states and reason codes, never values.
async function status(ctx) {
  try { return { status: 200, body: await readConnections({ env: ctx.env, store: ctx.store, now: ctx.now, D: ctx.D }) }; } catch (error) { return fail(error, 'status'); }
}

// Live last-days source for the chat facts: D-30..D campaign rows, cached 10 min by the cache module. Bounded to 10 s so a slow
// Meta never eats the chat's own time; any failure only makes the recent block unavailable.
const RECENT_BOUND_MS = 10000;
const recentSourceOf = ctx => async () => {
  const parts = context(ctx); // throws (and is caught by the facts builder) when Meta is not configured
  const work = parts.cache.read('recent', { D: ctx.D }, { load: () => parts.sales.dailyCampaigns() });
  const out = await raceDeadline(work, RECENT_BOUND_MS, ctx.timeoutSignal);
  if (typeof out === 'symbol') throw new Error('recent_timeout');
  return out;
};

// Vercel's maxDuration is 300 s: post-answer work has to fit in what is left of it.
const AFTER_DEADLINE_MS = 270000;

// Ask the agent: stored snapshots plus one Gemini call. The chat only runs on Gemini with the agent switched on; the
// limiter is touched only after that check, so an off agent never burns anyone's budget. Refusals carry no detail.
// With a conversation id the history comes from storage (the client's own history is ignored); without one a new
// conversation is created and its id returned. Only a real answer is stored, and images never are.
async function ask(ctx) {
  try {
    const state = agentState(ctx.env);
    if (state.reason !== null || state.provider !== 'gemini') return { status: 503, body: { error: 'agent_unavailable' } };
    const startedAt = Number(ctx.now());
    const user = userHash(ctx.env.DASH_SESSION_SECRET, ctx.email);
    let conversation = null;
    if (ctx.params.conversation_id) {
      conversation = await loadConversation({ store: ctx.store, user, id: ctx.params.conversation_id });
      if (!conversation) return { status: 404, body: { error: 'not_found' } };
    }
    const gate = await askGate({ store: ctx.store, secret: ctx.env.DASH_SESSION_SECRET, email: ctx.email });
    if (!gate.ok) return { status: 429, body: { error: 'rate_limited' } };
    const history = conversation ? promptTurns(conversation) : ctx.params.history;
    // Approved notes travel with the question. An unreadable memory only means no notes: the answer never depends on it.
    let notes = [];
    try { notes = (await readMemory({ store: ctx.store })).notes; } catch { logEvent('dash_error', { stage: 'memory_read', code: 'internal' }); }
    const deadlineAt = startedAt + CHAT_DEADLINE_MS;
    const out = await answerQuestion({ store: ctx.store, env: ctx.env, now: ctx.now, sleep: ctx.sleep, D: ctx.D, client: ctx.agentClient, recentSource: recentSourceOf(ctx), deadlineAt, timeoutSignal: ctx.timeoutSignal, question: ctx.params.question, history, summary: conversation?.summary ?? '', memory: memoryBlock(notes), notes: notes.map(n => n.text), contextView: ctx.params.context_view, images: ctx.params.images });
    const refund = () => askRefund({ store: ctx.store, secret: ctx.env.DASH_SESSION_SECRET, email: ctx.email }).catch(() => {});
    // A timeout is a 200 (shown as a friendly notice, not a raw failure) that costs the user no question.
    // The diagnostic record (codes and numbers only) is logged now and stored after the response, so it never delays it.
    const diag = () => {
      if (!out.outcome) return null; // the "no data yet" notice is not a model call
      const record = buildRecord({ at: new Date(Number(ctx.now())).toISOString(), ms: Number(ctx.now()) - startedAt, outcome: out.outcome, attempts: out.attempts, served_by: out.body?.served_by ? modelShort(out.body.served_by) : null, regenerated: out.regenerated, grounded: out.grounded });
      logDiag(record);
      return () => writeDiag({ store: ctx.store, record });
    };
    if (out.body.error === 'agent_timeout') { await refund(); return { status: out.status, body: out.body, after: diag() }; }
    if (out.status >= 400) { await refund(); return { status: out.status, body: out.body, after: diag() }; }
    if (!out.body.facts_date) return { status: out.status, body: out.body }; // the "no data yet" message is not a conversation
    // Notes the model proposed are stored as PENDING (never applied) and only the ones actually kept are reported back.
    if (out.proposals?.length) {
      try {
        const kept = await addProposals({ store: ctx.store, now: ctx.now, texts: out.proposals });
        if (kept.length) out.body.memory_proposals = kept;
      } catch { logEvent('dash_error', { stage: 'memory_propose', code: 'internal' }); }
    }
    try {
      // Persistence counts against the same deadline: when it does not finish in time the answer is sent without a saved id.
      const saveWork = appendExchange({ store: ctx.store, user, now: ctx.now, id: conversation?.id ?? null, question: ctx.params.question, imageCount: ctx.params.images?.length ?? 0, answer: out.body.answer, ads:out.body.ads, model: out.body.served_by || out.body.model, grounded: out.grounded, factsDate: out.body.facts_date });
      const saved = await raceDeadline(saveWork, Math.max(2000, deadlineAt - Number(ctx.now())), ctx.timeoutSignal).then(value => (typeof value === 'symbol' ? null : value));
      if (saved) {
        out.body.conversation_id = saved.id;
        // After the answer is sent: fold older turns into the summary when due. Never delays the user; failures retry next ask.
        out.after = () => maybeSummarize({ store: ctx.store, user, id: saved.id, client: chatClient(ctx.env, ctx.agentClient), env: ctx.env, now: ctx.now, sleep: ctx.sleep, deadlineAt: startedAt + AFTER_DEADLINE_MS });
      }
    } catch { logEvent('dash_error', { stage: 'conversation_save', code: 'internal' }); }
    const record = diag();
    const summary = out.after;
    const after = record || summary ? async () => {
      if (record) { try { await record(); } catch { logEvent('dash_error', { stage: 'diag_write', code: 'internal' }); } }
      if (summary) await summary();
    } : undefined;
    return { status: out.status, body: out.body, after };
  } catch (error) { return fail(error, 'ask'); }
}

// Last chat diagnostics: codes, durations and flags only (never text or identity), read from Redis. Session gated, GET only.
async function agentHealth(ctx) {
  try { return { status: 200, body: await readDiag({ store: ctx.store }) }; } catch (error) { return fail(error, 'agent_health'); }
}

// Conversations: Redis only, private per user (keyed by an HMAC of the session email). Another user's id is simply not found.
const userOf = ctx => userHash(ctx.env.DASH_SESSION_SECRET, ctx.email);
const notFound = { status: 404, body: { error: 'not_found' } };
async function conversations(ctx) {
  try { return { status: 200, body: { conversations: await listConversations({ store: ctx.store, user: userOf(ctx) }) } }; } catch (error) { return fail(error, 'conversations'); }
}
async function conversation(ctx) {
  try {
    const doc = await loadConversation({ store: ctx.store, user: userOf(ctx), id: ctx.params.id });
    if (!doc) return notFound;
    return { status: 200, body: { id: doc.id, title: doc.title, created_at: doc.created_at, updated_at: doc.updated_at, messages: doc.messages } };
  } catch (error) { return fail(error, 'conversation'); }
}
async function renameConv(ctx) {
  try {
    const doc = await renameConversation({ store: ctx.store, user: userOf(ctx), id: ctx.params.id, title: ctx.params.title });
    return doc ? { status: 200, body: { id: doc.id, title: doc.title } } : notFound;
  } catch (error) { return fail(error, 'conversation_rename'); }
}
async function deleteConv(ctx) {
  try { return (await deleteConversation({ store: ctx.store, user: userOf(ctx), id: ctx.params.id })) ? { status: 200, body: { status: 'ok' } } : notFound; } catch (error) { return fail(error, 'conversation_delete'); }
}

// Memory of decisions: one shared document (the account's, not a person's). Writes are rate limited per user; reading is not.
async function memoryRead(ctx) {
  try { return { status: 200, body: await readMemory({ store: ctx.store }) }; } catch (error) { return fail(error, 'memory'); }
}
const memoryWrite = (stage, run) => async ctx => {
  try {
    const gate = await memoryWriteGate({ store: ctx.store, secret: ctx.env.DASH_SESSION_SECRET, email: ctx.email });
    if (!gate.ok) return { status: 429, body: { error: 'rate_limited' } };
    const result = await run(ctx);
    if (result.ok) return { status: 200, body: result.note ? { note: result.note } : { status: 'ok' } };
    if (result.code === 'full') return { status: 409, body: { error: 'memory_full' } };
    return result.code === 'not_found' ? { status: 404, body: { error: 'not_found' } } : { status: 400, body: { error: 'bad_request' } };
  } catch (error) { return fail(error, stage); }
};
const memoryAdd = memoryWrite('memory_add', ctx => addNote({ store: ctx.store, now: ctx.now, text: ctx.params.text }));
const memoryEdit = memoryWrite('memory_edit', ctx => editNote({ store: ctx.store, now: ctx.now, id: ctx.params.id, text: ctx.params.text }));
const memoryDelete = memoryWrite('memory_delete', ctx => deleteNote({ store: ctx.store, id: ctx.params.id }));
const memoryApprove = memoryWrite('memory_approve', ctx => approveProposal({ store: ctx.store, now: ctx.now, id: ctx.params.id }));
const memoryDiscard = memoryWrite('memory_discard', ctx => discardProposal({ store: ctx.store, id: ctx.params.id }));

async function analyticsReview(ctx){try{const parts=context(ctx,120000);return {status:200,body:await reviewCreative({...ctx,client:parts.client,accountId:String(ctx.env.META_AD_ACCOUNT_ID),id:ctx.params.ad_id,kind:ctx.params.kind})};}catch(e){return {status:400,body:{error:['ai_limit','ai_disabled','ai_busy','ai_unavailable','analysis_incomplete','landing_domain','landing_unavailable'].includes(e.message)?e.message:'review_unavailable'}};}}
async function analytics(ctx){try{const parts=context(ctx,120000),a=createAnalytics({...ctx,client:parts.client,accountId:String(ctx.env.META_AD_ACCOUNT_ID)}),p=ctx.params;const body=await parts.cache.read('analytics-v2',p,{load:()=>p.mode==='creative'?a.creative(p):a.performance(p)});if(p.mode==='creative'){body.settings=await a.settings();const vals=body.ads.length?await ctx.store(['MGET',...body.ads.map(ad=>'dtc:analytics:tags:'+ad.id)]):[];body.ads=body.ads.map((ad,i)=>({...ad,tags:vals[i]?JSON.parse(vals[i]):{}}));}return {status:200,body};}catch(e){return fail(e,'analytics');}}
async function analyticsComments(ctx){try{const parts=context(ctx,120000),a=createAnalytics({...ctx,client:parts.client,accountId:String(ctx.env.META_AD_ACCOUNT_ID)});return {status:200,body:await parts.cache.read('analytics-comments',{id:ctx.params.ad_id},{load:()=>a.comments(ctx.params.ad_id)})};}catch(e){return {status:502,body:{error:'comments_unavailable'}};}}
async function analyticsSave(ctx){try{const parts=context(ctx,120000),a=createAnalytics({...ctx,client:parts.client,accountId:String(ctx.env.META_AD_ACCOUNT_ID)});return {status:200,body:await a.save(ctx.params,userOf(ctx))};}catch(e){return fail(e,'analytics_save');}}
async function analyticsReports(ctx){try{const parts=context(ctx,120000),a=createAnalytics({...ctx,client:parts.client,accountId:String(ctx.env.META_AD_ACCOUNT_ID)});return {status:200,body:await a.reports(userOf(ctx))};}catch(e){return fail(e,'analytics_reports');}}
export const dataRoutes = Object.freeze({
  ...inspirationRoutes, analytics,'analytics/review':analyticsReview, 'analytics/comments':analyticsComments,'analytics/save':analyticsSave,'analytics/reports':analyticsReports,
  sales: guarded('sales'), campaigns: guarded('campaigns'), creatives: guarded('creatives'), pixel: guarded('pixel'), social: guarded('social'), 'creatives/preview': preview, alerts,
  'alerts/read': alertWrite('alerts_read', 'read'), 'alerts/unread': alertWrite('alerts_unread', 'unread'), 'alerts/read-all': alertWrite('alerts_read_all', 'all'), status, 'agent/health': agentHealth, refresh, ask, journal,
  conversations, conversation, 'conversation/rename': renameConv, 'conversation/delete': deleteConv,
  memory: memoryRead, 'memory/add': memoryAdd, 'memory/edit': memoryEdit, 'memory/delete': memoryDelete, 'memory/approve': memoryApprove, 'memory/discard': memoryDiscard,
});
