import { parseAllowlist } from '../auth/allowlist.js';
import { K, TTL } from '../dash/store.js';
import { logEvent } from '../dash/log.js';
import { brandName } from '../brand.js';

export const DIGEST_TIMEOUT_MS = 10000;
const MAX_ITEMS = 10;
const ACTION_LABEL = { STOP: 'Detener', CONTINUE: 'Continuar', SCALE: 'Escalar', REPLACE_CREATIVE: 'Reemplazar creativo', WATCH: 'Vigilar' };
const CONFIDENCE_LABEL = { low: 'Baja', medium: 'Media', high: 'Alta' };
const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function dashboardLink(env) {
  const base = String(env.DASH_BASE_URL || '').replace(/\/+$/, '');
  return /^https?:\/\/[^\s"'<>]+$/.test(base) ? `${base}/app/#/alertas` : null;
}

// Plain text keeps the literal names; the HTML twin escapes everything that comes from Meta or the model.
export function buildDigest(run, D, env) {
  const items = (run.recommendations || []).slice(0, MAX_ITEMS).map(r => ({
    head: `[Recomendación] ${ACTION_LABEL[r.action] || r.action} · ${r.entity_name || r.entity_id} (confianza ${CONFIDENCE_LABEL[r.confidence] || r.confidence})`,
    rationale: r.rationale,
    evidence: (r.evidence || []).join('; '),
    review: `Revisar en ${r.review_after_days} días (${r.review_after})`,
    note: r.guardrail ? 'Ajustada a Vigilar por una regla de seguridad.' : null,
  }));
  const link = dashboardLink(env);
  const intro = 'El agente solo recomienda; nunca aplica cambios en Meta.';
  const empty = 'Sin recomendaciones hoy.';
  const footer = `Modelo ${run.model} · Playbook ${run.playbook_version}`;

  const text = [
    `${brandName()}: recomendaciones del ${D}`, intro, run.summary || '',
    ...(items.length ? items.map((it, i) => [`${i + 1}. ${it.head}`, `   ${it.rationale}`, it.evidence ? `   Evidencia: ${it.evidence}` : '', `   ${it.review}`, it.note ? `   ${it.note}` : ''].filter(Boolean).join('\n')) : [empty]),
    link ? `Ver detalle: ${link}` : '', footer,
  ].filter(part => part !== '').join('\n\n');

  const html = [
    `<h2>${brandName()}: recomendaciones del ${escapeHtml(D)}</h2>`, `<p>${escapeHtml(intro)}</p>`, run.summary ? `<p>${escapeHtml(run.summary)}</p>` : '',
    ...(items.length ? [`<ol>${items.map(it => `<li><strong>${escapeHtml(it.head)}</strong><br>${escapeHtml(it.rationale)}${it.evidence ? `<br>Evidencia: ${escapeHtml(it.evidence)}` : ''}<br>${escapeHtml(it.review)}${it.note ? `<br>${escapeHtml(it.note)}` : ''}</li>`).join('')}</ol>`] : [`<p>${empty}</p>`]),
    link ? `<p><a href="${escapeHtml(link)}">Ver detalle</a></p>` : '', `<p>${escapeHtml(footer)}</p>`,
  ].filter(Boolean).join('');
  return { subject: `${brandName()}: recomendaciones del ${D}`, text, html };
}

// Sent only when AGENT_EMAIL_ENABLED is true, only to the two allowlisted emails, at most once per day (marker plus Resend key).
// A failed send leaves no marker, so the next invocation retries it; it never fails the run.
export async function sendDigest({ run, D, env, store, fetch: fetcher, signal }) {
  if (env.AGENT_EMAIL_ENABLED !== 'true' || run?.status !== 'ok') return { sent: false };
  const allow = parseAllowlist(env.DASH_ALLOWED_EMAILS);
  if (!allow.valid || !env.RESEND_API_KEY || !env.REPORT_FROM) {
    logEvent('dash_agent', { stage: 'digest', code: 'config' });
    return { sent: false };
  }
  if (await store(['GET', K.agentEmail(D)])) return { sent: false };
  const { subject, text, html } = buildDigest(run, D, env);
  try {
    const response = await fetcher('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `dash-agent-digest/${D}` },
      body: JSON.stringify({ from: env.REPORT_FROM, to: allow.emails, subject, text, html }),
      signal: signal(DIGEST_TIMEOUT_MS),
    });
    if (!response.ok) { logEvent('dash_agent', { stage: 'digest', code: response.status }); return { sent: false }; }
    await store(['SET', K.agentEmail(D), '1', 'EX', TTL.agentEmail]);
    return { sent: true };
  } catch {
    logEvent('dash_agent', { stage: 'digest', code: 'failed' });
    return { sent: false };
  }
}
