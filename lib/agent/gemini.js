import { GoogleGenAI, ApiError, ThinkingLevel } from '@google/genai';
import { AGENT_SYSTEM_TEXT } from './instruction.js';
import { AGENT_SCHEMA } from './schema.js';
import { GEMINI_DEFAULT_MODEL, geminiChainOf } from './config.js';
import { failure } from './retry.js';
import { runChain } from './chain.js';
import { safeJson } from './anthropic.js';

export const GEMINI_CALL_TIMEOUT_MS = 90000;
// Thinking tokens count against this limit, so it is well above the size of the JSON answer.
export const GEMINI_MAX_OUTPUT_TOKENS = 32000;

// Content-policy stops. Everything else that is not STOP or MAX_TOKENS is reported as an unreadable answer.
export const REFUSAL_FINISHES = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII']);

// Verified against @google/genai's typings (Models.generateContent): `responseJsonSchema` takes plain JSON Schema with
// type, enum, items, properties, additionalProperties and required, which is exactly what AGENT_SCHEMA uses, so the
// schema is passed unchanged. Deliberately absent: tools, safetySettings, and sampling params.
// `retryOptions.attempts: 1` turns the SDK's own retries off so the shared retry loop owns the budget.
// `memory` is the optional <memory> block (see memory.js), placed right after the facts.
export function buildGeminiRequest(facts, env = {}, model = env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL, memory = '') {
  return {
    model,
    contents: `<facts>\n${safeJson(facts)}\n</facts>${memory ? `\n\n${memory}` : ''}`,
    config: {
      systemInstruction: AGENT_SYSTEM_TEXT,
      responseMimeType: 'application/json',
      responseJsonSchema: structuredClone(AGENT_SCHEMA),
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      thinkingConfig: { thinkingLevel: ThinkingLevel.MEDIUM },
      httpOptions: { timeout: GEMINI_CALL_TIMEOUT_MS, retryOptions: { attempts: 1 } },
    },
  };
}

export const createGeminiClient = env => new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);

// Only 429, 5xx, timeouts and network errors are retryable. Nothing from the error text is kept.
export function classifyGemini(error) {
  const status = error instanceof ApiError || Number.isInteger(error?.status) ? error.status : null;
  if (status === 429) return { stage: 'gemini_rate_limit', code: 429, retry: true };
  if (status === 408) return { stage: 'gemini_timeout', code: 'timeout', retry: true };
  if (status !== null) return { stage: 'gemini_http', code: status, retry: status >= 500 };
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return { stage: 'gemini_timeout', code: 'timeout', retry: true };
  if (error instanceof TypeError && (/fetch failed|network|terminated/i.test(String(error.message)) || NETWORK_CODES.has(error.cause?.code))) {
    return { stage: 'gemini_connection', code: 'connection', retry: true };
  }
  return { stage: 'internal', code: 'unexpected', retry: false };
}

export const blocked = reason => typeof reason === 'string' && reason !== '' && reason !== 'BLOCKED_REASON_UNSPECIFIED';

// Reads the answer. The prompt block and the finish reason are checked before any text is touched.
export function readGeminiResponse(res) {
  const blockReason = res?.promptFeedback?.blockReason;
  if (blocked(blockReason)) return failure('refusal', { category: String(blockReason) });
  const finish = res?.candidates?.[0]?.finishReason;
  if (REFUSAL_FINISHES.has(finish)) return failure('refusal', { category: finish });
  if (finish === 'MAX_TOKENS') return failure('truncated');
  const text = res?.text;
  if (typeof text !== 'string') return failure('parse');
  let output;
  try { output = JSON.parse(text); } catch { return failure('parse'); }
  if (!output || typeof output !== 'object' || Array.isArray(output)) return failure('parse');
  const meta = res.usageMetadata || {};
  const usage = {};
  for (const [key, from] of [['input_tokens', 'promptTokenCount'], ['output_tokens', 'candidatesTokenCount'], ['thinking_tokens', 'thoughtsTokenCount']]) {
    if (Number.isFinite(meta[from])) usage[key] = meta[from];
  }
  return { ok: true, output, served_by: typeof res.modelVersion === 'string' ? res.modelVersion.slice(0, 80) : null, usage };
}

// Google saying "busy": 503 or 429 that survived the retries.
export const isOverload = result => !result.ok && (result.code === 503 || result.code === 429);

// The daily run walks the model chain (primary, then each fallback; see chain.js). `served_by` is what Google reports,
// or the model asked for when it reports nothing.
export async function callGemini({ client, facts, env, now, sleep, deadlineAt, memory = '' }) {
  const result = await runChain({
    models: geminiChainOf(env),
    send: async model => readGeminiResponse(await client.models.generateContent(buildGeminiRequest(facts, env, model, memory))),
    now, sleep, deadlineAt, callTimeoutMs: GEMINI_CALL_TIMEOUT_MS,
  });
  if (!result.ok) return result;
  const { model, ...rest } = result;
  return { ...rest, served_by: rest.served_by || model };
}
