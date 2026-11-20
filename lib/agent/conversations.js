import {storedCards} from './ad-references.js';
import { randomBytes } from 'node:crypto';
import { hmac, K } from '../dash/store.js';
import { cleanName, truncate } from '../text.js';

// Persistent chat conversations, private to each user. Everything lives in Redis under the dtc:dash: namespace:
//   conv:{user}:{id}  JSON document (title, messages, summary, summary_upto), expires 180 days after the last write
//   conv:{user}:idx   ZSET id -> updated_at (ms), the order of the list and the eviction order
//   conv:{user}:meta  HASH id -> {title, n}, so the list never has to read the documents themselves
// {user} is an HMAC of the session email (domain separated from the rate limiter's hash), never the email.
// Images are never stored: only a text marker in the user message.
export const CONV = Object.freeze({
  MAX_CONVERSATIONS: 50,
  MAX_MESSAGES: 200,
  TTL: 180 * 86400,
  TITLE_AUTO: 60,
  TITLE_MAX: 80,
  MAX_DOC_CHARS: 300000,
});
const MESSAGE_OVERHEAD = 120; // role, timestamp and model fields, counted against MAX_DOC_CHARS

export const newId = () => randomBytes(16).toString('base64url');
export const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
export const userHash = (secret, email) => hmac(secret, `conv:${String(email).trim().toLowerCase()}`);

const parse = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
const iso = now => new Date(Number(now())).toISOString();
const isMessage = m => m && typeof m === 'object' && (m.role === 'user' || m.role === 'agent') && typeof m.text === 'string';

// A stored document is never trusted: unknown shapes become null and malformed messages are dropped.
function normalize(doc, id) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc) || doc.id !== id || typeof doc.title !== 'string') return null;
  const messages = (Array.isArray(doc.messages) ? doc.messages : []).filter(isMessage).map(m => ({
    ads:m.role==='agent'?storedCards(m.ads):[], role: m.role, text: m.text, at: typeof m.at === 'string' ? m.at : '', ...(typeof m.model === 'string' ? { model: m.model } : {}),
    ...(m.role === 'agent' && typeof m.grounded === 'boolean' ? { grounded: m.grounded } : {}), ...(m.role === 'agent' && typeof m.facts_date === 'string' ? { facts_date: m.facts_date } : {}),
  }));
  const summary = typeof doc.summary === 'string' ? doc.summary : '';
  const upto = Number.isInteger(doc.summary_upto) && doc.summary_upto > 0 ? Math.min(doc.summary_upto, messages.length) : 0;
  return { id, title: doc.title, created_at: doc.created_at, updated_at: doc.updated_at, messages, summary, summary_upto: upto };
}

export async function loadConversation({ store, user, id }) {
  return normalize(parse(await store(['GET', K.conv(user, id)])), id);
}

// Drops the oldest messages beyond the count cap, then beyond the size cap. The summarized prefix shrinks with them.
function trim(doc) {
  let drop = Math.max(0, doc.messages.length - CONV.MAX_MESSAGES);
  let size = doc.summary.length + doc.title.length + doc.messages.slice(drop).reduce((a, m) => a + m.text.length + JSON.stringify(m.ads||[]).length + MESSAGE_OVERHEAD, 0);
  while (size > CONV.MAX_DOC_CHARS && drop < doc.messages.length - 1) {
    size -= doc.messages[drop].text.length + JSON.stringify(doc.messages[drop].ads||[]).length + MESSAGE_OVERHEAD;
    drop++;
  }
  if (drop) {
    doc.messages = doc.messages.slice(drop);
    doc.summary_upto = Math.max(0, doc.summary_upto - drop);
  }
  return doc;
}

const writeDoc = (store, user, doc) => store(['SET', K.conv(user, doc.id), JSON.stringify(doc), 'EX', CONV.TTL]);
const metaOf = doc => JSON.stringify({ title: doc.title, n: doc.messages.length, u: doc.updated_at });

// Keeps the newest MAX_CONVERSATIONS: the oldest by updated_at are deleted together with their documents.
async function evict(store, user) {
  const count = Number(await store(['ZCARD', K.convIdx(user)])) || 0;
  if (count <= CONV.MAX_CONVERSATIONS) return;
  const extra = await store(['ZRANGE', K.convIdx(user), 0, count - CONV.MAX_CONVERSATIONS - 1]);
  for (const id of extra || []) await remove(store, user, id);
}

async function index(store, user, doc, at) {
  await store(['HSET', K.convMeta(user), doc.id, metaOf(doc)]);
  await store(['EXPIRE', K.convMeta(user), CONV.TTL]);
  await store(['ZADD', K.convIdx(user), at, doc.id]);
  await store(['EXPIRE', K.convIdx(user), CONV.TTL]);
}

async function remove(store, user, id) {
  await store(['DEL', K.conv(user, id)]);
  await store(['ZREM', K.convIdx(user), id]);
  await store(['HDEL', K.convMeta(user), id]);
}

export async function createConversation({ store, user, now, title }) {
  const at = iso(now);
  const doc = { id: newId(), title: cleanName(title, CONV.TITLE_MAX) || 'Conversación', created_at: at, updated_at: at, messages: [], summary: '', summary_upto: 0 };
  await writeDoc(store, user, doc);
  await index(store, user, doc, Number(now()));
  await evict(store, user);
  return doc;
}

export const imageMarker = count => (count === 1 ? '[1 captura adjunta]' : `[${count} capturas adjuntas]`);

// One question and its answer, appended together (a failed call never leaves half an exchange). No id: a new conversation
// titled from the first question. An id that no longer exists returns null. The image bytes never reach this function.
export async function appendExchange({ store, user, now, id, question, imageCount = 0, answer, ads=[], model, grounded, factsDate }) {
  let doc;
  if (id) {
    doc = await loadConversation({ store, user, id });
    if (!doc) return null;
  } else doc = { id: newId(), title: cleanName(question, CONV.TITLE_AUTO) || 'Conversación', created_at: iso(now), messages: [], summary: '', summary_upto: 0 };
  const at = iso(now);
  doc.messages.push({ role: 'user', text: imageCount > 0 ? `${question}\n${imageMarker(imageCount)}` : question, at });
  doc.messages.push({ role: 'agent', ads:storedCards(ads), text: answer, at, ...(model ? { model } : {}), ...(typeof grounded === 'boolean' ? { grounded } : {}), ...(typeof factsDate === 'string' ? { facts_date: factsDate } : {}) });
  doc.updated_at = at;
  trim(doc);
  await writeDoc(store, user, doc);
  await index(store, user, doc, Number(now()));
  await evict(store, user);
  return doc;
}

// Summary bookkeeping writes the document only: the list order and the updated_at stay as the user last left them.
export async function saveSummary({ store, user, id, summary, upto }) {
  const doc = await loadConversation({ store, user, id });
  if (!doc || upto <= doc.summary_upto) return false;
  doc.summary = summary;
  doc.summary_upto = Math.min(upto, doc.messages.length);
  await writeDoc(store, user, doc);
  return true;
}

export async function listConversations({ store, user }) {
  const ids = await store(['ZREVRANGE', K.convIdx(user), 0, CONV.MAX_CONVERSATIONS - 1]);
  if (!Array.isArray(ids) || !ids.length) return [];
  const metas = await store(['HMGET', K.convMeta(user), ...ids]);
  const out = [];
  for (let i = 0; i < ids.length; i++) {
    const meta = parse(metas?.[i]);
    if (!meta) { await store(['ZREM', K.convIdx(user), ids[i]]); continue; } // the document expired: tidy the index
    out.push({ id: ids[i], title: String(meta.title ?? ''), updated_at: String(meta.u ?? ''), message_count: Number(meta.n) || 0 });
  }
  return out;
}

export async function renameConversation({ store, user, id, title }) {
  const doc = await loadConversation({ store, user, id });
  if (!doc) return null;
  doc.title = title;
  await writeDoc(store, user, doc);
  await store(['HSET', K.convMeta(user), id, metaOf(doc)]);
  return doc;
}

export async function deleteConversation({ store, user, id }) {
  const doc = await loadConversation({ store, user, id });
  if (!doc) return false;
  await remove(store, user, id);
  return true;
}

// The last `count` messages as prompt turns, each clipped so the prompt size stays bounded whatever was stored.
export const PROMPT_TURNS = 6;
export const PROMPT_TURN_CHARS = 1500;
export function promptTurns(doc, count = PROMPT_TURNS) {
  return doc.messages.slice(-count).map(m => ({ ads:m.role==='agent'?storedCards(m.ads):[], role: m.role, text: truncate(m.text, PROMPT_TURN_CHARS) }));
}
