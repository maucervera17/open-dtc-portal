import { h, replace } from '/app/dom.js';
import { dateTime, shortDate, ND } from '/app/format.js';
import { badge } from '/app/ui.js';
import { relativeTime } from '/app/chat-conversations.js';

// The server sends states and reason codes only; every word the user reads lives here.
const STATES = {
  connected: ['✓ Conectado', 'good'],
  attributed: ['ℹ Eventos atribuidos', 'info'],
  no_permission: ['⚠ Sin permiso', 'warn'],
  not_configured: ['○ No configurado', 'neutral'],
  error: ['✕ Error', 'bad'],
  pending: ['… Sin datos todavía', 'neutral'],
};

const LABELS = {
  sales: 'Campañas y ventas', creatives: 'Creativos', pixel: 'Píxel', emq: 'Calidad de eventos (EMQ)', ig: 'Instagram', agent: 'Agente de recomendaciones',
};

const PERMISSION_NEXT = {
  pixel: 'Crea el token de usuario del sistema (System User) en Business Manager y define META_SYSTEM_USER_TOKEN en Vercel: resuelve Píxel y EMQ.',
  default: 'Da al usuario del token acceso a la cuenta publicitaria en Business Manager.',
};

// Key variable per agent provider; only the variable name is shown, never a value.
export const agentKeyVar = provider => (provider === 'gemini' ? 'GEMINI_API_KEY' : 'ANTHROPIC_API_KEY');

// reason code -> [what happened, what to do next]. `s` is the source entry.
const REASONS = {
  ok: () => ['Datos recibidos correctamente.', null],
  partial: () => ['Conectado; una parte de las métricas no respondió.', 'Se reintenta en la próxima captura diaria.'],
  token_expiring: () => ['Conectado, pero el token de acceso vence pronto.', 'Genera un token de usuario del sistema y actualízalo en Vercel.'],
  no_snapshot_yet: () => ['Aún no se ejecuta la captura diaria.', 'Espera la próxima ejecución programada.'],
  attributed: () => ['Píxel compartido; se muestran eventos de anuncios', null],
  no_permission: s => ['Meta rechazó el acceso con el token actual.', PERMISSION_NEXT[s.id] || PERMISSION_NEXT.default],
  job_failed: () => ['La última captura falló.', 'Revisa los registros de la función dash-cron en Vercel.'],
  missing_meta_config: () => ['Falta la cuenta publicitaria o el token de Meta.', 'Define META_ACCESS_TOKEN y META_AD_ACCOUNT_ID en Vercel.'],
  no_system_token: () => ['Requiere token de System User.', 'Crea un usuario del sistema en Business Manager y define META_SYSTEM_USER_TOKEN en Vercel.'],
  pixel_not_ready: () => ['Se consulta después de la captura del píxel.', 'Resuelve primero el estado del píxel.'],
  emq_failed: () => ['Meta no devolvió la calidad de coincidencia.', 'Comprueba que el usuario del sistema tenga acceso al conjunto de datos.'],
  missing_ig_config: () => ['Faltan las credenciales de Instagram.', 'Define INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_USER_ID e INSTAGRAM_USERNAME en Vercel.'],
  missing_key: s => ['El agente está apagado: no hay clave de API.', `Falta ${agentKeyVar(s.provider)} en Vercel.`],
  invalid_provider: () => ['AGENT_PROVIDER tiene un valor no válido.', 'Usa gemini o anthropic en AGENT_PROVIDER, o quítalo para usar gemini.'],
  agent_disabled: () => ['El agente está apagado por configuración.', 'Define AGENT_ENABLED=true en Vercel para activarlo.'],
  no_runs_yet: () => ['Aún no hay ejecuciones del agente.', 'Espera la próxima ejecución programada.'],
  run_failed: s => [`La última ejecución falló${s.stage ? ` (etapa: ${s.stage})` : ''}.`, 'Revisa los registros de la función dash-cron en Vercel.'],
};

export const reasonText = (entry, id = entry?.id) => (REASONS[entry?.reason] || (() => [ND, null]))({ ...entry, id });

// The newest chat diagnostic record as one line: "Última respuesta: 14 s · OK (3.7 Flash)" or "Última falla: tiempo agotado hace 5 min".
const FAILURE_LABELS = { timeout: 'tiempo agotado', overloaded: 'modelo saturado', error: 'error' };
const MODEL_KINDS = { f: 'Flash', p: 'Pro' };
export const modelLabel = short => {
  const m = /^(\d[\d.]*)([a-z])$/.exec(String(short ?? ''));
  return m ? `${m[1]} ${MODEL_KINDS[m[2]] || m[2]}` : typeof short === 'string' && /^[\w.-]{1,20}$/.test(short) ? short : '';
};
export function healthLine(health, now = new Date()) {
  const last = Array.isArray(health?.records) ? health.records[0] : null;
  if (!last || typeof last !== 'object') return null;
  if (last.outcome === 'ok' || last.outcome === 'refusal') {
    const model = modelLabel(last.served_by);
    return `Última respuesta: ${Math.max(0, Math.round(Number(last.ms) / 1000))} s · ${last.outcome === 'ok' ? 'OK' : 'Rechazada'}${model ? ` (${model})` : ''}`;
  }
  const label = FAILURE_LABELS[last.outcome];
  return label ? `Última falla: ${label} ${relativeTime(last.at, now)}`.trim() : null;
}

function row(entry, health = null) {
  const [label, kind] = STATES[entry.state] || [ND, 'neutral'];
  const [what, next] = reasonText(entry);
  return h('div', { class: 'conn-row' },
    h('div', { class: 'conn-head' }, h('span', { class: 'name' }, LABELS[entry.id] || entry.id), badge(label, kind)),
    h('p', { class: 'small muted' }, what),
    entry.id === 'agent' && entry.model ? h('p', { class: 'small muted' }, `Modelo: ${entry.model}`) : null,
    entry.id === 'agent' && health ? h('p', { class: 'small muted conn-health' }, health) : null,
    next ? h('p', { class: 'small' }, `Siguiente paso: ${next}`) : null);
}

// Compact card for the bottom of Resumen. Loads by itself; a failure is stated, never left blank.
export function connectionsCard(ctx) {
  const body = h('div', { class: 'stack' }, h('p', { class: 'muted loading' }, 'Cargando…'));
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Estado de conexiones')), body);
  const failed = () => replace(body, h('p', { class: 'muted' }, 'No se pudo cargar el estado de las conexiones.'));
  // The agent's last chat diagnostic is a best-effort extra line: its failure never touches the rest of the card.
  const health = Promise.resolve(ctx.api.get('agent/health', {})).then(r => (r?.ok ? healthLine(r.data) : null)).catch(() => null);
  Promise.all([ctx.api.get('status', {}), health]).then(([result, healthText]) => {
    const data = result?.ok ? result.data : null;
    if (!data || !Array.isArray(data.sources)) return failed();
    replace(body,
      h('div', { class: 'conn-list' }, data.sources.map(entry => row(entry, healthText))),
      h('p', { class: 'small muted' }, data.last_snapshot
        ? `Última captura: ${dateTime(data.last_snapshot.at)} (datos del ${shortDate(data.last_snapshot.date)}).`
        : 'Última captura: todavía no hay ninguna.'));
  }).catch(failed);
  return card;
}
