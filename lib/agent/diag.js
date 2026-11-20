import { K, TTL } from '../dash/store.js';

// Compact diagnostics for the last chat asks: codes, durations and flags only. Never the question, the answer, the
// conversation or who asked. Kept in a Redis list (newest first), trimmed to DIAG_KEEP and expiring after 7 days.
export const DIAG_KEEP = 50;
export const DIAG_SHOWN = 10;
export const OUTCOMES = Object.freeze(['ok', 'timeout', 'overloaded', 'refusal', 'error']);
const FAILURES = new Set(['timeout', 'overloaded', 'error']);
const ATTEMPT = /^[\w]{1,12}:[\w.-]{1,20}$/;
const MODEL = /^[\w.-]{1,20}$/;

// The only way a record is built: every field is rebuilt from a validated value, so nothing else can ride along.
export function buildRecord({ at, ms, outcome, attempts = [], served_by = null, regenerated = false, grounded = false }) {
  const stamp = new Date(at);
  return {
    at: Number.isNaN(stamp.getTime()) ? new Date(0).toISOString() : stamp.toISOString(),
    ms: Number.isFinite(ms) && ms >= 0 ? Math.round(ms) : 0,
    outcome: OUTCOMES.includes(outcome) ? outcome : 'error',
    attempts: (Array.isArray(attempts) ? attempts : []).filter(code => typeof code === 'string' && ATTEMPT.test(code)).slice(0, 12),
    served_by: typeof served_by === 'string' && MODEL.test(served_by) ? served_by : null,
    regenerated: regenerated === true,
    grounded: grounded === true,
  };
}

// One line, same record, codes only.
export const logDiag = record => console.error('dash_diag', record);

export async function writeDiag({ store, record }) {
  await store(['LPUSH', K.diagAsk(), JSON.stringify(record)]);
  await store(['LTRIM', K.diagAsk(), 0, DIAG_KEEP - 1]);
  await store(['EXPIRE', K.diagAsk(), TTL.diag]);
}

const parse = text => { try { const doc = JSON.parse(text); return doc && typeof doc === 'object' ? buildRecord(doc) : null; } catch { return null; } };

const median = values => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

// The last DIAG_SHOWN records (newest first) and aggregates over everything kept (at most DIAG_KEEP).
export async function readDiag({ store }) {
  const rows = (await store(['LRANGE', K.diagAsk(), 0, DIAG_KEEP - 1])) || [];
  const all = rows.map(parse).filter(Boolean);
  const failure = all.find(r => FAILURES.has(r.outcome));
  return {
    records: all.slice(0, DIAG_SHOWN),
    summary: {
      total: all.length,
      success_rate: all.length ? Math.round((all.filter(r => r.outcome === 'ok').length / all.length) * 100) / 100 : null,
      median_ms: median(all.map(r => r.ms)),
      last_error: failure ? { at: failure.at, outcome: failure.outcome } : null,
    },
  };
}
