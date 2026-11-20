import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ConfigError, envOverrides, accountValues, buildProfile, formatMoney, formatMoneyWithCode, minorDigits, minorDivisor, spendUnit, minSpendFor,
  setActiveProfile, resetActiveProfile, activeProfile, recordAccountProfile, readStoredProfile, describeChange,
} from '../lib/locale.js';
import { money } from '../lib/model.js';
import { resolveProfile, publicProfile } from '../lib/account-profile.js';
import { plainText } from '../lib/agent/plain.js';
import { evaluate } from '../lib/dash/fatigue.js';
import * as client from '../public/app/format.js';

beforeEach(() => resetActiveProfile());

// In-memory stand-in for the Redis REST function (GET, SET, MGET only).
const memoryStore = () => {
  const data = new Map();
  const store = async ([cmd, ...args]) => {
    if (cmd === 'GET') return data.get(args[0]) ?? null;
    if (cmd === 'MGET') return args.map(k => data.get(k) ?? null);
    if (cmd === 'SET') { data.set(args[0], args[1]); return 'OK'; }
    throw new Error(`unsupported ${cmd}`);
  };
  store.data = data;
  return store;
};
const digits = text => text.replace(/[^\d.,]/g, '');

test('server money uses the account currency and its own minor units (MXN, USD, EUR, JPY)', () => {
  assert.equal(formatMoney(1234.5, { currency: 'MXN' }), '$1,234.50');
  assert.match(formatMoney(1234.5, { currency: 'USD' }), /^USD\s1,234\.50$/);
  assert.match(formatMoney(1234.5, { currency: 'EUR' }), /^(EUR\s1,234\.50|€1,234\.50)$/);
  // JPY has no minor unit: no decimals, and the rounding is to whole yen.
  assert.equal(digits(formatMoney(1234.5, { currency: 'JPY' })), '1,235');
  assert.equal(minorDigits('JPY'), 0);
  assert.equal(minorDigits('USD'), 2);
  assert.equal(minorDigits('KWD'), 3);
  assert.equal(minorDivisor('JPY'), 1);
  assert.equal(minorDivisor('EUR'), 100);
});

test('lib/model money follows the active profile, never a fixed currency', () => {
  setActiveProfile({ currency: 'EUR', timezone: 'Europe/Madrid', source: {} });
  assert.match(money(10), /EUR|€/);
  setActiveProfile({ currency: 'JPY', timezone: 'Asia/Tokyo', source: {} });
  assert.equal(digits(money(1500)), '1,500');
  assert.equal(money(null), 'N/D');
  assert.match(money(5, 'USD'), /USD/); // explicit currency wins
});

test('a symbol the PDF font cannot draw falls back to the ISO code, so an amount never loses its unit', () => {
  const inr = formatMoney(1234.5, { currency: 'INR' });
  assert.match(inr, /^[\u0000-ÿ€]*$/);
  assert.match(inr, /INR/);
  const krw = formatMoney(5000, { currency: 'KRW' });
  assert.match(krw, /KRW/);
});

test('analyst text amounts carry symbol and code and stay idempotent', () => {
  assert.equal(formatMoneyWithCode(694, { currency: 'USD' }), '$694 USD');
  assert.equal(formatMoneyWithCode(45.6, { currency: 'USD' }), '$45.60 USD');
  assert.equal(formatMoneyWithCode(694, { currency: 'JPY' }), '¥694 JPY');
  for (const currency of ['USD', 'EUR', 'JPY', 'MXN']) {
    const once = plainText(`Gasto: 1,500 ${currency} frente a ${currency} 45.6`, null, currency);
    assert.ok(once.includes(`1,500`) && once.includes(currency));
    assert.equal(plainText(once, null, currency), once);
  }
  // Another currency's code is left alone.
  assert.equal(plainText('Gasto: 1500 EUR', null, 'USD'), 'Gasto: 1500 EUR');
});

test('client formatters follow configureLocale: currency, decimals, minor units and days', () => {
  client.configureLocale({ currency: 'MXN', timezone: 'America/Mexico_City' });
  assert.equal(client.money(1234.5), '$1,234.50');
  assert.equal(client.money(1234.5, { compact: true }), '$1,235');
  client.configureLocale({ currency: 'USD', timezone: 'America/New_York' });
  assert.match(client.money(1234.5), /^USD\s1,234\.50$/);
  client.configureLocale({ currency: 'EUR', timezone: 'Europe/Madrid' });
  assert.match(client.money(1234.5), /1,234\.50/);
  client.configureLocale({ currency: 'JPY', timezone: 'Asia/Tokyo' });
  assert.equal(digits(client.money(1234.5)), '1,235');
  assert.equal(digits(client.moneyAxis(1234)), '1,234');
  assert.equal(client.fromMinorUnits('30000'), 30000); // yen budgets arrive in whole yen
  client.configureLocale({ currency: 'USD', timezone: 'America/New_York' });
  assert.equal(client.fromMinorUnits('30000'), 300); // dollar budgets arrive in cents
  assert.equal(client.money(null), 'N/D');
  // An invalid profile is ignored and the previous one stays.
  client.configureLocale({ currency: 'XX', timezone: 'Nope/Nope' });
  assert.equal(client.getLocale().currency, 'USD');
  client.configureLocale({ currency: 'USD', timezone: 'UTC' });
});

test('client days follow the account time zone', () => {
  const instant = new Date('2026-03-09T03:30:00Z');
  client.configureLocale({ currency: 'USD', timezone: 'America/New_York' });
  assert.equal(client.localToday(instant), '2026-03-08');
  client.configureLocale({ currency: 'USD', timezone: 'Asia/Tokyo' });
  assert.equal(client.localToday(instant), '2026-03-09');
  assert.equal(client.rangeFor(7, '2026-03-09').to, '2026-03-08');
  client.configureLocale({ currency: 'USD', timezone: 'UTC' });
});

test('REPORT_CURRENCY and REPORT_TIMEZONE are validated with Intl', () => {
  assert.deepEqual(envOverrides({}), {});
  assert.deepEqual(envOverrides({ REPORT_CURRENCY: '', REPORT_TIMEZONE: '  ' }), {});
  assert.deepEqual(envOverrides({ REPORT_CURRENCY: 'eur', REPORT_TIMEZONE: 'Europe/Madrid' }), { currency: 'EUR', timezone: 'Europe/Madrid' });
  assert.throws(() => envOverrides({ REPORT_CURRENCY: 'DOLLARS' }), error => error instanceof ConfigError && /REPORT_CURRENCY/.test(error.message));
  assert.throws(() => envOverrides({ REPORT_CURRENCY: 'ZZ1' }), ConfigError);
  assert.throws(() => envOverrides({ REPORT_TIMEZONE: 'Mars/Olympus' }), error => error instanceof ConfigError && /REPORT_TIMEZONE/.test(error.message));
});

test('account values are validated, and overrides win with their source recorded', () => {
  assert.deepEqual(accountValues({ currency: 'jpy', timezone_name: 'Asia/Tokyo' }), { currency: 'JPY', timezone: 'Asia/Tokyo' });
  assert.equal(accountValues({ currency: 'JPY' }), null);
  assert.equal(accountValues({ currency: 'JPY', timezone_name: 'Nope/Zone' }), null);
  const account = { currency: 'JPY', timezone: 'Asia/Tokyo' };
  assert.deepEqual(buildProfile(account), { currency: 'JPY', timezone: 'Asia/Tokyo', source: { currency: 'account', timezone: 'account' } });
  assert.deepEqual(buildProfile(account, { timezone: 'UTC' }), { currency: 'JPY', timezone: 'UTC', source: { currency: 'account', timezone: 'env' } });
  assert.equal(buildProfile(null, {}), null);
});

test('a changed account currency or time zone is recorded as a warning, an unchanged one is not', async () => {
  const store = memoryStore();
  const now = () => Date.parse('2026-11-19T12:00:00Z');
  const first = await recordAccountProfile({ store, accountId: '1', account: { currency: 'USD', timezone: 'America/New_York' }, now });
  assert.equal(first.changed, false);
  const same = await recordAccountProfile({ store, accountId: '1', account: { currency: 'USD', timezone: 'America/New_York' }, now });
  assert.equal(same.changed, false);
  const moved = await recordAccountProfile({ store, accountId: '1', account: { currency: 'EUR', timezone: 'America/New_York' }, now });
  assert.equal(moved.changed, true);
  assert.deepEqual(moved.change.from, { currency: 'USD', timezone: 'America/New_York' });
  assert.deepEqual(moved.change.to, { currency: 'EUR', timezone: 'America/New_York' });
  assert.match(describeChange(moved.change), /currency USD -> EUR/);
  const read = await readStoredProfile(store, '1');
  assert.deepEqual(read.stored, { currency: 'EUR', timezone: 'America/New_York' });
  assert.deepEqual(read.change.to.currency, 'EUR');
  // The warning survives the next unchanged read.
  assert.equal((await recordAccountProfile({ store, accountId: '1', account: { currency: 'EUR', timezone: 'America/New_York' }, now })).change.to.currency, 'EUR');
});

test('resolveProfile: account from Meta, remembered in Redis, overridden by env, never fatal when Meta is down', async () => {
  const env = { META_AD_ACCOUNT_ID: '99', META_ACCESS_TOKEN: 't', META_API_VERSION: 'v25.0' };
  const calls = [];
  const fetchFor = body => async url => { calls.push(String(url)); return new Response(JSON.stringify(body), { status: 200 }); };
  const store = memoryStore();
  const meta = fetchFor({ id: 'act_99', currency: 'GBP', timezone_name: 'Europe/London' });

  const first = await resolveProfile({ env, store, fetch: meta });
  assert.equal(first.resolved, true);
  assert.deepEqual([first.profile.currency, first.profile.timezone], ['GBP', 'Europe/London']);
  assert.equal(activeProfile().currency, 'GBP');
  assert.equal(calls.length, 1);

  // Second time it comes from Redis: no Graph call.
  await resolveProfile({ env, store, fetch: meta });
  assert.equal(calls.length, 1);

  // Not allowed to fetch and nothing stored: fallback, flagged unresolved (a fresh process, nothing resolved yet).
  resetActiveProfile();
  const empty = await resolveProfile({ env, store: memoryStore(), fetch: meta, allowFetch: false });
  assert.equal(empty.resolved, false);
  assert.equal(empty.profile.currency, 'USD');

  // Env overrides win (and one override alone still takes the other value from the account).
  const overridden = await resolveProfile({ env: { ...env, REPORT_TIMEZONE: 'Asia/Tokyo' }, store, fetch: meta });
  assert.deepEqual([overridden.profile.currency, overridden.profile.timezone], ['GBP', 'Asia/Tokyo']);
  assert.deepEqual(overridden.profile.source, { currency: 'account', timezone: 'env' });

  // Meta down in a fresh process: the portal keeps working on the fallback.
  resetActiveProfile();
  const down = await resolveProfile({ env, store: memoryStore(), fetch: async () => { throw new Error('offline'); } });
  assert.equal(down.resolved, false);

  // A bad override is a clear configuration error.
  await assert.rejects(() => resolveProfile({ env: { ...env, REPORT_CURRENCY: 'nope!' }, store, fetch: meta }), ConfigError);

  const shaped = publicProfile(first);
  assert.deepEqual([shaped.currency, shaped.timezone, shaped.warning], ['GBP', 'Europe/London', null]);
  assert.ok(shaped.spend_unit > 0);
});

test('money thresholds scale with the currency and can be set exactly', () => {
  assert.equal(minSpendFor({}, 'USD'), 15);
  assert.equal(minSpendFor({}, 'MXN'), 300); // the original gate, now only the peso-sized default
  assert.equal(minSpendFor({}, 'JPY'), 2250);
  assert.equal(minSpendFor({ MIN_SPEND: '40' }, 'JPY'), 40);
  assert.equal(minSpendFor({ MIN_SPEND: 'abc' }, 'USD'), 15);
  assert.equal(spendUnit('USD'), 10);
  const window = { impressions: 5000, purchases: 5, ctr: 0.02, cpa: 10, frequency: 2 };
  // 20 of spend is plenty for a dollar account and nothing for a yen account.
  assert.equal(evaluate({ ...window, spend: 20 }, { ...window, spend: 20 }, minSpendFor({}, 'USD')).gates.C, true);
  assert.equal(evaluate({ ...window, spend: 20 }, { ...window, spend: 20 }, minSpendFor({}, 'JPY')).gates.C, false);
});
