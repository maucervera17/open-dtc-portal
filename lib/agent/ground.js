import { shift } from '../dates.js';
import { walk, changePairs, ungroundedNumbers, NUMBER } from './validate.js';
import { rangeLabel } from './windows.js';

// Deterministic post-check of the chat answer: every figure the model writes must come from a source the code controls.
// Allowed: numbers in the facts and the latest alerts, C-vs-B changes, what the USER wrote (question and user turns only; agent
// turns never whitelist anything), the approved memory notes and, when images are attached, the lines that say "según la captura".
const MONTH = '(?:ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sep(?:t(?:iembre)?)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)';
const MONTH_NUMBER = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, oct: 10, nov: 11, dic: 12 };
const monthOf = word => MONTH_NUMBER[word.slice(0, 3).toLowerCase()];
const pad = n => String(n).padStart(2, '0');
const DAY_RANGE = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:al|a|-|–)\\s*(\\d{1,2})\\s*(?:de\\s+)?(${MONTH})\\b\\.?`, 'gi');
const DAY_MONTH = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:de\\s+)?(${MONTH})\\b\\.?`, 'gi');
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
const SLASH_DATE = /(?<!\d)(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?(?!\d)/g;
const LIST_MARKER = /^[ \t]*\d{1,2}[.)](?=\s)/gm;
const CAPTURE_LINE = /seg[uú]n la captura/i;
const days = (from, to) => { const out = []; for (let d = from; d <= to; d = shift(d, 1)) out.push(d); return out; };
const isNum = v => typeof v === 'number' && Number.isFinite(v);

export const numbersIn = text => [...String(text).matchAll(NUMBER)].map(m => Number(m[0].replace(/,/g, ''))).filter(Number.isFinite);

function stringsOf(value, visit) {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) value.forEach(v => stringsOf(v, visit));
  else if (value && typeof value === 'object') Object.values(value).forEach(v => stringsOf(v, visit));
}

const windowLength = w => (w?.from && w?.to ? days(w.from, w.to).length : 0);

// Everything the answer may cite, built once per request from the same facts the model saw.
export function groundingContext({ facts, latest_alerts = null, question = '', history = [], notes = [], imagesAttached = false }) {
  const values = [];
  walk(facts, v => values.push(v));
  walk(latest_alerts, v => values.push(v));
  // Numbers inside the model-visible text of the panel (names, alert rationales, trend flags) are panel data too.
  stringsOf([facts, latest_alerts], text => values.push(...numbersIn(text)));
  values.push(...numbersIn(question));
  for (const turn of history) if (turn?.role === 'user') values.push(...numbersIn(turn.text));
  for (const note of notes) values.push(...numbersIn(note));

  const ids = new Set();
  for (const e of [...(facts?.campaigns || []), ...(facts?.ads || [])]) for (const id of [e.id, e.campaign_id]) if (typeof id === 'string') ids.add(id);

  // Dates: the facts windows plus one window on each side.
  const { C, B } = facts?.windows || {};
  const span = windowLength(C) || 7;
  const from = B?.from || C?.from, to = C?.to;
  const allowedDates = new Set(from && to ? days(shift(from, -span), shift(to, span)) : []);
  // The live blocks have their own dates (D-2..D and D-30..D); those, and last_purchase's date, are panel data too.
  for (const w of [facts?.recent, facts?.last_30d]) if (w?.from && w?.to && w.from <= w.to) for (const d of days(w.from, w.to)) allowedDates.add(d);
  const monthDays = new Set([...allowedDates].map(d => `${Number(d.slice(5, 7))}-${Number(d.slice(8, 10))}`));
  const dayCounts = new Set([span, span * 2, ...(facts?.journal?.series?.days || []).filter(isNum)]);
  return { values, changes: changePairs(facts || {}), ids, allowedDates, monthDays, dayCounts, imagesAttached };
}

// Takes the date phrases, list markers and "N días" out of the text. A date outside the allowed window is reported as an
// offender itself (its digits could otherwise match an unrelated fact), and never read as plain numbers.
function stripDates(text, ctx, bad) {
  const ok = (month, day) => ctx.monthDays.has(`${month}-${day}`);
  const take = (all, valid) => { if (!valid) bad.push(all.trim().replace(/\.$/, '')); return ' '; };
  let out = text;
  out = out.replace(DAY_RANGE, (all, a, b, month) => take(all, ok(monthOf(month), Number(a)) && ok(monthOf(month), Number(b))));
  out = out.replace(DAY_MONTH, (all, d, month) => take(all, ok(monthOf(month), Number(d))));
  out = out.replace(ISO_DATE, all => take(all, ctx.allowedDates.has(all)));
  out = out.replace(SLASH_DATE, (all, d, m) => take(all, ok(Number(m), Number(d))));
  out = out.replace(/(?<!\d)(\d{1,3})\s*d[ií]as?\b/gi, (all, n) => (ctx.dayCounts.has(Number(n)) ? ' ' : all));
  return out.replace(LIST_MARKER, ' ');
}

// Unique tokens of the answer that no allowed source backs.
export function offendingNumbers(answer, ctx) {
  const lines = String(answer).split('\n').filter(line => !(ctx.imagesAttached && CAPTURE_LINE.test(line)));
  const bad = [];
  const rest = stripDates(lines.join('\n'), ctx, bad);
  bad.push(...ungroundedNumbers(rest, { values: ctx.values, changes: ctx.changes, ids: ctx.ids, exempt: [] }));
  return [...new Set(bad)];
}

export const UNGROUNDED_WARNING = tokens => `⚠️ Algunas cifras de esta respuesta no se encontraron en los datos del panel: ${tokens.join(', ')}. Verifícalas antes de actuar.`;
export const MAX_REPORTED = 8;

// The server states the range, never the model.
export function groundingFooter(facts) {
  const { C, B } = facts?.windows || {};
  const current = rangeLabel(C?.from, C?.to);
  if (!current) return '';
  const base = rangeLabel(B?.from, B?.to);
  if (facts?.last_30d && facts?.recent && !facts.recent.unavailable) return `Datos: últimos 30 días hasta hoy · decisiones con días cerrados del ${current}${base ? ` (comparación ${base})` : ''}. Últimos 3 días provisionales.`;
  if (facts?.recent?.unavailable) return `Datos del ${current} (cifras de Meta Ads, atribución predeterminada).${base ? ` Comparación: ${base}.` : ''} Los últimos días no están disponibles ahora.`;
  return `Datos del ${current} (cifras de Meta Ads, atribución predeterminada).${base ? ` Comparación: ${base}.` : ''}`;
}

// Instruction for the single regeneration.
export const regenerationNote = tokens => `Tu respuesta anterior incluyó cifras que no están en los datos del panel: ${tokens.join(', ')}. Vuelve a escribir la respuesta usando únicamente cifras que aparezcan en <facts> (o que haya escrito el usuario). Si no tienes un dato, dilo con "No tengo ese dato en el panel". No escribas el rango de fechas de los datos.`;
