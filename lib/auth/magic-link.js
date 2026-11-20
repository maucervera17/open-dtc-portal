import { randomBytes } from 'node:crypto';
import { configuredAllowlist, isAllowed } from './allowlist.js';
import { secretOk } from './session.js';
import { hmac, K, TTL } from '../dash/store.js';
import { hit } from '../dash/ratelimit.js';
import { logEvent } from '../dash/log.js';
import { brandName } from '../brand.js';

const IP_LIMIT = 20;
const SEND_CEILING = 30; // per email per hour, bounds mail volume
const SEND_GAP_S = 60; // at most one new token per email per 60 s
export const RESEND_TIMEOUT_MS = 1200; // keeps the 1.5 s response floor intact (Amendment 2)
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createMagicLinks({ env, store, fetch: fetcher, timeoutSignal, sessions }) {
  const h = value => hmac(env.DASH_SESSION_SECRET, value);
  const allowlist = () => configuredAllowlist(env);

  // Never throws for business reasons: the caller answers identically in every branch.
  async function request({ email, ip }) {
    const allow = allowlist();
    if (!secretOk(env) || !env.DASH_BASE_URL) return logEvent('dash_login', { stage: 'config', code: 'misconfigured' });
    if (!allow.valid) return logEvent('dash_login', { stage: 'allowlist', code: 'misconfigured', count: allow.count });
    if (await hit(store, K.loginIp(h(ip)), TTL.rateHour) > IP_LIMIT) return;
    if (!isAllowed(allow, email)) return;
    // Send-side limits key on the email, so they must never let an attacker exhaust the real user's budget:
    // the gap only drops repeats inside 60 s; the hourly ceiling is far above any legitimate use.
    if (await store(['SET', K.loginGap(h(email)), '1', 'NX', 'EX', SEND_GAP_S]) !== 'OK') return;
    if (await hit(store, K.loginSend(h(email)), TTL.rateHour) > SEND_CEILING) return;
    const token = randomBytes(32).toString('base64url');
    await store(['SET', K.authToken(h(token)), email, 'EX', TTL.loginToken, 'NX']);
    if (!env.RESEND_API_KEY || !env.REPORT_FROM) return logEvent('dash_login', { stage: 'send', code: 'config' });
    const link = `${String(env.DASH_BASE_URL).replace(/\/+$/, '')}/app/#/verify?t=${token}`;
    const text = `Usa este enlace para entrar al panel de ${brandName(env)}. Vence en 15 minutos y solo funciona una vez.\n\n${link}\n\nSi no lo solicitaste, ignora este correo.`;
    const html = `<p>Usa este enlace para entrar al panel de ${brandName(env)}. Vence en 15 minutos y solo funciona una vez.</p><p><a href="${escapeHtml(link)}">Entrar al panel</a></p><p>Si no lo solicitaste, ignora este correo.</p>`;
    try {
      const response = await fetcher('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `dash-login/${h(token).slice(0, 32)}` },
        body: JSON.stringify({ from: env.REPORT_FROM, to: [email], subject: `Tu enlace de acceso a ${brandName(env)}`, text, html }),
        signal: timeoutSignal(RESEND_TIMEOUT_MS),
      });
      if (!response.ok) logEvent('dash_login', { stage: 'send', code: response.status });
    } catch {
      logEvent('dash_login', { stage: 'send', code: 'failed' });
    }
  }

  // Single use: GETDEL makes the token unusable even under concurrent consumes.
  async function consume(token) {
    const allow = allowlist();
    if (!secretOk(env) || !allow.valid) { logEvent('dash_consume', { stage: 'allowlist', code: 'misconfigured', count: allow.count }); return null; }
    const email = await store(['GETDEL', K.authToken(h(token))]);
    if (!email || !isAllowed(allow, email)) return null;
    return { email, ...(await sessions.create(email)) };
  }

  return { request, consume };
}
