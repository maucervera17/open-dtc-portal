import { h, replace } from '/app/dom.js';
import { delta, rangeFor, shortDate, timeOf, int, ND, cdmxToday } from '/app/format.js';
import { icon } from '/app/icons.js';
import { perHundred, overHundred, followText, allNote, DIRECT_BUY_NOTE, WEB_NOTE } from '/app/funnel.js';
import { PROVISIONAL_LABEL, ADJUSTABLE_LABEL } from '/app/chart-config.js';

export const PRESETS = [7, 14, 30, 90];
const HISTORY_PRESETS = [...PRESETS, 180, 365, 730];
const shared = { days: 7, custom: null };

// Shared page frame for the data views: title, period chips, refresh, and a body that reloads on change.
// `draw(container, data, tools)` paints the payload; `tools.chart(instance)` registers charts for teardown.
export function rangeView({ ctx, title, module, endpoint, draw }) {
  const body = h('div', { class: 'stack' });
  const notice = h('span', { class: 'notice', role: 'status' });
  const meta = h('span', { class: 'muted small' });
  // The "Actualizado" line follows the OLDEST number on the page: a view that also shows data from another module reports
  // that module's time through tools.alsoUpdated, and both are named when they differ.
  const stamp = { own: null, other: null, source: null };
  const paintMeta = () => {
    const { own, other } = stamp;
    if (!own) return;
    const stale = stamp.source === 'stale' ? 'Datos guardados, pueden estar desactualizados. ' : '';
    if (other && timeOf(own.at) !== timeOf(other.at)) {
      const [older, newer] = Date.parse(own.at) <= Date.parse(other.at) ? [own, other] : [other, own];
      meta.textContent = `${stale}Actualizado a las ${timeOf(older.at)} (${older.label}) y a las ${timeOf(newer.at)} (${newer.label})`;
    } else meta.textContent = `${stale}Actualizado a las ${timeOf(other && Date.parse(other.at) < Date.parse(own.at) ? other.at : own.at)}`;
  };
  let charts = [];
  let request = 0;
  const destroy = () => { for (const chart of charts) { try { chart.destroy(); } catch { /* already gone */ } } charts = []; };
  ctx.onCleanup(destroy);

  const initial = shared.custom || rangeFor(shared.days);
  const fromInput = h('input', { type: 'date', class: 'input', 'aria-label': 'Desde', required: true, max: cdmxToday(), value: initial.from });
  const toInput = h('input', { type: 'date', class: 'input', 'aria-label': 'Hasta', required: true, max: cdmxToday(), value: initial.to });
  const period = h('select', { class: 'input period-select', 'aria-label': 'Periodo', onchange: () => {
    customForm.hidden = period.value !== 'custom';
    if (period.value === 'custom') return;
    shared.days = Number(period.value); shared.custom = null;
    const selected = rangeFor(shared.days); fromInput.value = selected.from; toInput.value = selected.to;
    load(false);
  } }, HISTORY_PRESETS.map(days => h('option', { value: days }, days === 365 ? 'Último año' : days === 730 ? 'Últimos 2 años' : `Últimos ${days} días`)), h('option', { value: 'custom' }, 'Fechas personalizadas'));
  const periodControl = h('div', { class: 'period-control' },
    icon('calendar', { size: 18, class: 'period-calendar' }),
    h('span', { class: 'period-caption', 'aria-hidden': 'true' }, 'PERIODO'),
    period, icon('chevron-down', { size: 15, class: 'period-chevron' }));
  period.value = shared.custom ? 'custom' : String(shared.days);
  const customForm = h('form', { class: 'date-range-form', hidden: !shared.custom, onsubmit: event => {
    event.preventDefault();
    const from = fromInput.value, to = toInput.value;
    if (!from || !to || from > to || to > cdmxToday() || Date.parse(to) - Date.parse(from) > 731 * 86400000) {
      notice.textContent = 'Selecciona fechas válidas, sin días futuros, en un intervalo máximo de 2 años.';
      return;
    }
    shared.custom = { from, to }; load(false);
  } }, h('label', {}, 'Desde', fromInput), h('label', {}, 'Hasta', toInput), h('button', { type: 'submit', class: 'btn' }, 'Aplicar fechas'));
  const selectedDates = h('span', { class: 'muted small' });
  const refreshButton = h('button', { type: 'button', class: 'icon-btn refresh-btn', 'aria-label': 'Actualizar', title: 'Actualizar', onclick: () => load(true) }, icon('refresh-cw', { size: 18 }));

  async function load(refresh) {
    const current = ++request;
    const range = shared.custom || rangeFor(shared.days);
    selectedDates.textContent = `${range.from} → ${range.to}`;
    notice.textContent = '';
    if (!refresh) replace(body, h('p', { class: 'muted loading' }, Date.parse(range.to) - Date.parse(range.from) > 90 * 86400000 ? 'Cargando historial… Puede tardar un poco más.' : 'Cargando…'));
    refreshButton.disabled = true;
    const result = refresh ? await ctx.api.post('refresh', { module, ...range }) : await ctx.api.get(endpoint, range);
    if (current !== request) return;
    refreshButton.disabled = false;
    if (!result.ok) {
      if (result.status === 429) notice.textContent = `Espera ${result.data?.retry_after ?? 60} s para volver a actualizar.`;
      else if (refresh) notice.textContent = 'No se pudo actualizar. Intenta de nuevo.';
      if (refresh && body.children.length) return;
      replace(body, h('div', { class: 'card' }, h('p', { class: 'muted' }, result.status === 503
        ? 'El servicio está ocupado. Intenta de nuevo en unos segundos.'
        : 'No se pudieron cargar los datos. Intenta de nuevo.')));
      return;
    }
    destroy();
    const data = result.data;
    stamp.own = { at: data.generated_at, label: null };
    stamp.other = null;
    stamp.source = data.source;
    paintMeta();
    const container = h('div', { class: 'stack' });
    if (data.previous_range === null) container.append(h('p', { class: 'muted small' }, 'Comparación con el periodo anterior no disponible para este intervalo histórico.'));
    draw(container, data, {
      chart: instance => { if (instance) charts.push(instance); return instance; },
      alsoUpdated: (at, ownLabel, otherLabel, source) => {
        if (current !== request || typeof at !== 'string' || Number.isNaN(Date.parse(at))) return;
        stamp.own.label = ownLabel;
        stamp.other = { at, label: otherLabel };
        if (source === 'stale') stamp.source = 'stale';
        paintMeta();
      },
    });
    replace(body, container);
  }

  const root = h('div', { class: 'stack' },
    pageHeader({
      ctx, title,
      // Both wordings are in the DOM; the stylesheet shows the long one on wide screens and the short one on phones.
      subtitle: h('span', {}, h('span', { class: 'sub-long' }, 'Atribución predeterminada de Ads Manager. Cifras en MXN.'), h('span', { class: 'sub-short' }, 'Cifras en MXN · atribución de Ads Manager')),
      actionsClass: 'period-actions', actions: [periodControl, refreshButton],
    }),
    customForm,
    h('div', { class: 'statusline' }, selectedDates, meta, notice),
    body);
  load(false);
  return root;
}

export const badge = (text, kind = 'neutral') => h('span', { class: `badge badge-${kind}` }, text);

// The note under every figure that comes from the pixel: what it counts and what Ads Manager may add on top.
export const webNote = () => h('p', { class: 'web-note small muted' }, WEB_NOTE);

export const provisionalBadge = from => badge(`Provisional desde ${shortDate(from)}`, 'warn');

const STATUS = { ACTIVE: ['Activa', 'good'], PAUSED: ['Pausada', 'neutral'], ARCHIVED: ['Archivada', 'neutral'], DELETED: ['Eliminada', 'neutral'] };
export function statusPill(status) {
  const [label, kind] = STATUS[status] || [status ? 'Otro' : 'N/D', 'neutral'];
  return badge(label, kind);
}

// Real delivery state (computed server-side). Payloads without it fall back to the raw status pill.
const DELIVERY = {
  running: ['En circulación', 'good'], no_delivery: ['Sin entrega reciente', 'warn'], ended: ['Terminado', 'neutral'], paused: ['Pausado', 'neutral'],
};
const RAW = {
  IN_PROCESS: 'En proceso', WITH_ISSUES: 'Con problemas', DISAPPROVED: 'Rechazado', PENDING_REVIEW: 'En revisión', ARCHIVED: 'Archivado', DELETED: 'Eliminado',
};
export function deliveryPill(entity) {
  const state = entity?.delivery;
  if (!state) return statusPill(entity?.status);
  if (DELIVERY[state]) return badge(...DELIVERY[state]);
  return badge(RAW[entity.delivery_raw] || 'Otro', 'neutral');
}

// Renders `cols: [{label, cell(row) => string | Node, num?}]` as a table that collapses to cards on mobile.
// `foot(col) => string | Node` adds a totals row.
// `keepLayout` keeps the real table on phones (it scrolls sideways inside its container) instead of collapsing to cards.
export function table(cols, rows, { empty = 'Sin datos para este periodo.', foot = null, keepLayout = false } = {}) {
  if (!rows.length) return h('p', { class: 'muted' }, empty);
  return h('div', { class: 'table-wrap' }, h('table', { class: keepLayout ? 'table table-keep' : 'table' },
    h('thead', {}, h('tr', {}, cols.map(c => h('th', { class: c.num ? 'num' : null, scope: 'col' }, c.label)))),
    h('tbody', {}, rows.map(row => h('tr', {}, cols.map(c => h('td', { class: c.num ? 'num' : null, 'data-label': c.label }, c.cell(row)))))),
    foot ? h('tfoot', {}, h('tr', {}, cols.map(c => h('td', { class: c.num ? 'num' : null, 'data-label': c.label }, foot(c))))) : null));
}

// Alerts count shared by the sidebar, the tab bar and every page header. The shell sets it; headers follow it.
const alertState = { count: 0, listeners: new Set() };
export const getAlertCount = () => alertState.count;
export function setAlertCount(count) {
  alertState.count = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  for (const fn of [...alertState.listeners]) fn(alertState.count);
}
export function onAlertCount(fn) {
  alertState.listeners.add(fn);
  fn(alertState.count);
  return () => alertState.listeners.delete(fn);
}

// Page header shared by every view: title and subtitle on the left, actions on the right. Unless `bell` is false the
// actions start with a bell that links to Alertas and shows a dot while there are alerts.
export function pageHeader({ ctx = null, title, subtitle = null, actions = [], bell = true, below = null, actionsClass = '' }) {
  const dot = h('span', { class: 'bell-dot' });
  const link = h('a', { class: 'icon-btn bell-btn', href: '/app/#/alertas', 'aria-label': 'Alertas' }, icon('bell', { size: 18 }), dot);
  const off = onAlertCount(count => {
    dot.hidden = count === 0;
    link.setAttribute('aria-label', count ? `Alertas (${count})` : 'Alertas');
  });
  if (ctx?.onCleanup) ctx.onCleanup(off);
  return h('div', { class: 'page-head' },
    h('div', { class: 'page-head-text' },
      h('h1', { class: 'page-title' }, title),
      subtitle ? h('p', { class: 'page-sub muted small' }, subtitle) : null,
      below),
    h('div', { class: `page-actions ${actionsClass}` }, bell ? link : null, actions));
}

// Stat card for the top of Resumen: icon tile and trend icon on the first row, then label, value, the delta against the
// previous period and optional secondary lines. `good` says which direction is favourable ('up', 'down' or null).
export function statCard({ label, icon: iconName, value, current, previous, good, notes = [], showDelta = true }) {
  const d = delta(current, previous);
  const tone = d.dir === null || d.dir === 'flat' || good === null ? 'flat' : d.dir === good ? 'good' : 'bad';
  const arrow = d.dir === 'up' ? '↑ ' : d.dir === 'down' ? '↓ ' : '';
  const trend = d.dir === 'up' ? 'trending-up' : d.dir === 'down' ? 'trending-down' : null;
  return h('div', { class: 'card stat-card' },
    h('div', { class: 'stat-top' },
      h('span', { class: 'icon-tile' }, icon(iconName, { size: 18 })),
      showDelta ? h('span', { class: `stat-trend delta-${tone}` }, trend ? icon(trend, { size: 18 }) : null) : null),
    h('div', { class: 'stat-label' }, label),
    h('div', { class: 'stat-value num' }, value),
    // One line: arrow and percentage (the arrow already says the sign), then a small muted "vs anterior". Callers with no previous period pass showDelta: false.
    showDelta ? h('div', { class: `stat-delta delta-${tone}` },
      h('span', { class: 'stat-delta-value' }, `${arrow}${arrow ? d.text.replace(/^[+-]/, '') : d.text}`),
      h('span', { class: 'stat-vs muted' }, 'vs anterior')) : null,
    notes.filter(Boolean).map(line => h('div', { class: 'stat-note small muted' }, line)));
}

// Purchase funnel in plain language, as full-width rows: label, a bar sized by the share of product visits, and the count.
// Between rows a small connector says how many of the previous step continue ("↓ 28.3% siguen"; capped and footnoted
// above 100%, because checkouts can exceed carts). `funnel` = {content, carts, checkout, purchases, rates:{carts, checkout, purchases}}.
// A bar whose width is set through CSSOM (allowed by the CSP, unlike a style attribute). `pct` is 0 to 100.
export function barFill(className, pct) {
  const bar = h('div', { class: className });
  bar.style.width = `${pct}%`;
  return bar;
}

const barPct = (count, content) => {
  if (typeof count !== 'number' || typeof content !== 'number' || content <= 0 || count <= 0) return 0;
  return Math.min(100, Math.max(1, Math.round((count / content) * 1000) / 10));
};

export function funnelCard(funnel, title = 'Embudo de compra') {
  const steps = [
    { label: 'Visitas a producto (sitio web)', count: funnel.content, all: funnel.content_all, rate: null },
    { label: 'Añadidos al carrito (sitio web)', count: funnel.carts, all: funnel.carts_all, rate: funnel.rates.carts },
    { label: 'Pagos iniciados (sitio web)', count: funnel.checkout, all: funnel.checkout_all, rate: funnel.rates.checkout },
    { label: 'Compras', count: funnel.purchases, rate: funnel.rates.purchases },
  ];
  const capped = steps.some(s => overHundred(s.rate));
  const rows = [];
  steps.forEach((step, i) => {
    if (i > 0) rows.push(h('div', { class: 'funnel-connector small muted' }, h('span', { 'aria-hidden': 'true' }, '↓ '), followText(step.rate)));
    const share = perHundred(step.count, funnel.content);
    const bar = barFill('funnel-bar', barPct(step.count, funnel.content));
    rows.push(h('div', { class: 'funnel-row' },
      h('div', { class: 'funnel-row-label' }, step.label),
      h('div', { class: 'funnel-row-count num' }, int(step.count)),
      h('div', { class: 'funnel-track' }, bar),
      h('div', { class: 'funnel-row-note small muted' }, i === 0 ? 'Punto de partida' : share === null ? ND : `${share} de cada 100 visitas`, allNote(step.count, step.all) ? h('span', { class: 'funnel-all' }, ` · ${allNote(step.count, step.all)}`) : null)));
  });
  return h('div', { class: 'card funnel-card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, title)),
    h('div', { class: 'funnel-rows' }, rows),
    capped ? h('p', { class: 'funnel-footnote small muted' }, DIRECT_BUY_NOTE) : null);
}

// Summary above a chart: `items` = [{ name?, stats: [{ label, value }] }]. A single unnamed item is the usual total and average.
export function chartSummary(items) {
  return h('div', { class: 'chart-summary' }, items.map(item => h('div', { class: 'chart-summary-row' },
    item.name ? h('span', { class: 'chart-summary-name' }, item.name) : null,
    item.stats.map(stat => h('div', { class: 'chart-stat' }, h('span', { class: 'chart-stat-label' }, stat.label), h('span', { class: 'chart-stat-value num' }, stat.value))))));
}

// Legend chip that explains the lighter or dashed days. Callers only add it when the series has provisional days.
export function provisionalChip() {
  return h('span', { class: 'legend-chip' }, h('span', { class: 'legend-swatch', 'aria-hidden': 'true' }), PROVISIONAL_LABEL);
}

// The softer marker for closed days Meta can still adjust a little (D-7 to D-4).
export function adjustableChip() {
  return h('span', { class: 'legend-chip' }, h('span', { class: 'legend-swatch legend-swatch-soft', 'aria-hidden': 'true' }), ADJUSTABLE_LABEL);
}

// Thumbnail with a graceful fallback. Signed CDN URLs expire, so a broken image is replaced by the placeholder.
// The listener is attached with addEventListener: the CSP forbids inline handlers.
export function thumbPlaceholder() {
  return h('div', { class: 'thumb thumb-placeholder', role: 'img', 'aria-label': 'Sin miniatura' }, 'Sin miniatura');
}

export function thumbImage(url, alt) {
  if (!url) return thumbPlaceholder();
  const img = h('img', { class: 'thumb', src: url, alt, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => { img.replaceWith(thumbPlaceholder()); }, { once: true });
  return img;
}
