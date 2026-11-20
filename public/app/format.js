// Spanish (es-MX) formatters. Currency and time zone are not fixed: the API tells the client (GET /me -> profile) and
// configureLocale() rebuilds the formatters. Anything that is not a finite number renders "N/D", never 0.
export const ND = 'N/D';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const LOCALE = 'es-MX';
const nf = (options) => new Intl.NumberFormat(LOCALE, options);

// Until the API has answered (login screen) amounts use USD and days use UTC. configureLocale() replaces them.
let profile = { currency: 'USD', timezone: 'UTC', spendUnit: 10 };
let money0, money2, day, clock, hour, stamp, minor;
export function configureLocale(next) {
  const currency = String(next?.currency ?? '').toUpperCase();
  const timezone = next?.timezone;
  try { new Intl.NumberFormat(LOCALE, { style: 'currency', currency }); new Intl.DateTimeFormat(LOCALE, { timeZone: timezone }); } catch { return profile; }
  // spend_unit: about USD 10 in the account currency, the scale of the spend thresholds in the analytics views.
  const unit = Number(next?.spend_unit);
  profile = { currency, timezone, spendUnit: Number.isFinite(unit) && unit > 0 ? unit : profile.spendUnit };
  // The currency decides the decimals: two for most, none for JPY or CLP. Cents are dropped from 1000 up (money0) only.
  money2 = nf({ style: 'currency', currency });
  money0 = nf({ style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0 });
  minor = 10 ** money2.resolvedOptions().maximumFractionDigits;
  day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  clock = new Intl.DateTimeFormat(LOCALE, { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
  hour = new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', hourCycle: 'h23' });
  stamp = new Intl.DateTimeFormat(LOCALE, { timeZone: timezone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  return profile;
}
configureLocale(profile);
export const getLocale = () => ({ ...profile, locale: LOCALE });
// Amounts the Meta API reports in the currency's minor unit (budgets in cents) -> whole currency units.
export const fromMinorUnits = v => Number(v) / minor;
// Calendar day (YYYY-MM-DD) and clock helpers in the account's time zone.
export const timeZone = () => profile.timezone;
export const dayIn = (value = new Date()) => day.format(value);
export const dateIn = (value, options = {}) => new Date(value).toLocaleDateString(LOCALE, { timeZone: profile.timezone, ...options });
export const dateTimeIn = (value, options = {}) => new Date(value).toLocaleString(LOCALE, { timeZone: profile.timezone, ...options });
export const moneyWith = (v, options = {}) => (isNum(v) ? new Intl.NumberFormat(LOCALE, { style: 'currency', currency: profile.currency, ...options }).format(v) : ND);

const int0 = nf({ maximumFractionDigits: 0 });
const dec2 = nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct1 = nf({ style: 'percent', minimumFractionDigits: 0, maximumFractionDigits: 1 });
const date = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });

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

export const localToday = (now = new Date()) => day.format(now);
export const shiftDate = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Period ending yesterday (account time zone), `days` long. Yesterday is still provisional; the UI marks it.
export function rangeFor(days, today = localToday()) {
  const to = shiftDate(today, -1);
  return { from: shiftDate(to, -(days - 1)), to };
}

// Greeting by the hour in the account's time zone: before noon, until 19:00, then night.
export function greeting(now = new Date()) {
  const h = Number(hour.format(now));
  if (h >= 6 && h < 12) return 'Buenos días.';
  if (h >= 12 && h < 19) return 'Buenas tardes.';
  return 'Buenas noches.';
}

export function timeOf(iso) {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? ND : clock.format(parsed);
}

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
