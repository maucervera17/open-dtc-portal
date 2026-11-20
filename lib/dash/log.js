// The only logger for dashboard code. It writes fixed-shape events and never an
// Error object, message, URL, email or token.
const safe = value => (typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^[\w.:-]{1,40}$/.test(value)) ? value : undefined;

export function logEvent(event, { stage, code, subcode, count } = {}) {
  const fields = { stage: safe(stage), code: safe(code), subcode: safe(subcode), count: safe(count) };
  for (const key of Object.keys(fields)) if (fields[key] === undefined) delete fields[key];
  console.error(event, fields);
}

// Diagnostic for a rejected preview src: hostname and pathname only. The query string carries signed parameters and is
// never logged; anything that does not look like a plain host or path is dropped.
export function logPreviewSrc({ host, path } = {}) {
  const fields = {};
  if (typeof host === 'string' && /^[a-z0-9.-]{1,100}$/.test(host)) fields.host = host;
  if (typeof path === 'string' && /^[\w/.-]{1,100}$/.test(path)) fields.path = path;
  console.error('dash_preview_src', fields);
}
