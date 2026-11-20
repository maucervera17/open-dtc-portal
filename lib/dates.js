import { activeProfile } from './locale.js';
export const dayMs = 86400000;
export const shift = (date, days) => new Date(Date.parse(date + 'T00:00:00Z') + days * dayMs).toISOString().slice(0, 10);
export function windowFor(today, anchor) {
  for (const value of [today, anchor]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || shift(value, 0) !== value) throw new Error('Invalid report date');
  }
  const elapsed = Math.floor((Date.parse(today) - Date.parse(anchor)) / dayMs);
  if (elapsed < 0 || elapsed % 3 !== 0) return null;
  return { since: shift(today, -3), until: shift(today, -1), previousSince: shift(today, -6), previousUntil: shift(today, -4) };
}
// Calendar day (YYYY-MM-DD) of an instant in a time zone. Defaults to the resolved account time zone. It goes through Intl, so
// daylight-saving changes (23 and 25 hour days) and half-hour zones are handled by the platform's tz database, and all
// date arithmetic afterwards is on plain calendar dates (shift), never on 24 hour blocks.
const dayFormats = new Map();
export function localDate(now = new Date(), timeZone = activeProfile().timezone) {
  if (!dayFormats.has(timeZone)) dayFormats.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  return dayFormats.get(timeZone).format(now);
}

// First instant (ms since epoch) at which the calendar day `date` has begun in `timeZone`. Found by bisection over the same
// Intl day lookup as localDate, so a 23 or 25 hour day, a half-hour zone or a midnight that does not exist (a daylight-saving
// jump at 00:00 moves it to the first valid instant of that day) all come out right, with no fixed offsets.
export function dayStartMs(date, timeZone = activeProfile().timezone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || shift(date, 0) !== date) throw new Error('Invalid date');
  const base = Date.parse(`${date}T00:00:00Z`);
  const began = ms => localDate(new Date(ms), timeZone) >= date;
  let lo = base - 36 * 3600000, hi = base + 36 * 3600000; // every zone's midnight lies within +-14h of UTC midnight
  while (hi - lo > 1000) {
    const mid = Math.floor((lo + hi) / 2000) * 1000;
    if (began(mid)) hi = mid; else lo = mid;
  }
  return hi;
}
