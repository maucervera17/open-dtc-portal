// Same-origin client for the gated /api/dash routes. Raw numbers only; formatting happens in the views.
export function createApi({ fetch: fetcher = (...args) => globalThis.fetch(...args), onUnauthorized = () => {} } = {}) {
  // `timeoutMs` aborts the request when the server takes longer: the result is { ok: false, status: 0, timedOut: true }.
  async function call(method, route, { query, body, timeoutMs } = {}) {
    const qs = query ? `?${new URLSearchParams(query)}` : '';
    const init = { method, credentials: 'same-origin', headers: { Accept: 'application/json' } };
    if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let timer = null;
    let timedOut = false;
    let guard = null;
    if (timeoutMs) {
      const controller = new AbortController();
      init.signal = controller.signal;
      // Race as well as abort: a fetch that ignores the signal still ends at the deadline.
      guard = new Promise(resolve => { timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(null); }, timeoutMs); });
    }
    let response;
    try {
      const pending = fetcher(`/api/dash/${route}${qs}`, init);
      response = guard ? await Promise.race([pending, guard]) : await pending;
      if (guard) pending.catch(() => {});
    } catch { if (timer) clearTimeout(timer); return timedOut ? { ok: false, status: 0, data: null, timedOut: true } : { ok: false, status: 0, data: null }; }
    if (timer) clearTimeout(timer);
    if (!response) return { ok: false, status: 0, data: null, timedOut: true };
    if (response.status === 401 && route !== 'me') onUnauthorized();
    let data = null;
    if (response.status !== 204) { try { data = await response.json(); } catch { data = null; } }
    return { ok: response.ok, status: response.status, data };
  }
  return {
    me: () => call('GET', 'me'),
    requestLink: email => call('POST', 'auth/request', { body: { email } }),
    consume: token => call('POST', 'auth/consume', { body: { token } }),
    logout: () => call('POST', 'auth/logout', { body: {} }),
    get: (route, query, options = {}) => call('GET', route, { query, timeoutMs: options.timeoutMs }),
    post: (route, body, options = {}) => call('POST', route, { body, timeoutMs: options.timeoutMs }),
  };
}
