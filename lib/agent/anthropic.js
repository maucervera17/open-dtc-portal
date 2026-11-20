import Anthropic from '@anthropic-ai/sdk';
import { AGENT_SYSTEM_TEXT } from './instruction.js';
import { AGENT_SCHEMA } from './schema.js';
import { ANTHROPIC_DEFAULT_MODEL } from './config.js';
import { failure, withRetries } from './retry.js';

export const DEFAULT_MODEL = ANTHROPIC_DEFAULT_MODEL;
export const CALL_TIMEOUT_MS = 90000;

// Escapes <, > and & so that no string inside the facts (an ad name, a caption) can close the <facts> tag.
export const safeJson = value => JSON.stringify(value).replace(/[<>&]/g, c => `\\u00${c.charCodeAt(0).toString(16).padStart(2, '0')}`);

// The request is a pure function of the facts and the environment, so it can be inspected in tests.
// Deliberately absent: tools, tool_choice, thinking (adaptive by default), temperature, top_p, top_k and any prefill.
export function buildAgentRequest(facts, env = {}, memory = '') {
  return {
    model: env.AGENT_MODEL || DEFAULT_MODEL,
    max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'high', format: { type: 'json_schema', schema: AGENT_SCHEMA } },
    system: AGENT_SYSTEM_TEXT,
    messages: [{ role: 'user', content: `<facts>\n${safeJson(facts)}\n</facts>${memory ? `\n\n${memory}` : ''}` }],
  };
}

export const createAnthropicClient = env => new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: CALL_TIMEOUT_MS, maxRetries: 0 });

// Typed SDK errors, most specific first. Only 429, 5xx, timeouts and connection errors are retryable.
export function classify(error) {
  if (error instanceof Anthropic.RateLimitError) return { stage: 'anthropic_rate_limit', code: 429, retry: true };
  if (error instanceof Anthropic.APIConnectionTimeoutError) return { stage: 'anthropic_timeout', code: 'timeout', retry: true };
  if (error instanceof Anthropic.APIConnectionError) return { stage: 'anthropic_connection', code: 'connection', retry: true };
  if (error instanceof Anthropic.APIError) {
    const status = Number.isInteger(error.status) ? error.status : 'unknown';
    return { stage: 'anthropic_http', code: status, retry: typeof status === 'number' && status >= 500 };
  }
  return { stage: 'internal', code: 'unexpected', retry: false };
}

// Reads the model answer. stop_reason is checked before any content is touched.
export function readResponse(res) {
  if (res?.stop_reason === 'refusal') return failure('refusal', { category: res.stop_details?.category ?? null });
  if (res?.stop_reason === 'max_tokens') return failure('truncated');
  const block = Array.isArray(res?.content) ? res.content.find(b => b?.type === 'text') : null;
  if (!block || typeof block.text !== 'string') return failure('parse');
  let output;
  try { output = JSON.parse(block.text); } catch { return failure('parse'); }
  if (!output || typeof output !== 'object' || Array.isArray(output)) return failure('parse');
  const usage = {};
  for (const key of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (Number.isFinite(res.usage?.[key])) usage[key] = res.usage[key];
  }
  return { ok: true, output, served_by: typeof res.model === 'string' ? res.model.slice(0, 80) : null, usage };
}

// One budget-aware call; the retry loop is shared with the other providers (retry.js).
export function callAgent({ client, facts, env, now, sleep, deadlineAt, memory = '' }) {
  const request = buildAgentRequest(facts, env, memory);
  return withRetries({
    send: async () => readResponse(await client.beta.messages.create(request, { timeout: CALL_TIMEOUT_MS })),
    classify, now, sleep, deadlineAt, callTimeoutMs: CALL_TIMEOUT_MS,
  });
}
