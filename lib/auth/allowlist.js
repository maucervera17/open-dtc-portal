const SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const normalizeEmail = value => String(value).trim().toLowerCase();

// Accept a bounded explicit list of authorized users; every entry must be distinct and well-formed.
// Counting raw tokens first means a typo or a repeated entry can never be silently dropped.
export function parseAllowlist(raw) {
  const tokens = String(raw ?? '').split(',').map(normalizeEmail).filter(Boolean);
  const emails = [...new Set(tokens)];
  const valid = tokens.length >= 1 && tokens.length <= 20 && emails.length === tokens.length && tokens.every(e => SHAPE.test(e));
  return { valid, count: tokens.length, emails: valid ? emails : [] };
}

export const isAllowed = (list, email) => typeof email === 'string' && list.valid && list.emails.includes(normalizeEmail(email));

// Validate each configured list, then merge overlap between configuration sources.
export function configuredAllowlist(env) {
  const lists = [env.DASH_ALLOWED_EMAILS, env.DASH_ADDITIONAL_EMAILS, env.DASH_TEAM_EMAILS]
    .filter(v => String(v ?? '').trim()).map(parseAllowlist);
  if (!lists.length || lists.some(l => !l.valid)) return { valid: false, count: 0, emails: [] };
  return parseAllowlist([...new Set(lists.flatMap(l => l.emails))].join(','));
}
