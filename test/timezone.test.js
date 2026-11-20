import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { localDate, dayStartMs, shift } from '../lib/dates.js';
import { scheduledWindow } from '../lib/schedule.js';
import { today } from '../lib/dash/range.js';
import { insightBounds } from '../lib/instagram.js';
import { setActiveProfile, resetActiveProfile } from '../lib/locale.js';
import { createCron } from '../api/cron.js';

beforeEach(() => resetActiveProfile());
const HOUR = 3600000;
const at = iso => new Date(iso);
const use = timezone => setActiveProfile({ currency: 'USD', timezone, source: { currency: 'account', timezone: 'account' } });

test('the calendar day depends on the time zone, not on Mexico City or UTC', () => {
  const instant = at('2026-06-01T03:30:00Z');
  assert.equal(localDate(instant, 'UTC'), '2026-06-01');
  assert.equal(localDate(instant, 'America/New_York'), '2026-05-31');
  assert.equal(localDate(instant, 'Asia/Tokyo'), '2026-06-01');
  assert.equal(localDate(instant, 'Asia/Kolkata'), '2026-06-01'); // +05:30
  assert.equal(localDate(at('2026-06-01T18:29:59Z'), 'Asia/Kolkata'), '2026-06-01');
  assert.equal(localDate(at('2026-06-01T18:30:00Z'), 'Asia/Kolkata'), '2026-06-02');
});

test('US spring forward: the day of the jump is 23 hours long and the day boundary follows the real offset', () => {
  // America/New_York: 2026-03-08 02:00 EST -> 03:00 EDT.
  const tz = 'America/New_York';
  assert.equal(localDate(at('2026-03-08T04:59:59Z'), tz), '2026-03-07'); // 23:59:59 EST
  assert.equal(localDate(at('2026-03-08T05:00:00Z'), tz), '2026-03-08'); // 00:00 EST
  assert.equal(localDate(at('2026-03-09T03:59:59Z'), tz), '2026-03-08'); // 23:59:59 EDT (a fixed -5 offset would already say 03-09 at 04:59Z, and a fixed -4 one 03-08 at 05:00Z)
  assert.equal(localDate(at('2026-03-09T04:00:00Z'), tz), '2026-03-09');
  assert.equal((dayStartMs('2026-03-09', tz) - dayStartMs('2026-03-08', tz)) / HOUR, 23);
  assert.equal((dayStartMs('2026-03-08', tz) - dayStartMs('2026-03-07', tz)) / HOUR, 24);
});

test('US fall back: the day of the jump is 25 hours long', () => {
  const tz = 'America/New_York'; // 2026-11-01 02:00 EDT -> 01:00 EST
  assert.equal(localDate(at('2026-11-01T03:59:59Z'), tz), '2026-10-31'); // 23:59:59 EDT
  assert.equal(localDate(at('2026-11-01T04:00:00Z'), tz), '2026-11-01'); // 00:00 EDT
  assert.equal(localDate(at('2026-11-02T04:59:59Z'), tz), '2026-11-01'); // 23:59:59 EST
  assert.equal(localDate(at('2026-11-02T05:00:00Z'), tz), '2026-11-02');
  assert.equal((dayStartMs('2026-11-02', tz) - dayStartMs('2026-11-01', tz)) / HOUR, 25);
});

test('southern hemisphere and half-hour zones are handled by the same lookup', () => {
  // Australia/Sydney springs forward on 2026-10-04 (UTC+10 -> UTC+11).
  assert.equal((dayStartMs('2026-10-05', 'Australia/Sydney') - dayStartMs('2026-10-04', 'Australia/Sydney')) / HOUR, 23);
  assert.equal(dayStartMs('2026-06-01', 'Asia/Kolkata'), Date.UTC(2026, 4, 31, 18, 30));
  assert.equal(dayStartMs('2026-06-01', 'UTC'), Date.UTC(2026, 5, 1));
});

test('a midnight that does not exist (DST jump at 00:00) starts the day at the first valid instant', () => {
  const tz = 'America/Havana';
  const start = dayStartMs('2026-03-08', tz);
  assert.equal(localDate(new Date(start), tz), '2026-03-08');
  assert.equal(localDate(new Date(start - 1000), tz), '2026-03-07');
});

test('"today" for the dashboard and the snapshot job is the account day, across the DST change', () => {
  const justAfterUtcMidnight = Date.parse('2026-03-09T03:30:00Z');
  use('America/New_York');
  assert.equal(today(justAfterUtcMidnight), '2026-03-08');
  use('UTC');
  assert.equal(today(justAfterUtcMidnight), '2026-03-09');
  use('Pacific/Auckland');
  assert.equal(today(justAfterUtcMidnight), '2026-03-09');
});

test('report windows use plain calendar dates, so DST never shifts or shortens them', () => {
  // Three days that contain the US spring-forward day are still exactly 3 calendar days.
  const delivery = '2026-03-09';
  const window = scheduledWindow('2026-03-03', null, delivery, 3);
  assert.deepEqual(window.window, { since: '2026-03-06', until: '2026-03-08', previousSince: '2026-03-03', previousUntil: '2026-03-05' });
  assert.equal(shift('2026-03-08', 1), '2026-03-09');
  assert.equal(shift('2026-11-01', 1), '2026-11-02');
  assert.equal(shift('2026-11-01', -1), '2026-10-31');
});

test('the due delivery follows the account time zone (US fall-back evening)', () => {
  // 2026-11-02 04:30 UTC is still Nov 1 in New York (23:30 EST). A fixed EDT offset (-4) would already call it Nov 2.
  const instant = Date.parse('2026-11-02T04:30:00Z');
  const first = '2026-10-30'; // deliveries every 3 days: 10-30, 11-02, 11-05
  const dueIn = timezone => scheduledWindow(first, null, localDate(new Date(instant), timezone), 3).delivery;
  assert.equal(dueIn('America/New_York'), '2026-10-30');
  assert.equal(dueIn('UTC'), '2026-11-02');
  assert.equal(dueIn('Asia/Tokyo'), '2026-11-02');
});

test('the report cron decides "today" in the account time zone (REPORT_TIMEZONE here)', async () => {
  const run = async timezone => {
    const sent = [];
    const store = async ([cmd, ...args]) => (cmd === 'GET' ? null : cmd === 'MGET' ? args.map(() => null) : 'OK');
    const handler = createCron({
      env: { AUTOMATION_ENABLED: 'true', CRON_SECRET: 'c', REPORT_SECRET: 'r', REPORT_START_DATE: '2026-10-30', UPSTASH_REDIS_REST_URL: 'x', UPSTASH_REDIS_REST_TOKEN: 'x', REPORT_TIMEZONE: timezone, REPORT_CURRENCY: 'USD' },
      store, now: () => Date.parse('2026-11-02T04:30:00Z'),
      runReport: async (req, res) => { sent.push(req.body); res.status(200).json({ status: 'accepted_by_email_provider' }); },
    });
    const out = { code: 0, body: null };
    const res = { setHeader() {}, status(code) { out.code = code; return res; }, json(body) { out.body = body; return res; } };
    await handler({ method: 'GET', headers: { authorization: 'Bearer c' } }, res);
    return { out, sent };
  };
  const ny = await run('America/New_York');
  assert.equal(ny.out.body.delivery, '2026-10-30');
  assert.deepEqual([ny.sent[0].since, ny.sent[0].until], ['2026-10-27', '2026-10-29']);
  const utc = await run('UTC');
  assert.equal(utc.out.body.delivery, '2026-11-02');
  assert.deepEqual([utc.sent[0].since, utc.sent[0].until], ['2026-10-30', '2026-11-01']);
});

test('Instagram insight bounds are midnight of the account time zone, with the real DST offset', () => {
  use('America/New_York');
  // Mar 8 is the 23 hour day: bounds are 05:00Z (EST midnight) to 04:00Z next day (EDT midnight).
  const spring = insightBounds('2026-03-08', '2026-03-08');
  assert.equal(Number(spring.since), Date.UTC(2026, 2, 8, 5) / 1000);
  assert.equal(Number(spring.until), Date.UTC(2026, 2, 9, 4) / 1000);
  const winter = insightBounds('2026-11-01', '2026-11-01');
  assert.equal(Number(winter.until) - Number(winter.since), 25 * 3600);
  // Another zone gives other bounds from the same call.
  assert.equal(Number(insightBounds('2026-06-01', '2026-06-01', 'Asia/Tokyo').since), Date.UTC(2026, 4, 31, 15) / 1000);
});
