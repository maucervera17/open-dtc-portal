import { shift } from '../dates.js';
import { K } from '../dash/store.js';
import { plainRun } from './plain.js';
import { cleanObjectives } from './objectives.js';
import { alertId } from './alert-read.js';
import { cleanWindows } from './windows.js';

const HISTORY_DAYS = 7;
const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const valid = doc => doc && typeof doc === 'object' && typeof doc.status === 'string' && Array.isArray(doc.recommendations);
const list = value => (Array.isArray(value) ? value : []);

// Only stored fields the dashboard shows are returned; usage and anything unexpected stay server side. The prose goes through
// the plain-language pass, so runs stored before it existed read like new ones.
const present = (stored, date) => {
  const doc = plainRun(stored);
  return {
    date, generated_at: doc.generated_at ?? null, status: doc.status, ...(doc.stage ? { stage: doc.stage } : {}), ...(doc.category !== undefined ? { category: doc.category } : {}),
    provider: doc.provider ?? null, model: doc.model ?? null, served_by: doc.served_by ?? null, playbook_version: doc.playbook_version ?? null, skill_version: doc.skill_version ?? null, input_hash: doc.input_hash ?? null,
    summary: doc.summary ?? null, recommendations: doc.recommendations.map(rec => (rec && typeof rec === 'object' ? { ...rec, id: alertId(rec) } : rec)), objectives: cleanObjectives(doc.objectives), windows: cleanWindows(stored.windows), rejected: list(doc.rejected), data_gaps: list(doc.data_gaps),
  };
};

// `date` omitted: the newest run of the last week. Runs are read only from Redis, never from Meta or Anthropic.
export async function readAlerts({ store, D, date }) {
  const dates = Array.from({ length: HISTORY_DAYS }, (_, i) => shift(D, -i));
  const raw = await store(['MGET', ...dates.map(d => K.agentRun(d))]);
  const docs = dates.map((d, i) => ({ date: d, doc: parse(raw?.[i]) })).filter(entry => valid(entry.doc));
  const history = docs.map(({ date: d, doc }) => ({ date: d, status: doc.status, count: doc.recommendations.length }));
  let chosen;
  if (date) {
    const inWindow = docs.find(entry => entry.date === date);
    const doc = inWindow ? inWindow.doc : parse(await store(['GET', K.agentRun(date)]));
    chosen = valid(doc) ? { date, doc } : null;
  } else chosen = docs[0] || null;
  return { run: chosen ? present(chosen.doc, chosen.date) : null, history };
}
