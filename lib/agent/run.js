import { K } from '../dash/store.js';
import { writeSnap } from '../dash/snapshot.js';
import { logEvent } from '../dash/log.js';
import { buildFacts, inputHash } from './facts.js';
import { PLAYBOOK_VERSION } from './playbook.js';
import { SKILL_VERSION } from './skills/claude-ads-meta.js';
import { providerOf, hasKey, modelOf, DEFAULT_PROVIDER } from './config.js';
import { createProviderClient, callProvider } from './provider.js';
import { validateOutput } from './validate.js';
import { plainRun } from './plain.js';
import { sendDigest } from './digest.js';
import { readMemory, memoryBlock } from './memory.js';
import { objectiveSummary } from './objectives.js';

const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

// The agent has no Meta client and no tools: its only inputs are snapshots in Redis and its only outputs are the stored
// run and an optional email. `client` (the selected provider's SDK client) is injectable so tests never touch the network.
export function createAgent({
  client, store, now = Date.now, env = process.env, recentSource, fetch: fetcher = (...args) => globalThis.fetch(...args), sleep, timeoutSignal,
} = {}) {
  const wait = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const signal = timeoutSignal || (ms => AbortSignal.timeout(ms));
  const persist = (D, doc) => writeSnap({ store, module: 'agent', date: D, value: doc, ref: D, key: K.agentRun(D) });
  const digest = (run, D) => sendDigest({ run, D, env, store, fetch: fetcher, signal });

  async function run({ D, deadlineAt }) {
    if (env.AGENT_ENABLED !== 'true') return { status: 'agent_disabled' };
    const existing = parse(await store(['GET', K.agentRun(D)]));
    if (existing?.status === 'ok') {
      await digest(existing, D); // idempotent: a marker and the Resend key stop a second email
      return { status: 'already_ok', date: D };
    }

    // An unknown AGENT_PROVIDER leaves `provider` null: the run fails closed below instead of guessing one.
    const provider = providerOf(env);
    const model = modelOf(env, provider || DEFAULT_PROVIDER);
    const base = { generated_at: new Date(Number(now())).toISOString(), provider: provider || 'invalid', model, playbook_version: PLAYBOOK_VERSION, skill_version: SKILL_VERSION };
    const fail = async (stage, { code, category, input_hash = null } = {}) => {
      logEvent('dash_agent', { stage, code });
      await persist(D, {
        ...base, status: 'failed', stage, ...(code !== undefined ? { code } : {}), ...(category !== undefined ? { category } : {}),
        input_hash, summary: null, recommendations: [], rejected: [], data_gaps: [],
      });
      return { status: 'failed', date: D, stage, ...(code !== undefined ? { code } : {}) };
    };

    const facts = await buildFacts({ store, D, env, recentSource });
    if (!facts) return fail('no_facts');
    // Approved notes travel with the facts; an unreadable memory simply means none (the run never depends on it).
    const memory = await readMemory({ store }).then(m => memoryBlock(m.notes)).catch(() => '');
    const hash = inputHash(facts, model, undefined, memory);
    if (!provider) return fail('config', { code: 'provider', input_hash: hash });
    const agentClient = client || (hasKey(env, provider) ? createProviderClient(provider, env) : null);
    if (!agentClient) return fail('config', { input_hash: hash });

    const result = await callProvider(provider, { client: agentClient, facts, env, now, sleep: wait, deadlineAt, memory });
    if (!result.ok) return fail(result.stage, { code: result.code, category: result.category, input_hash: hash });

    // Validation checks the model's own words and numbers first; the plain-language pass then rewrites jargon only.
    const checked = plainRun(validateOutput({ output: result.output, facts, env, D }), facts.windows);
    const doc = { ...base, status: 'ok', served_by: result.served_by, input_hash: hash, windows: facts.windows, ...checked, objectives: objectiveSummary(facts), usage: result.usage };
    await persist(D, doc);
    await digest(doc, D);
    return { status: 'ok', date: D, recommendations: doc.recommendations.length, rejected: doc.rejected.length };
  }

  return { run };
}
