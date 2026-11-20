import { timingSafeEqual } from 'node:crypto';
export function authorized(header, secret) {
  if (typeof secret !== 'string' || !secret || typeof header !== 'string') return false;
  const actual = Buffer.from(header), expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
