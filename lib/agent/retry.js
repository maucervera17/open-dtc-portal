// One budget-aware retry loop shared by every provider. `send()` performs a single call and returns the parsed result
// (or throws), `classify(error)` says whether a failure is retryable. `deadlineAt` is the job deadline (epoch ms):
// `backoff(attempt)` overrides the default linear wait. The first attempt needs a whole call timeout of budget and a retry needs more than one call timeout left.
export const failure = (stage, extra = {}) => ({ ok: false, stage, ...extra });

export async function withRetries({ send, classify, now, sleep, deadlineAt, callTimeoutMs, maxAttempts = 3, backoffMs = 2000, backoff }) {
  let last = failure('internal');
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const remaining = Number(deadlineAt) - Number(now());
    if (remaining <= 0 || (attempt === 1 && remaining <= callTimeoutMs)) return attempt === 1 ? failure('budget') : last;
    try {
      return await send();
    } catch (error) {
      const { stage, code, retry } = classify(error);
      last = failure(stage, { code });
      if (!retry || attempt === maxAttempts || Number(deadlineAt) - Number(now()) <= callTimeoutMs) return last;
      await sleep(backoff ? backoff(attempt) : backoffMs * attempt);
    }
  }
  return last;
}
