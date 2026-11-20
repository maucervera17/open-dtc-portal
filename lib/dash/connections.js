import { readAlerts } from '../agent/alerts.js';
import { readSnapStatus } from './status.js';
import { pixelStatsEnabled } from './pixel.js';
import { tokenExpiry } from './token.js';
import { providerOf, hasKey, modelOf, DEFAULT_PROVIDER } from '../agent/config.js';

// Connection status for the dashboard. The payload carries states and reason codes only: never an env value, a token
// or a Meta message. The client maps the codes to copy.
const has = value => typeof value === 'string' && value.trim() !== '';
const SAFE_CODE = /^[a-z_]{1,30}$/;
const safeCode = code => (typeof code === 'number' && Number.isInteger(code) ? code : typeof code === 'string' && SAFE_CODE.test(code) ? code : undefined);
const source = (id, state, reason, extra = {}) => ({ id, state, reason, ...extra });

// Provider, key and switch as booleans plus the model name. `reason` is why the agent cannot run, or null.
// Names only: the key itself is never read into the payload.
export function agentState(env = {}) {
  const provider = providerOf(env);
  const shown = provider || DEFAULT_PROVIDER;
  const configured = provider ? hasKey(env, provider) : false;
  const enabled = env.AGENT_ENABLED === 'true';
  const reason = !provider ? 'invalid_provider' : !configured ? 'missing_key' : !enabled ? 'agent_disabled' : null;
  return { enabled, configured, reason, provider: shown, model: modelOf(env, shown) };
}

const metaConfigured = env => has(env.META_ACCESS_TOKEN) && /^\d+$/.test(String(env.META_AD_ACCOUNT_ID ?? ''));
const igConfigured = env => has(env.INSTAGRAM_ACCESS_TOKEN) && has(env.INSTAGRAM_USER_ID) && has(env.INSTAGRAM_USERNAME);

// One snapshot-job module entry -> a source. `entry` is undefined when the job never reported this module.
function fromJob(id, entry, { configured, missing, warn = false, attributed = false }) {
  if (!configured) return source(id, 'not_configured', missing);
  if (id === 'pixel' && (attributed || (entry?.ok === true && entry.code === 'attributed'))) return source(id, 'attributed', 'attributed');
  if (!entry) return source(id, 'pending', 'no_snapshot_yet');
  if (entry.ok === true) return source(id, 'connected', entry.partial?.length ? 'partial' : warn ? 'token_expiring' : 'ok');
  if (entry.code === 'no_permission') return source(id, 'no_permission', 'no_permission');
  const code = safeCode(entry.code);
  return source(id, 'error', 'job_failed', code !== undefined ? { code } : {});
}

function emqSource(env, pixel) {
  if (!has(env.META_SYSTEM_USER_TOKEN)) return source('emq', 'not_configured', 'no_system_token');
  if (!pixel) return source('emq', 'pending', 'no_snapshot_yet');
  if (pixel.ok !== true) return source('emq', 'pending', 'pixel_not_ready');
  return pixel.partial?.includes('emq') ? source('emq', 'error', 'emq_failed') : source('emq', 'connected', 'ok');
}

function agentSource(env, run) {
  const agent = agentState(env);
  const named = { provider: agent.provider, model: agent.model };
  if (agent.reason === 'invalid_provider') return source('agent', 'error', 'invalid_provider', named);
  if (agent.reason) return source('agent', 'not_configured', agent.reason, named);
  if (!run) return source('agent', 'pending', 'no_runs_yet', named);
  if (run.status === 'ok') return source('agent', 'connected', 'ok', named);
  const stage = safeCode(run.stage);
  return source('agent', 'error', 'run_failed', { ...named, ...(stage !== undefined ? { stage } : {}) });
}

export async function readConnections({ env, store, now, D }) {
  const [latest, alerts] = await Promise.all([readSnapStatus(store, D), readAlerts({ store, D })]);
  const job = latest?.status || {};
  const token = tokenExpiry(env, Number(now()));
  const meta = { configured: metaConfigured(env), missing: 'missing_meta_config' };
  const stamps = Object.values(job).map(entry => entry?.at).filter(value => typeof value === 'string').sort();
  return {
    generated_at: new Date(Number(now())).toISOString(),
    sources: [
      fromJob('sales', job.sales, { ...meta, warn: token.token_warning }),
      fromJob('creatives', job.creatives, meta),
      fromJob('pixel', job.pixel, { ...meta, attributed: !pixelStatsEnabled(env) }),
      emqSource(env, job.pixel),
      fromJob('ig', job.ig, { configured: igConfigured(env), missing: 'missing_ig_config' }),
      agentSource(env, alerts.run),
    ],
    last_snapshot: latest && stamps.length ? { date: latest.date, at: stamps.at(-1) } : null,
    token: { warning: token.token_warning },
  };
}
