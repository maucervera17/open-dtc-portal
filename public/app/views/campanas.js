import { h, replace } from '/app/dom.js';
import { displayName, money, int, roas, percent, ctrText, cpaText, ND } from '/app/format.js';
import { allNote, WEB_SUB } from '/app/funnel.js';
import { rangeView, deliveryPill, provisionalBadge, statCard, webNote } from '/app/ui.js';
import { icon } from '/app/icons.js';

// Meta objective enums in plain Spanish. An unknown value is left out instead of leaking an internal code.
const OBJECTIVES = {
  OUTCOME_SALES: 'Ventas', OUTCOME_LEADS: 'Clientes potenciales', OUTCOME_TRAFFIC: 'Tráfico', OUTCOME_ENGAGEMENT: 'Interacción',
  OUTCOME_AWARENESS: 'Reconocimiento', OUTCOME_APP_PROMOTION: 'Promoción de la app',
};
const SORTS = [
  { key: 'spend', label: 'Inversión' },
  { key: 'purchases', label: 'Compras' },
  { key: 'ctr', label: 'CTR (enlace)' },
];
const METRICS = [
  ['Inversión', m => money(m.spend)],
  ['Impresiones', m => int(m.impressions)],
  ['CTR (enlace)', m => ctrText(m.ctr)],
  ['Carritos (sitio web)', m => int(m.carts)],
  ['Pagos iniciados (sitio web)', m => int(m.checkout)],
  ['Compras', m => int(m.purchases)],
  ['CPA', m => cpaText(m)],
  ['ROAS', m => roas(m.roas)],
];

const metricGrid = (metrics, small = false) => h('div', { class: small ? 'metric-grid metric-grid-sm' : 'metric-grid' },
  METRICS.map(([label, format]) => h('div', { class: 'metric' }, h('span', { class: 'metric-label' }, label), h('span', { class: 'metric-value num' }, format(metrics || {})))));

const sumOf = (list, pick) => {
  const values = list.map(pick).filter(v => typeof v === 'number' && Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
};

// Account totals for the stat cards: the sales route when it answered, otherwise the sum of the campaigns listed below.
function totalsOf(campaigns) {
  const metrics = campaigns.map(c => c.metrics || {});
  const impressions = sumOf(metrics, m => m.impressions);
  const clicks = sumOf(metrics, m => (typeof m.clicks === 'number' ? m.clicks : (typeof m.ctr === 'number' && typeof m.impressions === 'number' ? m.ctr * m.impressions : null)));
  return {
    spend: sumOf(metrics, m => m.spend), purchases: sumOf(metrics, m => m.purchases), carts: sumOf(metrics, m => m.carts),
    ctr: impressions && clicks !== null ? clicks / impressions : null,
  };
}

function statCards(totals, previous) {
  const t = totals || {};
  const p = previous || {};
  return [
    statCard({ label: 'Inversión', icon: 'dollar-sign', value: money(t.spend, { compact: true }), current: t.spend, previous: p.spend, good: null }),
    statCard({ label: 'Compras', icon: 'shopping-bag', value: int(t.purchases), current: t.purchases, previous: p.purchases, good: 'up' }),
    statCard({ label: 'Carritos', icon: 'shopping-cart', value: int(t.carts), current: t.carts, previous: p.carts, good: 'up', notes: [WEB_SUB, allNote(t.carts, t.carts_all)] }),
    statCard({ label: 'CTR (enlace)', icon: 'mouse-pointer-2', value: ctrText(t.ctr), current: t.ctr, previous: p.ctr, good: 'up' }),
  ];
}

let uid = 0;

function adCard(ad) {
  return h('div', { class: 'sub-card sub-ad' },
    h('div', { class: 'sub-head' }, h('span', { class: 'sub-name' }, displayName(ad.name) || ND), deliveryPill(ad)),
    metricGrid(ad.metrics, true));
}

function adsetCard(adset) {
  return h('div', { class: 'sub-card sub-adset' },
    h('div', { class: 'sub-head' }, h('span', { class: 'sub-name' }, displayName(adset.name) || ND)),
    metricGrid(adset.metrics, true),
    adset.ads.length ? h('div', { class: 'sub-children' }, adset.ads.map(adCard)) : h('p', { class: 'muted small' }, 'Sin anuncios con datos en este periodo.'));
}

function campaignCard(c, totalSpend, expanded) {
  const spend = c.metrics?.spend;
  const share = typeof spend !== 'number' ? null : totalSpend > 0 ? spend / totalSpend : 0;
  const bar = h('div', { class: 'funnel-bar' });
  bar.style.width = `${share === null ? 0 : Math.min(100, Math.max(share > 0 ? 2 : 0, share * 100))}%`;
  const objective = OBJECTIVES[c.objective];
  const id = `camp-children-${++uid}`;
  const label = h('span', { class: 'camp-toggle-label' }, 'Ver conjuntos y anuncios');
  const toggle = h('button', { type: 'button', class: 'btn btn-sm camp-toggle', 'aria-expanded': 'false', 'aria-controls': id }, label, icon('chevron-down', { size: 16, class: 'camp-chevron' }));
  const panel = h('div', { class: 'camp-children', id },
    c.adsets.length ? c.adsets.map(adsetCard) : h('p', { class: 'muted small' }, 'Sin conjuntos de anuncios con datos en este periodo.'));
  const paint = open => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    label.textContent = open ? 'Ocultar conjuntos y anuncios' : 'Ver conjuntos y anuncios';
  };
  paint(expanded.has(c.id));
  toggle.addEventListener('click', () => {
    const open = panel.hidden;
    if (open) expanded.add(c.id); else expanded.delete(c.id);
    paint(open);
  });
  return h('div', { class: 'card camp-card' },
    h('div', { class: 'camp-head' },
      h('h2', { class: 'camp-name' }, displayName(c.name) || ND),
      h('div', { class: 'camp-tags' }, deliveryPill(c), objective ? h('span', { class: 'camp-objective muted small' }, objective) : null)),
    h('div', { class: 'camp-share small' },
      h('span', {}, `${share === null ? ND : percent(share)} de la inversión`),
      h('div', { class: 'funnel-track' }, bar)),
    metricGrid(c.metrics),
    toggle,
    panel);
}

const sortValue = (c, key) => (typeof c.metrics?.[key] === 'number' ? c.metrics[key] : -Infinity);

function draw(container, data, tools, ctx, state) {
  if (data.range.to >= data.provisional_from) container.append(h('div', { class: 'statusline' }, provisionalBadge(data.provisional_from)));
  if (!data.campaigns.length) { container.append(h('p', { class: 'muted' }, 'Sin campañas con datos en este periodo.')); return; }

  const totalSpend = sumOf(data.campaigns.map(c => c.metrics || {}), m => m.spend) || 0;
  const grid = h('div', { class: 'stats-grid' }, statCards(totalsOf(data.campaigns), null));
  // Account totals and the previous period come from the existing sales route; the sums above show until it answers.
  Promise.resolve().then(() => ctx.api.get('sales', { from: data.range.from, to: data.range.to })).then(result => {
    if (result?.ok && result.data?.totals) {
      replace(grid, statCards(result.data.totals, result.data.previous));
      // The totals come from another module: say so when its data is older or newer than this list.
      tools.alsoUpdated?.(result.data.generated_at, 'campañas', 'totales', result.data.source);
    }
  }).catch(() => {});

  const list = h('div', { class: 'stack camp-list-cards' });
  const paintList = () => replace(list, [...data.campaigns].sort((a, b) => sortValue(b, state.sort) - sortValue(a, state.sort)).map(c => campaignCard(c, totalSpend, state.expanded)));
  const chips = SORTS.map(sort => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => { state.sort = sort.key; syncChips(); paintList(); } }, sort.label));
  function syncChips() {
    chips.forEach((chip, i) => {
      const active = SORTS[i].key === state.sort;
      chip.className = active ? 'chip is-active' : 'chip';
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  syncChips();
  paintList();
  container.append(grid, webNote(),
    h('div', { class: 'camp-sort' }, h('span', { class: 'muted small' }, 'Ordenar por'), h('div', { class: 'chips chips-fill', role: 'group', 'aria-label': 'Ordenar por' }, chips)),
    list);
}

export default {
  route: 'campanas',
  label: 'Campañas',
  render: ctx => {
    const state = { sort: 'spend', expanded: new Set() };
    return rangeView({ ctx, title: 'Campañas', module: 'campaigns', endpoint: 'campaigns', draw: (container, data, tools) => draw(container, data, tools, ctx, state) });
  },
};
