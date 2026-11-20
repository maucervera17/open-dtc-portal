// Read-only Meta Graph client. This is the ONLY module that knows the Graph host.
// Every outbound Meta request is an explicit GET, validated before any network I/O.
const HOST = 'graph.facebook.com';
const VERSION = /^v\d+\.\d+$/;
const PATH = /^\/v\d+\.\d+\/(act_\d+(\/(insights|campaigns|adsets|ads|adspixels))?|\d+(\/(insights|previews|stats|media))?|\d+_\d+\/comments|dataset_quality)$/;
const FORBIDDEN_PARAMS = new Set(['method', 'batch', 'access_token']);
const RETRY_CODES = new Set([4, 17, 613, 80000]);
const MAX_ATTEMPTS = 4;
const PAGE_LIMIT = 200;
const PREFIX = 'dtc:dash:';

export class MetaReadOnlyError extends Error {
  constructor(reason = 'blocked') { super(`Meta read-only violation: ${reason}`); this.name = 'MetaReadOnlyError'; }
}
export class DisabledError extends Error {
  constructor() { super('Dashboard disabled'); this.name = 'DisabledError'; }
}
// Never carries a URL, token or Meta's free-text message; only codes and the derived `permission` boolean.
export class MetaError extends Error {
  constructor(message, { code = null, subcode = null, status = null, retryAfter = null, permission = false } = {}) {
    super(message);
    this.name = 'MetaError';
    this.code = code; this.subcode = subcode; this.status = status; this.retryAfter = retryAfter;
    this.permission = permission === true;
  }
  toJSON() { return { name: this.name, message: this.message, code: this.code, subcode: this.subcode, status: this.status, retryAfter: this.retryAfter, permission: this.permission }; }
}

export function graphUrl(version, path, params = {}) {
  if (typeof version !== 'string' || !VERSION.test(version)) throw new MetaReadOnlyError('api version');
  const url = new URL(`https://${HOST}/${version}/${String(path).replace(/^\/+/, '')}`);
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  return url;
}

function assertReadOnly(input, method = 'GET') {
  if (method !== 'GET') throw new MetaReadOnlyError('method');
  let url;
  try { url = input instanceof URL ? input : new URL(String(input)); } catch { throw new MetaReadOnlyError('url'); }
  if (url.protocol !== 'https:' || url.hostname !== HOST || url.port !== '' || url.username || url.password) throw new MetaReadOnlyError('host');
  for (const key of url.searchParams.keys()) if (FORBIDDEN_PARAMS.has(key.toLowerCase())) throw new MetaReadOnlyError('param');
  if (!PATH.test(url.pathname)) throw new MetaReadOnlyError('path');
  return url;
}

// Returns the raw fetch Response. Legacy collectors keep their own status/JSON handling.
export async function metaGet(input, { token, fetch: fetcher = fetch, method = 'GET', signal } = {}) {
  const url = assertReadOnly(input, method);
  return fetcher(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: signal ?? AbortSignal.timeout(12000) });
}

const readHeader = (response, name) => { try { return response.headers?.get?.(name) ?? null; } catch { return null; } };
const parseJson = text => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
// Code 100 alone is Meta's generic "invalid parameter", so permission is read from the message wording, or from codes 10 and 200-299.
// Only the resulting boolean is stored; the message text is dropped.
const isPermissionFailure = (code, text) => code === 10 || (typeof code === 'number' && code >= 200 && code <= 299) || (typeof text === 'string' && /permission/i.test(text));
const pct = value => (Number.isFinite(Number(value)) ? Number(value) : 0);

// Parses both Meta throttle headers into { pct, regain } (regain in minutes).
function throttleOf(response) {
  let max = 0, regain = 0;
  const buc = parseJson(readHeader(response, 'x-business-use-case-usage'));
  if (buc && typeof buc === 'object') {
    for (const entries of Object.values(buc)) {
      for (const e of Array.isArray(entries) ? entries : []) {
        max = Math.max(max, pct(e.call_count), pct(e.total_cputime), pct(e.total_time));
        regain = Math.max(regain, pct(e.estimated_time_to_regain_access));
      }
    }
  }
  const ads = parseJson(readHeader(response, 'x-fb-ads-insights-throttle'));
  if (ads && typeof ads === 'object') {
    max = Math.max(max, pct(ads.app_id_util_pct), pct(ads.acc_id_util_pct));
    regain = Math.max(regain, pct(ads.estimated_time_to_regain_access));
  }
  return { pct: max, regain };
}

export function createMetaClient({
  token, version, accountId, fetch: fetcher = fetch, now = Date.now, sleep, store, deadlineMs = 25000, enabled, random = Math.random,
} = {}) {
  const wait = sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const clock = () => Number(now());
  const started = clock();
  let usagePct = 0, storedPct = null, guardOk = null, guardPending = null;

  const requireEnabled = () => { if (enabled !== true) throw new DisabledError(); };
  const requireAccount = () => {
    if (typeof accountId !== 'string' || !/^\d+$/.test(accountId)) throw new MetaError('Meta account id is not configured', { code: 'config' });
    return accountId;
  };
  const noteUsage = async value => {
    usagePct = Math.max(usagePct, value);
    if (store && value > 0 && value !== storedPct) {
      storedPct = value;
      try { await store(['SET', `${PREFIX}meta:usage`, String(value), 'EX', 300]); } catch { /* usage sharing is best effort */ }
    }
  };

  // One GET with retries. `url` was already validated by the caller.
  async function request(url) {
    let last;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (clock() - started > deadlineMs) throw new MetaError('Meta deadline exceeded', { code: 'deadline' });
      let response, body;
      try {
        response = await metaGet(url, { token, fetch: fetcher });
        await noteUsage(throttleOf(response).pct);
        body = await response.json();
      } catch (error) {
        if (error instanceof MetaReadOnlyError) throw error;
        throw new MetaError('Meta request failed', { code: null });
      }
      if (response.ok && body && !body.error) return body;
      const failure = body?.error;
      const code = typeof failure?.code === 'number' ? failure.code : null;
      const details = { code, subcode: failure?.error_subcode ?? null, status: response.status ?? null, permission: isPermissionFailure(code, failure?.message) };
      last = new MetaError(`Meta request failed${code !== null ? ` (code ${code})` : ''}`, details);
      if (!RETRY_CODES.has(code)) throw last;
      const { regain } = throttleOf(response);
      if (regain > 0) throw new MetaError(last.message, { ...details, retryAfter: regain * 60 });
      if (attempt === MAX_ATTEMPTS) throw last;
      const delay = 2000 * 2 ** (attempt - 1) + Math.floor(random() * 500);
      if (clock() - started + delay > deadlineMs) throw last;
      await wait(delay);
    }
    throw last;
  }

  async function guardAccount() {
    requireEnabled();
    const id = requireAccount();
    const key = `${PREFIX}guard:${id}`;
    if (guardOk !== null && clock() < guardOk) return true;
    if (store && await store(['GET', key])) return true;
    if (!guardPending) {
      guardPending = (async () => {
        const info = await request(graphUrl(version, `act_${id}`, { fields: 'id,currency,timezone_name' }));
        if (info.id !== `act_${id}` || info.currency !== 'MXN' || info.timezone_name !== 'America/Mexico_City') {
          throw new MetaError('Account guard mismatch', { code: 'account_guard' });
        }
        if (store) await store(['SET', key, '1', 'EX', 3600]); else guardOk = clock() + 3600 * 1000;
        return true;
      })().finally(() => { guardPending = null; });
    }
    return guardPending;
  }

  async function get(path, params = {}, { method = 'GET' } = {}) {
    requireEnabled();
    const url = assertReadOnly(graphUrl(version, path, params), method);
    if (path.startsWith('act_')) {
      // Account binding: a caller can never reach another ad account through the shared token.
      if (path.split('/')[0] !== `act_${requireAccount()}`) throw new MetaReadOnlyError('account');
      await guardAccount();
    } else requireAccount();
    return request(url);
  }

  async function list(path, params = {}) {
    requireEnabled();
    const rows = [], cursors = new Set();
    let after;
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const body = await get(path, { limit: '100', ...params, ...(after ? { after } : {}) });
      if (!Array.isArray(body.data)) throw new MetaError('Invalid Meta response', { code: 'shape' });
      rows.push(...body.data);
      // paging.next is only a "has more" flag; it is never fetched.
      if (!body.paging?.next) return rows;
      after = body.paging?.cursors?.after;
      if (!after || cursors.has(after)) throw new MetaError('Meta pagination unavailable or repeated', { code: 'pagination' });
      cursors.add(after);
    }
    throw new MetaError('Meta pagination limit', { code: 'pagination' });
  }

  async function usage() {
    let value = usagePct;
    if (store) {
      try { value = Math.max(value, pct(await store(['GET', `${PREFIX}meta:usage`]))); } catch { /* memory value only */ }
    }
    return { pct: value, cacheTtl: value >= 75 ? 900 : 600, stale: value >= 90 };
  }

  return { get, list, guardAccount, usage };
}
