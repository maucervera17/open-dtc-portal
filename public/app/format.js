// es-MX / MXN formatters. Anything that is not a finite number renders "N/D", never 0.
export const ND = 'N/D';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const nf = (options) => new Intl.NumberFormat('es-MX', options);
const money0 = nf({ style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const money2 = nf({ style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const int0 = nf({ maximumFractionDigits: 0 });
const dec2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = nf({ style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// compact drops the cents from 1000 up (cards and charts); below that the cents stay, so $711.24 reads like Ads Manager.
export const money = (v, { compact = false } = {}) => (isNum(v) ? (compact && Math.abs(v) >= 1000 ? money0 : money2).format(v) : ND);
// Axis ticks never need cents.
export const moneyAxis = v => (isNum(v) ? money0.format(v) : ND);
// CTR on link clicks, two decimals everywhere ("3.36%"). The value is a ratio.
export const ctrText = v => (isNum(v) ? `${dec2.format(v * 100)}%` : ND);
export const int = v => (isNum(v) ? int0.format(v) : ND);
export const decimal = v => (isNum(v) ? dec2.format(v) : ND);
export const percent = v => (isNum(v) ? pct1.format(v) : ND);
// CPA needs purchases: with spend and none, say so instead of showing a missing value.
export const cpaText = m => (isNum(m?.cpa) ? money(m.cpa) : m?.purchases === 0 && isNum(m?.spend) && m.spend > 0 ? 'Sin compras' : ND);
export const roas = v => (isNum(v) ? `${dec2.format(v)}x` : ND);

// Period-over-period change. `dir` is 'up' | 'down' | 'flat' | null; the view decides whether up is good.
export function delta(current, previous) {
  if (!isNum(current) || !isNum(previous)) return { text: ND, dir: null };
  if (previous === 0) return current === 0 ? { text: pct1.format(0), dir: 'flat' } : { text: ND, dir: null };
  const ratio = (current - previous) / Math.abs(previous);
  const text = `${ratio > 0 ? '+' : ''}${pct1.format(ratio)}`;
  return { text, dir: ratio > 0.0005 ? 'up' : ratio < -0.0005 ? 'down' : 'flat' };
}

export function shortDate(iso) {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) ? new Date(`${iso}T00:00:00Z`) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? date.format(parsed).replace('.', '') : ND;
}

// "21–27 sep" inside one month, "28 sep–4 oct" across two; N/D for anything that is not a pair of dates.
export function windowRange(from, to) {
  const a = shortDate(from), b = shortDate(to);
  if (a === ND || b === ND) return ND;
  const sameMonth = String(from).slice(0, 7) === String(to).slice(0, 7);
  return sameMonth ? `${Number(String(from).slice(8, 10))}–${b}` : `${a}–${b}`;
}

const cdmxDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', hour: 'numeric', minute: '2-digit' });

export const cdmxToday = (now = new Date()) => cdmxDay.format(now);
export const shiftDate = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Period ending yesterday (CDMX), `days` long. Yesterday is still provisional; the UI marks it.
export function rangeFor(days, today = cdmxToday()) {
  const to = shiftDate(today, -1);
  return { from: shiftDate(to, -(days - 1)), to };
}

const cdmxHour = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Mexico_City', hour: 'numeric', hourCycle: 'h23' });

// Greeting by the hour in Mexico City: before noon, until 19:00, then night.
export function greeting(now = new Date()) {
  const hour = Number(cdmxHour.format(now));
  if (hour >= 6 && hour < 12) return 'Buenos días.';
  if (hour >= 12 && hour < 19) return 'Buenas tardes.';
  return 'Buenas noches.';
}

export function timeOf(iso) {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? ND : clock.format(parsed);
}

const stamp = new Intl.DateTimeFormat('es-MX', { timeZone: 'America/Mexico_City', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// Meta timestamps carry "+0000" (no colon), which some engines refuse to parse.
export function dateTime(value) {
  const parsed = new Date(String(value ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return typeof value === 'string' && !Number.isNaN(parsed.getTime()) ? stamp.format(parsed).replace('.', '') : ND;
}

const graphemes = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;

// Shortens on a character boundary (never inside a surrogate pair or emoji sequence) and adds an ellipsis only when it cut.
export function truncate(text, max) {
  const value = String(text ?? '');
  const list = graphemes ? Array.from(graphemes.segment(value), part => part.segment) : Array.from(value);
  return list.length <= max ? value : `${list.slice(0, max).join('')}\u2026`;
}

// Names from Meta (pixel, campaign, adset, ad, IG caption) can carry U+FFFD. Drops it with the space before it and collapses
// the rest of the whitespace; empty when nothing is left.
export const displayName = value => String(value ?? '').replace(/\s*\uFFFD+/g, '').replace(/\s+/g, ' ').trim();
