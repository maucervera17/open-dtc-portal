// Currency and time zone of the portal. The source of truth is the Meta ad account itself (`currency` and `timezone_name`).
// REPORT_CURRENCY and REPORT_TIMEZONE are optional overrides. Nothing here talks to the network: the Graph fetch lives in
// account-profile.js, and storage is an injected `store(command)` function.
//
// One deployment serves one ad account, so the resolved profile is kept per process (setActiveProfile). Request handlers set it
// after resolving; formatters and date helpers read it when they are not given an explicit currency or time zone.

export const LOCALE = 'es-MX';

// `variable` names the offending env var. It is for server logs only: HTTP bodies never carry it.
export class ConfigError extends Error {
  constructor(message, variable = null) { super(message); this.name = 'ConfigError'; this.variable = variable; }
}

// Used only until the account has been read (no Redis value yet, Meta not configured). Never persisted.
export const FALLBACK_PROFILE = Object.freeze({ currency: 'USD', timezone: 'UTC', source: Object.freeze({ currency: 'default', timezone: 'default' }) });

export const isCurrency = value => {
  if (typeof value !== 'string' || !/^[A-Za-z]{3}$/.test(value)) return false;
  try { new Intl.NumberFormat(LOCALE, { style: 'currency', currency: value }); return true; } catch { return false; }
};
export const isTimezone = value => {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }); return true; } catch { return false; }
};
const canonicalTimezone = value => new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;

const blank = value => typeof value !== 'string' || value.trim() === '';

// Validated overrides from the environment. Unset or empty means "use the account". An invalid value is a configuration error.
export function envOverrides(env = {}) {
  const out = {};
  if (!blank(env.REPORT_CURRENCY)) {
    const code = env.REPORT_CURRENCY.trim().toUpperCase();
    if (!isCurrency(code)) throw new ConfigError('REPORT_CURRENCY must be a valid ISO 4217 currency code (for example USD, EUR, JPY)', 'REPORT_CURRENCY');
    out.currency = code;
  }
  if (!blank(env.REPORT_TIMEZONE)) {
    const zone = env.REPORT_TIMEZONE.trim();
    if (!isTimezone(zone)) throw new ConfigError('REPORT_TIMEZONE must be a valid IANA time zone name (for example America/New_York)', 'REPORT_TIMEZONE');
    out.timezone = canonicalTimezone(zone);
  }
  return out;
}

// What the Meta ad account reports about itself, validated. Returns null when Meta sent something unusable.
export function accountValues(info) {
  const currency = typeof info?.currency === 'string' ? info.currency.trim().toUpperCase() : '';
  const timezone = typeof info?.timezone_name === 'string' ? info.timezone_name.trim() : '';
  if (!isCurrency(currency) || !isTimezone(timezone)) return null;
  return { currency, timezone: canonicalTimezone(timezone) };
}

// The effective profile: overrides win over the account values, and `source` says which one each value came from.
export function buildProfile(account, overrides = {}) {
  const currency = overrides.currency || account?.currency;
  const timezone = overrides.timezone || account?.timezone;
  if (!currency || !timezone) return null;
  return { currency, timezone, source: { currency: overrides.currency ? 'env' : 'account', timezone: overrides.timezone ? 'env' : 'account' } };
}

// Why a process-wide value and not one passed per request: money(), localDate() and the report/PDF/prompt builders are called from
// dozens of places (including format callbacks stored in tables) that have no request object, so threading a profile through them
// would touch every signature. It is safe because one deployment serves one ad account: concurrent requests in an instance all
// resolve the same values. The one hazard is a request that could NOT resolve the account (Meta or Redis down) overwriting a
// profile another request already resolved, so setActiveProfile refuses to replace a resolved profile with an unresolved fallback.
const isPartial = source => source?.currency === 'default' || source?.timezone === 'default';
let active = FALLBACK_PROFILE;
export const activeProfile = () => active;
export const isResolvedProfile = profile => Boolean(profile) && !isPartial(profile.source);
export function setActiveProfile(profile) {
  const next = profile && isCurrency(profile.currency) && isTimezone(profile.timezone) ? profile : FALLBACK_PROFILE;
  if (isPartial(next.source) && isResolvedProfile(active)) return active;
  active = next;
  return active;
}
export const resetActiveProfile = () => { active = FALLBACK_PROFILE; };

// ---- Money --------------------------------------------------------------------------------------------------------------

const cache = new Map();
const formatter = (currency, options) => {
  const id = `${currency}|${JSON.stringify(options)}`;
  if (!cache.has(id)) cache.set(id, new Intl.NumberFormat(LOCALE, { style: 'currency', currency, ...options }));
  return cache.get(id);
};

// Digits after the decimal point that the currency uses (USD 2, JPY 0, KWD 3).
export const minorDigits = currency => formatter(currency, {}).resolvedOptions().maximumFractionDigits;
// Meta sends budgets in the currency's minor unit (cents). This is the factor to get back to whole currency units.
export const minorDivisor = currency => 10 ** minorDigits(currency);

// PDFs use a standard font (WinAnsi), which has no glyph for symbols such as the rupee or the won sign. When the symbol would be
// lost, the ISO code is used instead, so an amount never loses its unit.
const WINANSI_SAFE = /^[\u0000-ÿ€]*$/;
export function formatMoney(value, { currency = active.currency, whole = false } = {}) {
  const options = whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {};
  const text = formatter(currency, options).format(value);
  return WINANSI_SAFE.test(text) ? text : formatter(currency, { ...options, currencyDisplay: 'code' }).format(value);
}

// "$694 USD" style: narrow symbol plus the ISO code, used by the analyst text so an amount always carries its currency.
export function formatMoneyWithCode(value, { currency = active.currency } = {}) {
  const whole = Math.abs(value) >= 100;
  const text = formatter(currency, { currencyDisplay: 'narrowSymbol', ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) }).format(value);
  return text.includes(currency) ? text : `${text} ${currency}`;
}

// ---- Money-sized thresholds -----------------------------------------------------------------------------------------------
// A rough size of USD 10 in other currencies, used ONLY to scale default spend gates to the account's currency (a gate of
// 300 means very different things in USD and in a peso-sized currency). Order of magnitude is all that matters; every gate that uses it can be
// set exactly through MIN_SPEND. Currencies missing from the table are treated as USD-sized.
const PER_USD = Object.freeze({
  USD: 1, EUR: 0.92, GBP: 0.78, CAD: 1.37, AUD: 1.5, NZD: 1.65, CHF: 0.88, SEK: 10.5, NOK: 10.5, DKK: 6.9, PLN: 4, CZK: 23, HUF: 360, RON: 4.6,
  MXN: 20, BRL: 5.3, ARS: 1000, CLP: 950, COP: 4100, PEN: 3.7, UYU: 40, BOB: 6.9, PYG: 7300, CRC: 520, DOP: 59, GTQ: 7.8, HNL: 25, NIO: 36, PAB: 1,
  JPY: 150, KRW: 1350, CNY: 7.2, HKD: 7.8, TWD: 32, SGD: 1.35, MYR: 4.7, THB: 35, IDR: 15800, PHP: 57, VND: 25000, INR: 83, PKR: 280, BDT: 110,
  AED: 3.67, SAR: 3.75, ILS: 3.7, TRY: 32, EGP: 48, ZAR: 18.5, NGN: 1500, KES: 130, MAD: 10,
});
// USD 10 expressed in the account currency.
export const spendUnit = currency => 10 * (PER_USD[currency] ?? 1);
const positive = raw => { const n = Number(raw); return raw !== undefined && raw !== null && String(raw).trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };
// Minimum spend, per window, before an ad can be judged. MIN_SPEND (account currency) wins; otherwise 1.5 x spendUnit
// (USD 15, JPY 2,250, 300 in a peso-sized currency).
export const minSpendFor = (env = {}, currency = active.currency) => positive(env.MIN_SPEND) ?? Math.round(1.5 * spendUnit(currency));

// ---- Stored account profile (change detection) -------------------------------------------------------------------------------
const PREFIX = 'dtc:dash:';
const FRESH_TTL = 3600; // how long the stored profile is trusted before the account is read again
const CHANGE_TTL = 34560000; // 400 days, like the snapshots that carry the old unit
export const profileKey = accountId => `${PREFIX}profile:${accountId}`;
export const changeKey = accountId => `${PREFIX}profile-change:${accountId}`;
export const freshKey = accountId => `${PREFIX}profile-fresh:${accountId}`;
const parse = text => { try { const v = text ? JSON.parse(text) : null; return v && typeof v === 'object' ? v : null; } catch { return null; } };

export async function readStoredProfile(store, accountId) {
  if (!store) return { stored: null, change: null };
  const rows = await store(['MGET', profileKey(accountId), changeKey(accountId), freshKey(accountId)]);
  const stored = parse(rows?.[0]), change = parse(rows?.[1]);
  return { stored: accountValues({ currency: stored?.currency, timezone_name: stored?.timezone }), change: change?.from && change?.to ? change : null, fresh: rows?.[2] != null };
}

// Remembers what the account reported. When it differs from what was stored, writes a change warning (kept as long as the
// snapshots that mix the two units) and returns it. `account` is the validated {currency, timezone} the account reported.
export async function recordAccountProfile({ store, accountId, account, now = Date.now }) {
  if (!store) return { changed: false, change: null };
  const { stored, change } = await readStoredProfile(store, accountId);
  // Every account read refreshes the stamp that tells resolveProfile the stored values were checked recently.
  await store(['SET', freshKey(accountId), '1', 'EX', FRESH_TTL]);
  if (stored && stored.currency === account.currency && stored.timezone === account.timezone) return { changed: false, change };
  await store(['SET', profileKey(accountId), JSON.stringify(account)]);
  if (!stored) return { changed: false, change };
  const doc = { from: stored, to: account, at: new Date(Number(now())).toISOString() };
  await store(['SET', changeKey(accountId), JSON.stringify(doc), 'EX', CHANGE_TTL]);
  return { changed: true, change: doc };
}

export const describeChange = change => {
  if (!change?.from || !change?.to) return null;
  const parts = [];
  if (change.from.currency !== change.to.currency) parts.push(`currency ${change.from.currency} -> ${change.to.currency}`);
  if (change.from.timezone !== change.to.timezone) parts.push(`time zone ${change.from.timezone} -> ${change.to.timezone}`);
  return parts.length ? `The ad account changed (${parts.join(', ')}). Stored snapshots and history before ${String(change.at).slice(0, 10)} use the previous unit; do not compare them directly.` : null;
};
