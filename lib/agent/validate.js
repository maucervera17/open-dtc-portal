import { shift } from '../dates.js';
import { cleanName } from '../text.js';
import { ACTIONS, CONFIDENCE, ENTITY_TYPES, LIMITS } from './schema.js';
import { PURCHASE_GROUPS } from '../dash/objective.js';

// The code validator is the source of truth: the JSON schema only shapes the answer, this decides what a reader may see.
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const isText = (v, max) => typeof v === 'string' && v.length <= max;
const clean = value => cleanName(value, Infinity);
const SAFE_ID = /^[\w.:-]{1,40}$/;
const CITE_TOLERANCE = 0.005;

// ---- facts helpers ----

export function walk(value, visit) {
  if (isNum(value)) visit(value);
  else if (Array.isArray(value)) value.forEach(v => walk(v, visit));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => walk(v, visit));
}

// C-vs-B percentage change for every metric pair one entity (or the account) holds.
function pairChanges(C, B) {
  const out = [];
  if (!C || !B) return out;
  for (const key of Object.keys(C)) if (isNum(C[key]) && isNum(B[key]) && B[key] !== 0) out.push(((C[key] - B[key]) / B[key]) * 100);
  return out;
}

export function changePairs(facts) {
  return [
    ...pairChanges(facts.account?.C, facts.account?.B),
    ...[...(facts.campaigns || []), ...(facts.ads || [])].flatMap(entity => pairChanges(entity.C, entity.B)),
  ];
}

// Numbers a recommendation may quote: its own C and B values, its own C-vs-B changes and the values at its cited paths.
function entityContext(entity, citedValues) {
  const values = [...citedValues];
  walk(entity.C, v => values.push(v));
  walk(entity.B, v => values.push(v));
  return { values, changes: pairChanges(entity.C, entity.B) };
}

// True when a cited path points inside the recommended entity's own record.
function ownsPath(path, list, index) {
  const parts = typeof path === 'string' ? path.match(/[^.[\]]+/g) : null;
  return Boolean(parts) && parts[0] === list && parts[1] === String(index);
}

function resolvePath(facts, path) {
  const parts = typeof path === 'string' && path.length <= 120 ? path.match(/[^.[\]]+/g) : null;
  if (!parts || parts.length > 8) return undefined;
  let node = facts;
  for (const part of parts) {
    if (Array.isArray(node)) {
      if (!/^\d{1,3}$/.test(part)) return undefined;
      node = node[Number(part)];
    } else if (node && typeof node === 'object' && Object.hasOwn(node, part)) node = node[part];
    else return undefined;
  }
  return isNum(node) ? node : undefined;
}

// Purchases are a sample gate only where purchases are the goal; other objectives need impressions and spend alone.
const passesGates = (C, gates, group = 'other') => Boolean(C) && isNum(C.impressions) && C.impressions >= gates.min_impressions
  && isNum(C.spend) && C.spend >= gates.min_spend && (!PURCHASE_GROUPS.has(group) || (isNum(C.purchases) && C.purchases >= gates.min_purchases));

// A rationale or evidence line that judges by purchases, CPA, ROAS or sales (in Spanish or English), or a citation of those metrics.
const PURCHASE_TALK = /\b(?:compras?|purchases?|cpa|roas|ventas?|vendi\w*|costo por (?:compra|adquisici[oó]n)|retorno)\b/i;
const PURCHASE_KEYS = new Set(['purchases', 'cpa', 'roas', 'revenue']);
const purchaseBased = (rec, texts) => texts.some(t => PURCHASE_TALK.test(t)) || rec.cited_metrics.some(({ path }) => PURCHASE_KEYS.has(String(path).split('.').at(-1)));

// ---- number-in-text check ----

const EXEMPT = [
  /\b\d{4}-\d{2}-\d{2}\b/g, // ISO dates
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, // dd/mm dates
  /\b\d+\s*(?:d[ií]as?|semanas?|se[ñn]ales?)\b/gi, // day, week and signal counts
];
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

const LINK = /https?:\/\/|www\.|[\w.+-]+@[\w-]+\.[\w.-]+/i;

// The numbers of `text` that no source in `context` backs, in order of appearance. `context.exempt` replaces the default
// date/day-count patterns (the chat does its own, stricter, date handling before calling this).
export function ungroundedNumbers(text, context) {
  let rest = String(text);
  for (const pattern of context.exempt ?? EXEMPT) rest = rest.replace(pattern, ' ');
  // Long digit strings are exempt only when they are exactly an entity id present in the facts.
  rest = rest.replace(/\b\d{10,}\b/g, id => (context.ids.has(id) ? ' ' : id));
  const bad = [];
  for (const match of rest.matchAll(NUMBER)) {
    const token = match[0];
    const value = Number(token.replace(/,/g, ''));
    const decimals = (token.split('.')[1] || '').length;
    const percent = /^\s*%/.test(rest.slice(match.index + token.length));
    if (!percent && decimals === 0 && (value === 0 || value === 1)) continue;
    const tolerance = 0.5 * 10 ** -decimals + 1e-9;
    if (context.values.some(f => Math.abs(value - f) <= tolerance)) continue;
    if (percent && context.changes.some(change => Math.abs(value - Math.abs(change)) <= 1)) continue;
    bad.push(token);
  }
  return bad;
}

const textIsGrounded = (text, context) => ungroundedNumbers(text, context).length === 0;
export { NUMBER };

// ---- labelled numbers and direction ----

// A number written next to a metric name must be that metric (of the entity, or of the account when the sentence says so), a
// percentage must be that metric's own C-vs-B change, and sube/baja words must agree with its sign.
const METRIC_LABELS = [
  ['cpa', 'entity', '\\bcpa\\b|costo por (?:compra|adquisici[oó]n)'],
  ['spend', 'entity', '\\bgasto\\b|\\binversi[oó]n\\b|\\bspend\\b'],
  ['roas', 'entity', '\\broas\\b|\\bretorno\\b'],
  ['purchases', 'entity', '\\bcompras?\\b|\\bpurchases?\\b'],
  ['ctr_pct', 'entity', '\\bctr\\b'],
  ['frequency', 'entity', '\\bfrecuencia\\b'],
  ['revenue', 'entity', '\\bingresos?\\b|\\brevenue\\b'],
];
const LABEL = new RegExp(METRIC_LABELS.map(([key, , source], i) => `(?<m${i}>${source})`).join('|'), 'gi');
const SEGMENT_END = /(?<!\d)[.;\n](?!\d)|\b(?:pero|mientras|aunque)\b/i;
const TARGET_TALK = /objetivo|\bmeta\b|umbral|m[ií]nim|l[ií]mite/i;
const UP = /(?<![\p{L}])(?:sub(?:e|en|i[óo]|ieron)|aument(?:a|an|[óo]|aron)|crec(?:e|en|i[óo]|ieron)|increment(?:a|an|[óo]|aron))(?![\p{L}])/iu;
const DOWN = /(?<![\p{L}])(?:baj(?:a|an|[óo]|aron)|ca(?:e|en|y[óo]|yeron)|disminu(?:ye|yen|y[óo]|yeron)|redu(?:ce|cen|jo|jeron)|descend(?:e|en|i[óo]|ieron))(?![\p{L}])/iu;
const BIND_REACH = 40;

function labelsIn(text) {
  const found = [...text.matchAll(LABEL)].map(match => {
    const index = METRIC_LABELS.findIndex((_, i) => match.groups[`m${i}`] !== undefined);
    return { key: METRIC_LABELS[index][0], start: match.index, end: match.index + match[0].length };
  });
  return found.map((label, i) => {
    let stop = i + 1 < found.length ? found[i + 1].start : text.length;
    const boundary = text.slice(label.end, stop).search(SEGMENT_END);
    if (boundary >= 0) stop = label.end + boundary;
    return { ...label, segment: text.slice(label.end, stop), sentence: text };
  });
}

const near = (value, actual, decimals) => Math.abs(value - actual) <= 0.5 * 10 ** -decimals + 1e-9;
const decimalsOf = token => (token.split('.')[1] || '').length;

// Returns 'metric_mismatch', 'direction_mismatch' or null for one text of a recommendation.
function labelError(raw, entity, account) {
  let text = String(raw);
  for (const pattern of EXEMPT) text = text.replace(pattern, ' ');
  const mentionsAccount = /\bcuenta\b/i.test(text);
  for (const { key, segment } of labelsIn(text)) {
    if (TARGET_TALK.test(segment)) continue;
    const owners = [entity, ...(mentionsAccount ? [account] : [])];
    const values = owners.flatMap(o => [o?.C?.[key], o?.B?.[key]]).filter(isNum);
    const changes = owners.flatMap(o => (isNum(o?.C?.[key]) && isNum(o?.B?.[key]) && o.B[key] !== 0 ? [((o.C[key] - o.B[key]) / o.B[key]) * 100] : []));
    let bound = 0;
    for (const match of segment.slice(0, BIND_REACH).matchAll(NUMBER)) {
      const token = match[0];
      const before = segment[match.index - 1] || '', after = segment[match.index + token.length] || '';
      if (/[\p{L}]/u.test(before) || /[\p{L}]/u.test(after.replace(/^%/, ''))) continue; // part of a name such as "3x2" or "B12"
      const value = Number(token.replace(/,/g, ''));
      const decimals = decimalsOf(token);
      if (/^\s*%/.test(segment.slice(match.index + token.length))) {
        if (!changes.length && !values.length) continue;
        if (values.some(v => near(value, v, decimals)) || changes.some(c => Math.abs(value - Math.abs(c)) <= 1)) continue;
        return 'metric_mismatch';
      }
      if (++bound > 2) break;
      if (decimals === 0 && (value === 0 || value === 1)) continue;
      if (!values.some(v => near(value, v, decimals))) return 'metric_mismatch';
    }
    const change = changes[0];
    if (change === undefined) continue;
    if (UP.test(segment) && !(change > 0)) return 'direction_mismatch';
    if (DOWN.test(segment) && !(change < 0)) return 'direction_mismatch';
  }
  return null;
}

// A gap that says an integration is missing is a claim about the account, not a limit of the analysis. Only an explicit flag in
// the facts (never set today) lets it through.
const INTEGRATION_CLAIM = /(?:no est[aá] instalad|no (?:tiene|hay|existe|cuenta con) (?:un |el |ning[uú]n )?(?:p[ií]xel|api de conversiones|capi)|sin p[ií]xel|falta(?:n)? (?:el |la |los )?(?:p[ií]xel|api de conversiones|capi)|p[ií]xel (?:no )?(?:instalado|roto|bloqueado)|(?:api de conversiones|capi) (?:no )?(?:instalad|configurad|conectad))/i;
const integrationFlagged = (facts, text) => (/capi|api de conversiones/i.test(text) ? facts.pixel?.conversions_api === false : facts.pixel?.installed === false);

// ---- entity shape ----

function shapeError(rec) {
  if (!rec || typeof rec !== 'object' || Array.isArray(rec)) return 'invalid_shape';
  if (typeof rec.action !== 'string' || !ACTIONS.includes(rec.action)) return 'invalid_action';
  if (!ENTITY_TYPES.includes(rec.entity_type) || typeof rec.entity_id !== 'string' || rec.entity_id.length > 60) return 'invalid_shape';
  if (!CONFIDENCE.includes(rec.confidence)) return 'invalid_shape';
  if (!isText(rec.rationale, LIMITS.RATIONALE_CHARS) || !rec.rationale.trim()) return 'invalid_shape';
  if (!Array.isArray(rec.evidence) || rec.evidence.length > LIMITS.MAX_EVIDENCE || !rec.evidence.every(e => isText(e, LIMITS.EVIDENCE_CHARS))) return 'invalid_shape';
  if (!Array.isArray(rec.cited_metrics) || rec.cited_metrics.length > LIMITS.MAX_CITED) return 'invalid_shape';
  if (!rec.cited_metrics.every(m => m && typeof m.path === 'string' && isNum(m.value))) return 'invalid_shape';
  const [min, max] = LIMITS.REVIEW_DAYS;
  if (!Number.isInteger(rec.review_after_days) || rec.review_after_days < min || rec.review_after_days > max) return 'invalid_shape';
  return null;
}

export function validateOutput({ output, facts, env = {}, D }) {
  const gaps = [...(facts.data_gaps || [])];
  const empty = reason => ({ summary: null, recommendations: [], rejected: [{ reason }], data_gaps: gaps });
  if (!output || typeof output !== 'object' || Array.isArray(output)) return empty('invalid_output');

  const values = [];
  walk(facts, v => values.push(v));
  const ids = new Set();
  for (const e of [...(facts.campaigns || []), ...(facts.ads || [])]) for (const id of [e.id, e.campaign_id]) if (typeof id === 'string') ids.add(id);
  const globalContext = { values, changes: changePairs(facts), ids };
  const entities = new Map();
  (facts.campaigns || []).forEach((c, index) => entities.set(`campaign:${c.id}`, { entity: c, list: 'campaigns', index }));
  (facts.ads || []).forEach((a, index) => entities.set(`ad:${a.id}`, { entity: a, list: 'ads', index }));
  const seen = new Set();
  const hasTarget = t => facts.targets && isNum(facts.targets[t]) && facts.targets[t] > 0;

  const recommendations = [];
  const rejected = [];
  const reject = (rec, reason) => {
    if (rejected.length >= LIMITS.MAX_REJECTED) return;
    rejected.push({
      reason,
      ...(typeof rec?.entity_id === 'string' && SAFE_ID.test(rec.entity_id) ? { entity_id: rec.entity_id } : {}),
      ...(ACTIONS.includes(rec?.action) ? { action: rec.action } : {}),
    });
  };

  for (const rec of Array.isArray(output.recommendations) ? output.recommendations : []) {
    const bad = shapeError(rec);
    if (bad) { reject(rec, bad); continue; }
    if (recommendations.length >= LIMITS.MAX_RECOMMENDATIONS) { reject(rec, 'limit'); continue; }
    const key = `${rec.entity_type}:${rec.entity_id}`;
    const found = entities.get(key);
    if (!found) { reject(rec, 'unknown_entity'); continue; }
    if (seen.has(key)) { reject(rec, 'duplicate_entity'); continue; }
    const { entity } = found;
    if (!rec.cited_metrics.length) { reject(rec, 'no_citation'); continue; }
    const cited = rec.cited_metrics.every(({ path, value }) => {
      const actual = resolvePath(facts, path);
      return actual !== undefined && Math.abs(value - actual) <= Math.max(Math.abs(actual) * CITE_TOLERANCE, CITE_TOLERANCE);
    });
    if (!cited) { reject(rec, 'cited_mismatch'); continue; }
    const ownPath = path => ownsPath(path, found.list, found.index);
    const accountPath = path => typeof path === 'string' && path.match(/[^.[\]]+/g)?.[0] === 'account';
    if (!rec.cited_metrics.some(({ path }) => ownPath(path)) || !rec.cited_metrics.every(({ path }) => ownPath(path) || accountPath(path))) { reject(rec, 'foreign_citation'); continue; }
    const texts = [rec.rationale, ...rec.evidence];
    if (texts.some(t => LINK.test(t))) { reject(rec, 'link'); continue; }
    const context = { ...entityContext(entity, rec.cited_metrics.map(({ path }) => resolvePath(facts, path))), ids };
    if (!texts.every(t => textIsGrounded(t, context))) { reject(rec, 'invented_number'); continue; }
    const labelled = texts.map(t => labelError(t, entity, facts.account)).find(Boolean);
    if (labelled) { reject(rec, labelled); continue; }
    if (['REPLACE_CREATIVE', 'SCALE', 'CONTINUE'].includes(rec.action) && (entity.delivery === 'ended' || entity.delivery === 'paused')) { reject(rec, 'not_delivering'); continue; }

    let action = rec.action;
    let guardrail;
    const group = entity.objective_group || 'other';
    const judgedByPurchases = PURCHASE_GROUPS.has(group);
    if (action === 'REPLACE_CREATIVE' && !(rec.entity_type === 'ad' && entity.fatigue_state === 'FATIGUED')) { reject(rec, 'not_fatigued'); continue; }
    if (action === 'STOP') {
      // Stopping an ad that already ended or is paused changes nothing; the dashboard reads it as noise.
      if (entity.delivery === 'ended' || entity.delivery === 'paused') { reject(rec, 'not_delivering'); continue; }
      const gate = facts.gates?.stop_min_spend_c;
      if (!isNum(gate) || !isNum(entity.C?.spend) || entity.C.spend < gate) { reject(rec, 'below_sample_gate'); continue; }
      const C = entity.C;
      const accountCpa = facts.account?.C?.cpa;
      // Profile growth, engagement, awareness, leads and site traffic have no purchase economics to stop on.
      const bad = !judgedByPurchases ? false : C.purchases === 0
        || (hasTarget('cpa') && isNum(C.cpa) && C.cpa > facts.targets.cpa)
        || (isNum(accountCpa) && isNum(C.cpa) && C.cpa > accountCpa * 1.3);
      if (!judgedByPurchases && purchaseBased(rec, texts)) { action = 'WATCH'; guardrail = 'objective_mismatch'; }
      else if (!bad) { action = 'WATCH'; guardrail = 'stop_blocked'; }
      // A tracking outage looks exactly like a failing entity; never stop spend on it.
      else if (entity.tracking_suspect === true || facts.account?.tracking_suspect === true) { action = 'WATCH'; guardrail = 'tracking_suspect'; }
    }
    if (action === 'SCALE' && !judgedByPurchases && purchaseBased(rec, texts)) { action = 'WATCH'; guardrail = 'objective_mismatch'; }
    if (action === 'SCALE') {
      const cpaOk = hasTarget('cpa') && isNum(entity.C?.cpa) && entity.C.cpa <= 0.9 * facts.targets.cpa;
      const roasOk = hasTarget('roas') && isNum(entity.C?.roas) && entity.C.roas >= 1.1 * facts.targets.roas;
      if (!cpaOk && !roasOk) { action = 'WATCH'; guardrail = 'scale_blocked'; }
    }
    if (!guardrail && (action === 'SCALE' || action === 'CONTINUE') && !passesGates(entity.C, facts.gates, group)) { action = 'WATCH'; guardrail = 'sample_gate'; }

    seen.add(key);
    recommendations.push({
      entity_type: rec.entity_type, entity_id: rec.entity_id, entity_name: entity.name ?? '', objective_group: group,
      action, confidence: rec.confidence, rationale: clean(rec.rationale), evidence: rec.evidence.map(clean),
      cited_metrics: rec.cited_metrics.map(({ path, value }) => ({ path, value })),
      review_after_days: rec.review_after_days, review_after: shift(D, rec.review_after_days),
      ...(guardrail ? { guardrail, original_action: rec.action } : {}),
    });
  }

  const summary = isText(output.summary, LIMITS.SUMMARY_CHARS) && output.summary.trim() && !LINK.test(output.summary) && textIsGrounded(output.summary, globalContext) ? clean(output.summary) : null;
  // A gap from the model is a claim: it must pass the same number check as the summary and may not assert a missing integration.
  const extra = (Array.isArray(output.data_gaps) ? output.data_gaps : [])
    .filter(g => isText(g, LIMITS.GAP_CHARS) && g.trim() && !LINK.test(g) && textIsGrounded(g, globalContext) && (!INTEGRATION_CLAIM.test(g) || integrationFlagged(facts, g)))
    .map(clean).slice(0, LIMITS.MAX_GAPS);
  return { summary, recommendations, rejected, data_gaps: [...new Set([...gaps, ...extra])] };
}
