// CSRF gate for state-changing requests: same Origin, or same-origin Fetch Metadata when Origin is absent.
export function originAllowed(headers, baseUrl) {
  let expected;
  try { expected = new URL(baseUrl).origin; } catch { return false; }
  const origin = headers.origin;
  if (origin === undefined) return headers['sec-fetch-site'] === 'same-origin';
  return origin === expected;
}

export const isJson = headers => /^application\/json\s*(;|$)/i.test(String(headers['content-type'] ?? ''));
