import { h } from '/app/dom.js';
import { shortDate, int, ND } from '/app/format.js';
import { badge, table } from '/app/ui.js';

// "Evolución" card for the Píxel page: the weekly journal rows (computed by the daily job) as four small sparklines and a
// table. Sparklines are plain SVG built with DOM APIs, so nothing here needs inline styles or scripts.
export const SPARK = Object.freeze({ width: 120, height: 32, pad: 3 });
const NS = 'http://www.w3.org/2000/svg';

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const one = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const oneFixed = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const rate = v => (isNum(v) ? one.format(v) : ND);
const money = v => (isNum(v) ? new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(v) : ND);

function svgNode(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

// Consecutive known values become one polyline; a known value alone between gaps becomes a dot; unknown weeks break the line.
export function sparkline(values, { label = 'Tendencia' } = {}) {
  const { width, height, pad } = SPARK;
  const svg = svgNode('svg', { class: 'evo-spark', viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': label, focusable: 'false', preserveAspectRatio: 'none' });
  const known = values.filter(isNum);
  if (!known.length) return svg;
  const min = Math.min(...known), max = Math.max(...known);
  const xAt = i => (values.length === 1 ? width / 2 : pad + (i * (width - 2 * pad)) / (values.length - 1));
  const yAt = v => (max === min ? height / 2 : height - pad - ((v - min) * (height - 2 * pad)) / (max - min));
  const point = (i, v) => `${Math.round(xAt(i) * 100) / 100},${Math.round(yAt(v) * 100) / 100}`;
  let run = [];
  const flush = () => {
    if (run.length > 1) svg.append(svgNode('polyline', { class: 'evo-line', points: run.map(([i, v]) => point(i, v)).join(' '), fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke' }));
    else if (run.length === 1) { const [i, v] = run[0]; svg.append(svgNode('circle', { class: 'evo-dot', cx: Math.round(xAt(i) * 100) / 100, cy: Math.round(yAt(v) * 100) / 100, r: 2.5, fill: 'currentColor' })); }
    run = [];
  };
  values.forEach((v, i) => { if (isNum(v)) run.push([i, v]); else flush(); });
  flush();
  return svg;
}

const valid = row => row && typeof row === 'object' && typeof row.week === 'string' && /^\d{4}-W\d{2}$/.test(row.week) && typeof row.from === 'string' && typeof row.to === 'string';
const weekNumber = row => Number(row.week.slice(-2));
const funnel = row => (row.funnel && typeof row.funnel === 'object' ? row.funnel : {});

const TILES = [
  { label: 'Carrito por cada 100 visitas', pick: r => funnel(r).cart_per_100, text: rate },
  { label: 'Pagos iniciados por cada 100 carritos', pick: r => funnel(r).checkout_per_100, text: rate },
  { label: 'Compras por cada 100 pagos', pick: r => funnel(r).purchase_per_100, text: rate },
  { label: 'Calidad de coincidencia (EMQ)', pick: r => r.emq, text: v => (isNum(v) ? oneFixed.format(v) : ND) },
];

function tile(spec, rows) {
  const values = rows.map(spec.pick);
  const latest = values.at(-1);
  const known = values.filter(isNum);
  const summary = known.length > 1 ? `${spec.label}: de ${spec.text(known[0])} a ${spec.text(known.at(-1))} en ${rows.length} semanas` : spec.label;
  return h('div', { class: 'evo-tile' },
    h('div', { class: 'evo-label small muted' }, spec.label),
    h('div', { class: 'evo-value num' }, spec.text(latest)),
    sparkline(values, { label: summary }));
}

// `weeks`: the rows from GET journal (oldest first). `provisionalFrom`: the first day Meta may still adjust.
// Returns null when the payload is unusable, so the page simply has no card.
export function evolutionCard(weeks, provisionalFrom = null) {
  if (!Array.isArray(weeks)) return null;
  const rows = weeks.filter(valid);
  if (weeks.length && !rows.length) return null;
  const head = h('div', { class: 'card-titles' },
    h('h2', { class: 'card-title' }, 'Evolución semanal'),
    h('p', { class: 'table-caption muted small' }, 'Cifras por semana, calculadas con los datos guardados. La semana en curso todavía puede cambiar.'));
  if (!rows.length) return h('div', { class: 'card evo-card' }, head, h('p', { class: 'muted' }, 'Todavía no hay historial semanal. Aparece cuando termina la primera semana con datos.'));
  const recent = rows.slice(-8);
  const partial = row => typeof provisionalFrom === 'string' && row.to >= provisionalFrom;
  return h('div', { class: 'card evo-card' }, head,
    h('div', { class: 'evo-grid' }, TILES.map(spec => tile(spec, recent))),
    table([
      { label: 'Semana', cell: r => h('span', { class: 'name-cell' }, h('span', { class: 'name' }, `Sem ${weekNumber(r)} · ${shortDate(r.from)}`), partial(r) ? badge('En curso', 'warn') : null) },
      { label: 'Compras', num: true, cell: r => int(r.purchases) },
      { label: 'CPA', num: true, cell: r => money(r.cpa) },
      { label: 'Carrito / 100', num: true, cell: r => rate(funnel(r).cart_per_100) },
      { label: 'Pago / 100', num: true, cell: r => rate(funnel(r).checkout_per_100) },
      { label: 'Compra / 100', num: true, cell: r => rate(funnel(r).purchase_per_100) },
      { label: 'EMQ', num: true, cell: r => (isNum(r.emq) ? oneFixed.format(r.emq) : ND) },
    ], [...recent].reverse()));
}
