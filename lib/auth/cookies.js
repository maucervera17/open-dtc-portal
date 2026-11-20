export const COOKIE_NAME = '__Host-dtc_dash';
const ATTRS = 'Path=/; HttpOnly; Secure; SameSite=Lax';
const SID = /^[A-Za-z0-9_-]{43}$/;

export const sessionCookie = (sid, maxAge) => `${COOKIE_NAME}=${sid}; ${ATTRS}; Max-Age=${maxAge}`;
export const clearCookie = () => `${COOKIE_NAME}=; ${ATTRS}; Max-Age=0`;

export function readSid(header) {
  if (typeof header !== 'string') return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE_NAME) {
      const value = part.slice(i + 1).trim();
      return SID.test(value) ? value : null;
    }
  }
  return null;
}
