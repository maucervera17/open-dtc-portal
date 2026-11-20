import { h, replace } from '/app/dom.js';
import { displayName, money, moneyAxis, int, roas, ctrText, cpaText, delta, ND } from '/app/format.js';
import { perHundred, overHundred, allNote, DIRECT_BUY_NOTE, WEB_SUB, PROVISIONAL_NOTE } from '/app/funnel.js';
import { rangeView, statCard, provisionalBadge, chartSummary, provisionalChip, adjustableChip, webNote } from '/app/ui.js';
import { isPhone } from '/app/breakpoints.js';
import { watchResize } from '/app/chart-resize.js';
import { seriesConfig, summaryOf, hasProvisional, chartColors } from '/app/chart-config.js';
import { activityCard } from '/app/views/alertas.js';
import { connectionsCard } from '/app/views/estado.js';

// Metric chips. kind decides the chart: counts and spend are bars, ratios are lines (see chart-config.js).
const METRICS = [
  { key: 'purchases', label: 'Compras', kind: 'count', format: int },
  { key: 'spend', label: 'Inversión', kind: 'money', format: v => money(v, { compact: true }), tickFormat: moneyAxis },
  { key: 'carts', label: 'Carritos (sitio web)', kind: 'count', format: int },
  { key: 'cpa', label: 'CPA', kind: 'ratio', format: v => money(v), overall: 'cpa' },
  { key: 'roas', label: 'ROAS', kind: 'ratio', format: roas, overall: 'roas' },
  { key: 'ctr', label: 'CTR (enlace)', kind: 'ratio', format: ctrText, overall: 'ctr' },
];

function cssVar(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

function seriesChart(container, series, totals, tools) {
  const Chart = globalThis.Chart;
  const box = h('div', { class: 'chart-box' });
  const canvas = h('canvas', { role: 'img', 'aria-label': 'Serie diaria' });
  box.append(canvas);
  const tabs = h('div', { class: 'chips chart-tabs', role: 'group', 'aria-label': 'Métrica' });
  const summary = h('div', { class: 'chart-meta' });
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Tendencia diaria'), tabs), summary, box);
  if (typeof Chart !== 'function') {
    box.replaceChildren(h('p', { class: 'muted' }, 'La gráfica no está disponible en este momento.'));
    container.append(card);
    return;
  }
  const dates = series.map(s => s.date);
  const provisional = series.map(s => Boolean(s.provisional));
  const adjustable = series.map(s => Boolean(s.adjustable) && !s.provisional);
  const colors = chartColors(cssVar);
  let chart = null;
  // A new chart per metric: bars and lines are different chart types, so the old instance is destroyed instead of mutated.
  const show = metric => {
    const values = series.map(s => s[metric.key]);
    const overall = metric.overall ? totals?.[metric.overall] : null;
    if (chart) { try { chart.destroy(); } catch { /* already gone */ } }
    chart = tools.chart(new Chart(canvas, seriesConfig({ label: metric.label, kind: metric.kind, dates, values, provisional, adjustable, format: metric.format, tickFormat: metric.tickFormat, colors, average: overall, compact: isPhone() })));
    replace(summary, chartSummary([{ stats: summaryOf({ kind: metric.kind, values, format: metric.format, overall }) }]), hasProvisional(provisional) ? provisionalChip() : null, hasProvisional(adjustable) ? adjustableChip() : null);
  };
  const buttons = METRICS.map((metric, i) => h('button', {
    type: 'button', class: i === 0 ? 'chip is-active' : 'chip',
    onclick: () => { buttons.forEach((b, j) => { b.className = j === i ? 'chip is-active' : 'chip'; }); show(metric); },
  }, metric.label));
  tabs.append(...buttons);
  show(METRICS[0]);
  tools.chart({ destroy: watchResize(box, () => chart) }); // torn down with the charts
  container.append(card);
}

const stepNote = (count, content) => { const share = perHundred(count, content); return share === null ? ND : `${share} de cada 100 visitas`; };
const withDelta = (text, current, previous) => { const d = delta(current, previous); return d.dir === null ? text : `${text} · ${d.text}`; };

function statsGrid(t, p) {
  return h('div', { class: 'stats-grid' },
    statCard({ label: 'Inversión', icon: 'dollar-sign', value: money(t.spend, { compact: true }), current: t.spend, previous: p.spend, good: null,
      notes: [`CTR (enlace): ${withDelta(ctrText(t.ctr), t.ctr, p.ctr)}`] }),
    statCard({ label: 'Compras', icon: 'shopping-bag', value: int(t.purchases), current: t.purchases, previous: p.purchases, good: 'up',
      notes: [`CPA: ${withDelta(cpaText(t), t.cpa, p.cpa)}`] }),
    statCard({ label: 'ROAS', icon: 'target', value: roas(t.roas), current: t.roas, previous: p.roas, good: 'up',
      notes: [`Ingresos: ${withDelta(money(t.revenue, { compact: true }), t.revenue, p.revenue)}`] }),
    statCard({ label: 'Añadidos al carrito', icon: 'shopping-cart', value: int(t.carts), current: t.carts, previous: p.carts, good: 'up',
      notes: [WEB_SUB, stepNote(t.carts, t.content), allNote(t.carts, t.carts_all)] }));
}

// Quick funnel: each step as a labeled bar sized by its share of product visits (the existing "X out of every 100" numbers).
function funnelQuick(funnel) {
  const steps = [
    { label: 'Visitas a producto (sitio web)', count: funnel.content, all: funnel.content_all },
    { label: 'Añadidos al carrito (sitio web)', count: funnel.carts, all: funnel.carts_all },
    { label: 'Pagos iniciados (sitio web)', count: funnel.checkout, all: funnel.checkout_all },
    { label: 'Compras', count: funnel.purchases },
  ];
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Embudo')),
    h('div', { class: 'funnel' }, steps.map((step, i) => {
      const share = perHundred(step.count, funnel.content);
      const bar = h('div', { class: 'funnel-bar' });
      bar.style.width = `${share === null ? 0 : Math.min(100, Math.max(2, Number(share.replace(/,/g, ''))))}%`;
      return h('div', { class: 'funnel-quick-step' },
        h('div', { class: 'funnel-label' }, h('span', { class: 'funnel-quick-label' }, step.label), h('span', { class: 'num funnel-count' }, int(step.count))),
        h('div', { class: 'funnel-track' }, bar),
        h('div', { class: 'small muted' }, i === 0 ? 'Punto de partida' : stepNote(step.count, funnel.content), allNote(step.count, step.all) ? ` · ${allNote(step.count, step.all)}` : ''));
    })),
    // Checkouts can exceed carts (direct buys); say so instead of showing an impossible step rate.
    [funnel.rates?.carts, funnel.rates?.checkout, funnel.rates?.purchases].some(overHundred) ? h('p', { class: 'small muted' }, DIRECT_BUY_NOTE) : null);
}

function topCampaigns(campaigns) {
  const top = [...campaigns].sort((a, b) => (b.metrics?.spend ?? 0) - (a.metrics?.spend ?? 0)).slice(0, 4);
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Top campañas'), h('a', { class: 'link link-inline', href: '/app/#/campanas' }, 'Ver detalle →')),
    top.length
      ? h('div', { class: 'camp-list' }, top.map(c => h('div', { class: 'camp-row' },
        h('span', { class: 'name' }, displayName(c.name)),
        h('span', { class: 'camp-meta small muted' }, `Inversión ${money(c.metrics.spend)} · Compras ${int(c.metrics.purchases)}`))))
      : h('p', { class: 'muted small' }, 'Sin campañas en este periodo.'));
}

// Draws the sales payload. `activity` is the recent-activity card, loaded by the view so its request starts right away.
function draw(container, data, tools, activity) {
  const t = data.totals, p = data.previous;
  const hasProvisional = data.range.to >= data.provisional_from;
  const chartColumn = h('div', { class: 'stack col-main' });
  seriesChart(chartColumn, data.series, t, tools);
  chartColumn.append(activity);
  const side = h('div', { class: 'stack col-side' }, funnelQuick(data.funnel), topCampaigns(data.campaigns));
  if (hasProvisional) side.append(h('div', { class: 'statusline note-provisional' }, provisionalBadge(data.provisional_from), h('span', { class: 'muted small' }, PROVISIONAL_NOTE)));
  container.append(statsGrid(t, p), webNote(), h('div', { class: 'content-grid' }, chartColumn, side));
}

export default {
  route: 'resumen',
  label: 'Resumen',
  // The sales view is built first, so its request goes out before the alerts one.
  render: ctx => {
    const sales = rangeView({ ctx, title: 'Resumen de ventas', module: 'sales', endpoint: 'sales', draw: (container, data, tools) => draw(container, data, tools, activity) });
    const activity = activityCard(ctx);
    return h('div', { class: 'stack' }, sales, connectionsCard(ctx));
  },
};
