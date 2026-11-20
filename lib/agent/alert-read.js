import { K, TTL } from '../dash/store.js';

// Per-user read state of the agent's alerts. One JSON array of alert ids per user and run date, keyed by an HMAC of the
// session email (never the email) and expiring after about 30 days. An alert id is "{entity_type}:{entity_id}": one run holds
// at most one recommendation per entity, so it is unique inside a run.
export const alertId = rec => `${rec?.entity_type}:${rec?.entity_id}`;
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };

// Only ids that belong to the run are ever kept, so the stored list can never hold anything the user did not see.
export async function readIds({ store, user, date, run }) {
  const stored = parse(await store(['GET', K.alertRead(user, date)]));
  const valid = new Set(run.recommendations.map(alertId));
  return [...new Set(Array.isArray(stored) ? stored.filter(id => typeof id === 'string' && valid.has(id)) : [])].sort();
}

export async function updateRead({ store, user, date, run, ids, read }) {
  const current = new Set(await readIds({ store, user, date, run }));
  const valid = new Set(run.recommendations.map(alertId));
  for (const id of ids) if (valid.has(id)) { if (read) current.add(id); else current.delete(id); }
  const next = [...current].sort();
  await store(['SET', K.alertRead(user, date), JSON.stringify(next), 'EX', TTL.alertRead]);
  return next;
}
