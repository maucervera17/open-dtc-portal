import { h, replace } from '/app/dom.js';
import { displayName, int, shortDate, timeOf, dateTime, ND } from '/app/format.js';
import { badge, provisionalBadge, table, funnelCard, pageHeader, statCard, barFill, webNote } from '/app/ui.js';
import { icon } from '/app/icons.js';
import { funnelSummary, perHundred, coverageText, PROVISIONAL_NOTE } from '/app/funnel.js';
import { evolutionCard } from '/app/evolution.js';

const one = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const score = v => (typeof v === 'number' && Number.isFinite(v) ? `${one.format(v)} / 10` : ND);

const EVENTS = [
  { key: 'ViewContent', label: 'Visitas a producto', short: 'Visitas a producto' },
  { key: 'AddToCart', label: 'Añadidos al carrito', short: 'Añadidos al carrito' },
  { key: 'InitiateCheckout', label: 'Pagos iniciados', short: 'Pagos iniciados' },
  { key: 'Purchase', label: 'Compras', short: 'Compras' },
];

// Sum of one source over the listed days. Null when no day has a number, so a missing source never becomes 0.
const sum = values => { const nums = values.filter(v => typeof v === 'number' && Number.isFinite(v)); return nums.length ? nums.reduce((a, b) => a + b, 0) : null; };

const periodDays = window => (window?.from && window?.to ? Math.round((Date.parse(`${window.to}T00:00:00Z`) - Date.parse(`${window.from}T00:00:00Z`)) / 86400000) + 1 : 7);

function summaryCard(funnel, window, source, { covered, expected } = {}) {
  const days = Number.isFinite(expected) ? expected : periodDays(window);
  const text = funnelSummary(funnel, { days, source, covered });
  return text ? h('div', { class: 'card callout' }, h('h2', { class: 'card-title' }, 'En pocas palabras'), h('p', { class: 'summary' }, text)) : null;
}

const HELP = [
  ['¿Qué significa? ', true],
  ['"Atribuido a anuncios" quiere decir que Meta cuenta la acción (ver producto, añadir al carrito, pagar, comprar) a un anuncio que la persona vio o tocó antes; no incluye todo lo que pasa en la tienda. ', false],
  [`"Provisional" son los últimos días y "Puede ajustarse" los anteriores: ${PROVISIONAL_NOTE}`, false],
];
const howToRead = () => h('details', { class: 'card how-to' },
  h('summary', { class: 'tech-summary' }, '¿Cómo leer esta página?'),
  h('p', { class: 'muted small help' }, HELP.map(([text, strong]) => (strong ? h('strong', {}, text) : text))));

// Pixel identity, last fire and the provisional chip: a small muted line inside the connection banner.
function metaLine(pixel, data) {
  const provisional = data.window && data.window.to >= data.provisional_from;
  return h('div', { class: 'pixel-meta small muted' },
    h('strong', { class: 'pixel-name' }, displayName(pixel.name) || 'Píxel sin nombre'),
    pixel.is_unavailable === true ? badge('Píxel no disponible', 'bad') : null,
    h('span', {}, `ID ${pixel.id || ND} · Último disparo: ${dateTime(pixel.last_fired_time)}`),
    provisional ? provisionalBadge(data.provisional_from) : null);
}

function daysCard(days) {
  const pair = entry => `${int(entry?.web)} / ${int(entry?.server)}`;
  return h('div', { class: 'card days-card' },
    h('div', { class: 'card-titles' }, h('h2', { class: 'card-title' }, 'Por día'), h('p', { class: 'table-caption muted small' }, 'Cada celda muestra web / servidor.')),
    table([
      { label: 'Fecha', cell: d => h('span', { class: 'name-cell' }, h('span', { class: 'name' }, shortDate(d.date)), d.provisional ? badge('Provisional', 'warn') : null, adjustableBadge(d)) },
      ...EVENTS.map(e => ({ label: e.short, num: true, cell: d => pair(d.events[e.key]) })),
    ], [...days].reverse(), {
      keepLayout: true,
      foot: col => {
        const event = EVENTS.find(e => e.short === col.label);
        return event ? pair({ web: sum(days.map(d => d.events[event.key]?.web)), server: sum(days.map(d => d.events[event.key]?.server)) }) : 'Total';
      },
    }));
}

const ATTRIBUTED_LABEL = 'Eventos atribuidos a anuncios (Meta Ads). Para ver todos los eventos del píxel, da acceso al conjunto de datos al usuario del token.';

// "Solo hay datos de 5 de 7 días": an incomplete period is never presented as a full one.
const coverageNote = (covered, expected) => {
  const text = coverageText(covered, expected);
  return text ? h('p', { class: 'coverage-note small muted' }, `Solo hay datos de ${text} en este periodo.`) : null;
};

const adjustableBadge = d => (d.adjustable && !d.provisional ? badge('Puede ajustarse', 'neutral') : null);

const SHARED_LABEL = 'Eventos atribuidos a anuncios (Meta Ads), un total por evento y día.';

// One total per event and day (no web/server split): these are the events Meta attributes to ads, not the pixel's own stats.
function attributedCard(attributed, shared) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-titles' }, h('h2', { class: 'card-title' }, 'Por día (atribuidos a anuncios)'), h('p', { class: 'table-caption muted small' }, shared ? SHARED_LABEL : ATTRIBUTED_LABEL)),
    table([
      { label: 'Fecha', cell: d => h('span', { class: 'name-cell' }, h('span', { class: 'name' }, shortDate(d.date)), d.provisional ? badge('Provisional', 'warn') : null, adjustableBadge(d)) },
      ...EVENTS.map(e => ({ label: e.short, num: true, cell: d => int(d.events[e.key]?.total) })),
    ], [...attributed.days].reverse(), {
      keepLayout: true,
      empty: 'Todavía no hay días de anuncios guardados.',
      foot: col => {
        const event = EVENTS.find(e => e.short === col.label);
        return event ? int(sum(attributed.days.map(d => d.events[event.key]?.total))) : 'Total';
      },
    }));
}

// One status and one next step per pixel state, so "no data" is never ambiguous.
const BANNER = {
  ok: { tone: 'good', icon: 'check-circle', status: 'Píxel conectado y recibiendo eventos.', next: 'No necesitas hacer nada: las cifras se actualizan solas cada día.' },
  attributed: { tone: 'info', icon: 'info', status: 'Mostrando eventos atribuidos a anuncios.', next: 'El píxel es compartido por otro negocio, así que Meta solo expone los eventos que vienen de tus anuncios. La calidad de eventos (EMQ) sí se actualiza a diario.' },
  no_permission: { tone: 'warn', icon: 'alert-triangle', status: 'Meta no dio acceso a las estadísticas del píxel.', next: 'Asigna el conjunto de datos del píxel al usuario del token en Business Manager.' },
  not_run_yet: { tone: 'warn', icon: 'alert-triangle', status: 'Todavía no se ejecuta la captura diaria del píxel.', next: 'Los datos aparecen después de la primera ejecución programada.' },
  no_events: { tone: 'warn', icon: 'alert-triangle', status: 'El píxel no registró eventos en los últimos días.', next: 'Revisa que la tienda esté enviando eventos al píxel correcto.' },
  error: { tone: 'warn', icon: 'alert-triangle', status: 'La última captura del píxel falló.', next: 'Revisa el estado de las conexiones en Resumen.' },
};

function connectionBanner(status, data) {
  const spec = BANNER[status] || BANNER.ok;
  return h('div', { class: `pixel-banner banner-${spec.tone}`, role: 'status' },
    h('span', { class: 'pixel-banner-icon' }, icon(spec.icon, { size: 20 })),
    h('div', { class: 'pixel-banner-body' },
      h('p', { class: 'pixel-banner-status' }, spec.status),
      h('p', { class: 'pixel-banner-next small' }, spec.next),
      metaLine(data.pixel || {}, data)));
}

const STATS = [
  { label: 'Visitas a producto', icon: 'eye', key: 'content' },
  { label: 'Añadidos al carrito', icon: 'shopping-cart', key: 'carts' },
  { label: 'Pagos iniciados', icon: 'dollar-sign', key: 'checkout' },
  { label: 'Compras', icon: 'shopping-bag', key: 'purchases' },
];

// Same stat card as Resumen. No previous period exists for the pixel, so no delta is shown. With the pixel's own stats the web
// and the server counts are shown apart: the same event can be in both, so their sum is labelled as such, never as unique events.
const EVENT_OF = { content: 'ViewContent', carts: 'AddToCart', checkout: 'InitiateCheckout', purchases: 'Purchase' };
function statsGrid(funnel, totals = null) {
  return h('div', { class: 'stats-grid' }, STATS.map((stat, i) => {
    const share = perHundred(funnel[stat.key], funnel.content);
    const split = totals?.[EVENT_OF[stat.key]];
    const hasSplit = split && (typeof split.web === 'number' || typeof split.server === 'number');
    return statCard({ label: stat.label, icon: stat.icon, value: int(funnel[stat.key]), showDelta: false,
      notes: [
        hasSplit ? 'Web + servidor (puede incluir duplicados)' : null,
        hasSplit ? `Web ${int(split.web)} · Servidor ${int(split.server)}` : null,
        i === 0 ? 'Punto de partida' : share === null ? ND : `${share} de cada 100 visitas`] });
  }));
}

// Score bands follow Meta's own: 8 and up is great, 6 to 8 good, 4 to 6 fair, below 4 poor.
const band = v => (v >= 8 ? ['Excelente', 'good'] : v >= 6 ? ['Buena', 'good'] : v >= 4 ? ['Regular', 'warn'] : ['Baja', 'bad']);

function emqCard(data) {
  const parts = [];
  let pill;
  if (data.emq_status === 'ok' && data.emq) {
    const [label, tone] = band(data.emq.score);
    pill = badge(label, tone);
    const pct = Math.max(0, Math.min(100, Math.round((data.emq.score / 10) * 1000) / 10));
    parts.push(
      h('div', { class: 'emq-score num' }, score(data.emq.score)),
      h('div', { class: 'emq-meter', role: 'meter', 'aria-label': 'Calidad de coincidencia', 'aria-valuemin': '0', 'aria-valuemax': '10', 'aria-valuenow': String(data.emq.score) }, barFill('emq-meter-fill', pct)),
      h('ul', { class: 'evidence-list' }, data.emq.events.map(e => h('li', { class: 'evidence-line' }, h('span', {}, e.name), h('span', { class: 'num' }, score(e.score))))));
  } else if (data.emq_status === 'not_configured') {
    pill = badge('No configurado', 'neutral');
    parts.push(h('p', { class: 'emq-note muted small' }, 'La calidad de coincidencia de eventos (EMQ) requiere un token de usuario del sistema de Meta.'));
  } else {
    pill = badge('No disponible', 'warn');
    parts.push(h('p', { class: 'emq-note muted small' }, 'Meta no devolvió la calidad de coincidencia en este momento.'));
  }
  pill.className += ' emq-status';
  return h('div', { class: 'card emq-card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Calidad de coincidencia (EMQ)'), pill),
    parts);
}

function draw(container, data) {
  container.append(connectionBanner(data.pixel_status || 'ok', data));
  const hasStats = data.days.length > 0;
  const hasAttributed = data.attributed?.days.length > 0;
  const funnel = hasStats ? data.funnel : hasAttributed ? data.attributed.funnel : null;
  if (funnel) container.append(statsGrid(funnel, hasStats ? data.totals : null), webNote());
  const covered = hasStats ? { covered: data.days_covered, expected: data.days_expected } : { covered: data.attributed?.days_covered, expected: data.attributed?.days_expected };
  const gap = coverageNote(covered.covered, covered.expected);
  if (gap) container.append(gap);
  if (hasStats) container.append(funnelCard(data.funnel));
  else if (hasAttributed) container.append(funnelCard(data.attributed.funnel, 'Embudo (atribuido a anuncios)'));
  const summary = hasStats ? summaryCard(data.funnel, data.window, 'pixel', covered) : hasAttributed ? summaryCard(data.attributed.funnel, data.attributed.window || data.window, 'ads', covered) : null;
  if (summary) container.append(summary);
  if (hasStats) container.append(daysCard(data.days));
  if (hasStats && hasAttributed) container.append(funnelCard(data.attributed.funnel, 'Embudo (atribuido a anuncios)'));
  if (hasAttributed) container.append(attributedCard(data.attributed, data.pixel_status === 'attributed'));
  container.append(emqCard(data));
}

export default {
  route: 'pixel',
  label: 'Píxel',
  render(ctx) {
    const body = h('div', { class: 'stack pixel-page' });
    const meta = h('span', { class: 'muted small' });
    const evolution = h('div', { class: 'stack' });
    const refreshButton = h('button', { type: 'button', class: 'icon-btn refresh-btn', 'aria-label': 'Actualizar', title: 'Actualizar', onclick: () => load() }, icon('refresh-cw', { size: 18 }));
    const root = h('div', { class: 'stack pixel-page' },
      pageHeader({ ctx, title: 'Píxel y eventos', subtitle: 'Eventos del píxel por origen: navegador (web) y servidor.', actions: [refreshButton] }),
      howToRead(),
      h('div', { class: 'statusline' }, meta),
      body,
      evolution);
    let request = 0;
    function load() {
      const current = ++request;
      replace(body, h('p', { class: 'muted loading' }, 'Cargando…'));
      refreshButton.disabled = true;
      ctx.api.get('pixel').then(result => {
        if (current !== request) return;
        refreshButton.disabled = false;
        if (!result.ok) {
          replace(body, h('div', { class: 'card' }, h('p', { class: 'muted' }, result.status === 503
            ? 'El servicio está ocupado. Intenta de nuevo en unos segundos.'
            : 'No se pudieron cargar los datos. Intenta de nuevo.')));
          return;
        }
        meta.textContent = `${result.data.source === 'stale' ? 'Datos guardados, pueden estar desactualizados. ' : ''}Actualizado a las ${timeOf(result.data.generated_at)}`;
        const container = h('div', { class: 'stack pixel-page' });
        draw(container, result.data);
        replace(body, container);
      });
      // The weekly journal loads on its own: its failure or absence never affects the rest of the page.
      Promise.resolve(ctx.api.get('journal')).then(result => {
        const card = result?.ok ? evolutionCard(result.data?.weeks, result.data?.provisional_from) : null;
        if (current === request && card) replace(evolution, card);
      }).catch(() => {});
    }
    load();
    return root;
  },
};
