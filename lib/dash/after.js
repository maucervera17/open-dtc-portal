import { logEvent } from './log.js';

// Work that happens after the response has been sent (summaries, memory proposals). On Vercel the platform keeps the
// invocation alive for promises registered with waitUntil; the hook is read from the request context the platform puts on
// globalThis (the same place the @vercel/functions package reads it, so no dependency is needed). Without it, the job is
// simply awaited before the handler returns. Either way its errors stop here: the user already has the answer.
export async function runAfter(job) {
  const done = Promise.resolve().then(job).catch(() => { logEvent('dash_error', { stage: 'after', code: 'internal' }); });
  try { globalThis[Symbol.for('@vercel/request-context')]?.get?.()?.waitUntil?.(done); } catch { /* not on the platform */ }
  await done;
}
