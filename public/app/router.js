// Hash routes look like "#/name" or "#/name?k=v". Anything malformed maps to the empty route.
export function parseHash(hash) {
  const match = /^#\/([a-z]*)(?:\?(.*))?$/.exec(String(hash || ''));
  if (!match) return { name: '', params: {} };
  const params = {};
  for (const [key, value] of new URLSearchParams(match[2] || '')) params[key] = value;
  return { name: match[1], params };
}
