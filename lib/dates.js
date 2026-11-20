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
export const localDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
