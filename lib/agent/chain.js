import { logEvent } from '../dash/log.js';
import { classifyGemini } from './gemini.js';
import { failure } from './retry.js';

// Google-side trouble: 429, 500, 503, 504, timeouts and dropped connections. Anything else (400, refusals, parse
// errors) would fail the same way on the next model, so it ends the chain.
const MOVE_ON = new Set([429, 500, 503, 504, 'timeout', 'connection']);
export const isTransient = result => !result.ok && MOVE_ON.has(result.code);

// Short pause before the one retry on the same model.
export const CHAIN_BACKOFF_MS = 800;
export const chainBackoff = (random = Math.random) => Math.round(CHAIN_BACKOFF_MS * (0.75 + random() * 0.5));

// 'gemini-3.8-flash' becomes '3.8f', so `<status>:<model-short>` fits the log's [\w.:-]{1,40} rule.
export function modelShort(model) {
  const id = String(model).replace(/^gemini-/, '');
  const m = /^(\d[\d.]*)-([a-z])/.exec(id);
  return m ? `${m[1]}${m[2]}` : id.replace(/[^\w.-]/g, '').slice(0, 12) || 'model';
}

// Tries each model in order, each one up to twice (one short backoff in between). `send(model)` makes one call and returns
// the parsed result or throws. A failed attempt is logged as a code only. An attempt needs more than one call timeout of
// budget left; when it does not fit, the last failure is returned. Never throws.
// With `minAttemptMs` an attempt starts whenever that much time is left and gets min(callTimeoutMs, remaining) as its own
// timeout (`send(model, { timeoutMs })`), so the chain never starts a call that cannot finish before `deadlineAt`.
// `trace.attempts` collects the `<status>:<model-short>` codes of every attempt (also for diagnostics after an abandon).
export async function runChain({ models, send, now, sleep, deadlineAt, callTimeoutMs, minAttemptMs, random = Math.random, trace, cancelled = () => false }) {
  let last = null;
  const remaining = () => Number(deadlineAt) - Number(now());
  const room = () => (minAttemptMs === undefined ? remaining() > callTimeoutMs : remaining() >= minAttemptMs);
  const note = code => { if (trace?.attempts) trace.attempts.push(code); };
  for (const model of models) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (cancelled() || !room()) return last || failure('budget');
      const timeoutMs = minAttemptMs === undefined ? callTimeoutMs : Math.min(callTimeoutMs, remaining());
      let result;
      try {
        result = await send(model, { timeoutMs });
      } catch (error) {
        const { stage, code } = classifyGemini(error);
        result = failure(stage, { code });
      }
      if (result.ok) {
        note(`200:${modelShort(model)}`);
        if (last) logEvent('dash_ask', { stage: 'attempt_ok', code: `200:${modelShort(model)}` });
        return { ...result, model };
      }
      last = result;
      if (result.code !== undefined) note(`${result.code}:${modelShort(model)}`);
      if (result.code !== undefined) logEvent('dash_ask', { stage: 'attempt', code: `${result.code}:${modelShort(model)}` });
      if (!isTransient(result)) return result;
      if (attempt === 1) {
        if (!room()) return last;
        await sleep(chainBackoff(random));
      }
    }
  }
  return last || failure('internal');
}
