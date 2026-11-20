import { validateInspiration } from '../inspiration/routes.js';
import { shift } from '../dates.js';
import { spanDays } from './range.js';
import { cleanName } from '../text.js';
import { cleanNote } from '../agent/memory.js';

export class BadRequestError extends Error {
  constructor() { super('bad_request'); this.name = 'BadRequestError'; }
}
const fail = () => { throw new BadRequestError(); };
const str = v => (typeof v === 'string' ? v : fail());
const match = (v, re) => (re.test(str(v)) ? v : fail());
const oneOf = (v, list) => (typeof v === 'string' && list.includes(v) ? v : fail());

export const MAX_SPAN = 732; // Two calendar years, including leap days and inclusive endpoints.
export const MAX_SOCIAL_DAYS = 90;

export const ROUTES = Object.freeze({
 'mcp/tokens': {name:'mcp/tokens',method:'GET',session:true,fields:[]},
 'mcp/create': {name:'mcp/create',method:'POST',session:true,fields:[],fromBody:true},
 'mcp/revoke': {name:'mcp/revoke',method:'POST',session:true,fields:[],fromBody:true},
 'analytics/review':{name:'analytics/review',method:'POST',session:true,fields:['ad_id','analytics_kind'],fromBody:true},
 analytics:{name:'analytics',method:'GET',session:true,fields:['range','analytics']},
 'analytics/comments':{name:'analytics/comments',method:'GET',session:true,fields:['ad_id']},
 'analytics/reports':{name:'analytics/reports',method:'GET',session:true,fields:[]},
 'analytics/save':{name:'analytics/save',method:'POST',session:true,fields:['analytics_save'],fromBody:true},
  'inspiration/enrich':{name:'inspiration/enrich',method:'POST',session:true,fields:['inspiration_id'],fromBody:true},
  'inspiration/capture':{name:'inspiration/capture',method:'POST',session:true,fields:['inspiration_capture'],fromBody:true},
  'inspiration/board':{name:'inspiration/board',method:'POST',session:true,fields:['inspiration_board'],fromBody:true},
  'inspiration/organize':{name:'inspiration/organize',method:'POST',session:true,fields:['inspiration_organize'],fromBody:true},
  'inspiration/follow':{name:'inspiration/follow',method:'POST',session:true,fields:['inspiration_follow'],fromBody:true},
  'inspiration/progress': { name:'inspiration/progress',method:'GET',session:true,fields:[] },
  'inspiration/intelligence': { name:'inspiration/intelligence',method:'GET',session:true,fields:[] },
  'inspiration/profile': { name:'inspiration/profile',method:'POST',session:true,fields:['inspiration_profile'],fromBody:true },
  'inspiration/plan': { name:'inspiration/plan',method:'POST',session:true,fields:[],fromBody:true },
  'inspiration/action': { name:'inspiration/action',method:'POST',session:true,fields:['inspiration_action'],fromBody:true },
  'inspiration/transcribe': {name:'inspiration/transcribe',method:'POST',session:true,fields:['inspiration_id'],fromBody:true},
  'inspiration/transcript': {name:'inspiration/transcript',method:'GET',session:true,fields:['inspiration_id']},
  'inspiration/archive': {name:'inspiration/archive',method:'POST',session:true,fields:['inspiration_id'],fromBody:true},
  'inspiration/discover': {name:'inspiration/discover',method:'POST',session:true,fields:['inspiration_discover'],fromBody:true},
  'inspiration/search': {name:'inspiration/search',method:'POST',session:true,fields:['inspiration_search'],fromBody:true},
  inspiration: { name: 'inspiration', method: 'GET', session: true, fields: [] },
  'inspiration/brand': { name: 'inspiration/brand', method: 'POST', session: true, fields: ['inspiration_brand'], fromBody: true },
  'inspiration/sync': { name: 'inspiration/sync', method: 'POST', session: true, fields: ['inspiration_sync'], fromBody: true },
  'inspiration/note': { name: 'inspiration/note', method: 'POST', session: true, fields: ['inspiration_note'], fromBody: true },
  'inspiration/analysis': { name: 'inspiration/analysis', method: 'GET', session: true, fields: ['inspiration_id'],  },
  'inspiration/analyze': { name: 'inspiration/analyze', method: 'POST', session: true, fields: ['inspiration_analyze'], fromBody: true },
  'auth/request': { name: 'auth/request', method: 'POST', body: ['email'] },
  'auth/consume': { name: 'auth/consume', method: 'POST', body: ['token'] },
  'auth/logout': { name: 'auth/logout', method: 'POST', session: true },
  me: { name: 'me', method: 'GET', session: true },
  sales: { name: 'sales', method: 'GET', session: true, fields: ['range'] },
  campaigns: { name: 'campaigns', method: 'GET', session: true, fields: ['range'] },
  creatives: { name: 'creatives', method: 'GET', session: true, fields: ['range'] },
  'creatives/preview': { name: 'creatives/preview', method: 'GET', session: true, fields: ['ad_id', 'format'] },
  pixel: { name: 'pixel', method: 'GET', session: true, fields: [] },
  social: { name: 'social', method: 'GET', session: true, fields: ['days'] },
  status: { name: 'status', method: 'GET', session: true, fields: [] },
  alerts: { name: 'alerts', method: 'GET', session: true, fields: ['date?'] },
  'alerts/read': { name: 'alerts/read', method: 'POST', session: true, fields: ['alert_ids'], fromBody: true },
  'alerts/unread': { name: 'alerts/unread', method: 'POST', session: true, fields: ['alert_ids'], fromBody: true },
  'alerts/read-all': { name: 'alerts/read-all', method: 'POST', session: true, fields: ['alert_all'], fromBody: true },
  ask: { name: 'ask', method: 'POST', session: true, fields: ['ask'], fromBody: true },
  'agent/health': { name: 'agent/health', method: 'GET', session: true, fields: [] },
  journal: { name: 'journal', method: 'GET', session: true, fields: [] },
  memory: { name: 'memory', method: 'GET', session: true, fields: [] },
  'memory/add': { name: 'memory/add', method: 'POST', session: true, fields: ['memory_add'], fromBody: true },
  'memory/edit': { name: 'memory/edit', method: 'POST', session: true, fields: ['memory_edit'], fromBody: true },
  'memory/delete': { name: 'memory/delete', method: 'POST', session: true, fields: ['memory_id'], fromBody: true },
  'memory/approve': { name: 'memory/approve', method: 'POST', session: true, fields: ['memory_id'], fromBody: true },
  'memory/discard': { name: 'memory/discard', method: 'POST', session: true, fields: ['memory_id'], fromBody: true },
  conversations: { name: 'conversations', method: 'GET', session: true, fields: [] },
  conversation: { name: 'conversation', method: 'GET', session: true, fields: ['conversation_ref'] },
  'conversation/rename': { name: 'conversation/rename', method: 'POST', session: true, fields: ['conversation_rename'], fromBody: true },
  'conversation/delete': { name: 'conversation/delete', method: 'POST', session: true, fields: ['conversation_delete'], fromBody: true },
  refresh: { name: 'refresh', method: 'POST', session: true, fields: ['module', 'range'], fromBody: true },
});

export const route = r => (typeof r === 'string' && Object.hasOwn(ROUTES, r) ? ROUTES[r] : fail());
export const job = j => oneOf(j, ['snapshot', 'agent', 'backfill']);

export function date(v, D) {
  match(v, /^\d{4}-\d{2}-\d{2}$/);
  let roundTrip;
  try { roundTrip = shift(v, 0); } catch { fail(); }
  if (roundTrip !== v || v > D) fail();
  return v;
}
export function range(from, to, D) {
  date(from, D); date(to, D);
  if (from > to || spanDays(from, to) > MAX_SPAN) fail();
  return { from, to };
}
export const adId = v => (match(v, /^\d+$/).length <= 25 ? v : fail());
export const format = v => oneOf(v, ['MOBILE_FEED_STANDARD', 'INSTAGRAM_STANDARD', 'INSTAGRAM_STORY', 'INSTAGRAM_REELS']);
export const module = v => oneOf(v, ['sales', 'campaigns', 'creatives', 'pixel', 'social']);
export function days(v) {
  match(v, /^\d{1,3}$/);
  const n = Number(v);
  return n >= 7 && n <= MAX_SOCIAL_DAYS ? n : fail();
}
export function email(v) {
  const e = str(v).trim().toLowerCase();
  return e && e.length <= 254 ? e : fail();
}
export const token = v => match(v, /^[A-Za-z0-9_-]{43}$/);

// Conversation ids are 16 random bytes as base64url: exactly 22 characters of that alphabet.
export const conversationId = v => match(v, /^[A-Za-z0-9_-]{22}$/);
export const CONVERSATION_TITLE_MAX = 80;
export function conversationTitle(v) {
  if (str(v).length > CONVERSATION_TITLE_MAX) fail();
  return cleanName(v, CONVERSATION_TITLE_MAX) || fail();
}

// A memory note: at most 200 characters after cleaning, no links, never empty (see agent/memory.js).
export const memoryText = v => cleanNote(str(v)) ?? fail();

// Ask-the-agent body: {question, history?, context_view?, images?, conversation_id?}. Control characters become spaces (newlines stay); anything else is rejected.
export const ASK_MAX_QUESTION = 1000;
export const ASK_MAX_TURN = 2000;
export const ASK_MAX_HISTORY = 8;
const CONTROL = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]/g;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k));
function chatText(v, max) {
  if (str(v).length > max) fail();
  const text = v.toWellFormed().replace(CONTROL, ' ').trim();
  return text ? text : fail();
}
// The dashboard view the user is looking at: the route names of the data views, never free text.
export const ASK_VIEWS = Object.freeze(['resumen', 'campanas', 'creativos', 'pixel', 'alertas', 'social', 'inspiracion', 'analiticas']);
// Screenshots: at most 3, PNG, JPEG or WEBP, 2 MB decoded each. The total counts the base64 text, which is what travels in
// the request body and what Vercel's 4.5 MB limit applies to. Nothing here decodes more than one image at a time.
export const ASK_MAX_IMAGES = 3;
export const ASK_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const ASK_MAX_IMAGES_TOTAL = 4 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const startsWith = (bytes, at, signature) => signature.every((b, i) => bytes[at + i] === b);
const SIGNATURES = Object.freeze({
  'image/jpeg': bytes => startsWith(bytes, 0, [0xff, 0xd8, 0xff]),
  'image/png': bytes => startsWith(bytes, 0, [0x89, 0x50, 0x4e, 0x47]),
  'image/webp': bytes => bytes.length >= 12 && startsWith(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, 8, [0x57, 0x45, 0x42, 0x50]),
});
function image(item, budget) {
  if (!exactKeys(item, ['mime', 'data'])) fail();
  const mime = oneOf(item.mime, Object.keys(SIGNATURES));
  const data = str(item.data);
  if (!data || data.length % 4 !== 0 || data.length > budget || data.length > Math.ceil(ASK_MAX_IMAGE_BYTES / 3) * 4) fail();
  if (!BASE64.test(data)) fail();
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0;
  if (data.length / 4 * 3 - padding > ASK_MAX_IMAGE_BYTES) fail();
  const bytes = Buffer.from(data, 'base64');
  if (!SIGNATURES[mime](bytes)) fail();
  return { mime, data };
}
export function ask(source) {
  const s = source && typeof source === 'object' && !Array.isArray(source) ? source : fail();
  if (Object.keys(s).some(k => k !== 'question' && k !== 'history' && k !== 'context_view' && k !== 'images' && k !== 'conversation_id')) fail();
  const question = chatText(s.question, ASK_MAX_QUESTION);
  let history = [];
  if (s.history !== undefined) {
    if (!Array.isArray(s.history) || s.history.length > ASK_MAX_HISTORY) fail();
    history = s.history.map(turn => {
      if (!exactKeys(turn, ['role', 'text'])) fail();
      return { role: oneOf(turn.role, ['user', 'agent']), text: chatText(turn.text, ASK_MAX_TURN) };
    });
  }
  const out = { question, history };
  if (s.conversation_id !== undefined) out.conversation_id = conversationId(s.conversation_id);
  if (s.context_view !== undefined) out.context_view = oneOf(s.context_view, ASK_VIEWS);
  if (s.images !== undefined) {
    if (!Array.isArray(s.images) || s.images.length > ASK_MAX_IMAGES) fail();
    let budget = ASK_MAX_IMAGES_TOTAL;
    const images = s.images.map(item => { const checked = image(item, budget); budget -= checked.data.length; return checked; });
    if (images.length) out.images = images;
  }
  return out;
}

// Alert read state: {date, ids} with at most 50 ids shaped like "campaign:123" or "ad:123" (the recommendation's entity), or {date} alone.
export const ALERT_ID = /^(?:campaign|ad):[\w.:-]{1,60}$/;
export const ALERT_MAX_IDS = 50;
function alertIds(v) {
  if (!Array.isArray(v) || !v.length || v.length > ALERT_MAX_IDS) fail();
  return [...new Set(v.map(id => match(id, ALERT_ID)))];
}

export function params(spec, source, D) {
  const s = source && typeof source === 'object' ? source : {};
  const out = {};
  for (const field of spec.fields || []) {
    if (field.startsWith('inspiration_')) { try { Object.assign(out, validateInspiration(s, field.slice(12))); } catch { fail(); } }
    else if(field==='analytics_kind')out.kind=oneOf(s.kind,['tags','landing']);
    else if(field==='analytics'){out.mode=oneOf(s.mode||'performance',['performance','creative']);out.level=oneOf(s.level||'campaign',['account','campaign','adset','ad']);out.dimension=oneOf(s.dimension||'none',['none','age','gender','age_gender','placement','geo','device']);out.granularity=oneOf(s.granularity||'day',['day','week','month']);if(spanDays(out.from,out.to)>366)fail();}
    else if(field==='analytics_save'){out.kind=oneOf(s.kind,['tags','settings','report']);out.id=out.kind==='tags'?adId(s.id):out.kind==='report'?match(s.id,/^[a-zA-Z0-9-]{1,50}$/):'settings';if(!s.value||typeof s.value!=='object'||Array.isArray(s.value))fail();const allowed=out.kind==='tags'?['persona','desire','usp','narrative','message','emotion','visual_hook','offer','format','production']:out.kind==='settings'?['metric','target','min_spend','min_conversions']:['name','from','to','level','dimension','granularity','metric'];if(Object.keys(s.value).some(k=>!allowed.includes(k)))fail();out.value={};for(const [k,v] of Object.entries(s.value)){if(typeof v!=='string'||v.length>500)fail();out.value[k]=v;}if(out.kind==='settings'){oneOf(out.value.metric,['roas','cpa','cpl']);for(const k of ['target','min_spend','min_conversions'])if(!Number.isFinite(Number(out.value[k]))||Number(out.value[k])<=0)fail();}if(out.kind==='report'){range(out.value.from,out.value.to,D);oneOf(out.value.level,['account','campaign','adset','ad']);oneOf(out.value.dimension,['none','age','gender','age_gender','placement','geo','device']);oneOf(out.value.granularity,['day','week','month']);}}
    else if (field === 'range') Object.assign(out, range(s.from, s.to, D));
    else if (field === 'ad_id') out.ad_id = adId(s.ad_id);
    else if (field === 'format') out.format = format(s.format);
    else if (field === 'days') out.days = days(s.days);
    else if (field === 'module') out.module = module(s.module);
    else if (field === 'ask') Object.assign(out, ask(source));
    else if (field === 'conversation_ref') out.id = conversationId(s.id);
    else if (field === 'conversation_rename') { if (!exactKeys(source, ['id', 'title'])) fail(); out.id = conversationId(s.id); out.title = conversationTitle(s.title); }
    else if (field === 'conversation_delete') { if (!exactKeys(source, ['id'])) fail(); out.id = conversationId(s.id); }
    else if (field === 'memory_add') { if (!exactKeys(source, ['text'])) fail(); out.text = memoryText(s.text); }
    else if (field === 'memory_edit') { if (!exactKeys(source, ['id', 'text'])) fail(); out.id = conversationId(s.id); out.text = memoryText(s.text); }
    else if (field === 'memory_id') { if (!exactKeys(source, ['id'])) fail(); out.id = conversationId(s.id); }
    else if (field === 'alert_ids') { if (!exactKeys(source, ['date', 'ids'])) fail(); out.date = date(s.date, D); out.ids = alertIds(s.ids); }
    else if (field === 'alert_all') { if (!exactKeys(source, ['date'])) fail(); out.date = date(s.date, D); }
    else if (field === 'date?') { if (s.date !== undefined) out.date = date(s.date, D); }
  }
  return out;
}
