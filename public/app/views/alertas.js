import { h, replace } from '/app/dom.js';
import { money, int, roas, decimal, dateTime, shortDate, windowRange } from '/app/format.js';
import { badge, pageHeader, setAlertCount } from '/app/ui.js';
import { icon } from '/app/icons.js';
import { reasonText } from '/app/views/estado.js';

// The agent only recommends. Nothing in this view changes anything in Meta, and there is no apply control.
// label: the action pill; count: wording used by the summary header; tone: badge colour (existing tokens).
const ACTIONS = {
  STOP: { label: 'Pausar', tone: 'bad' },
  REPLACE_CREATIVE: { label: 'Cambiar creativo', tone: 'warn' },
  SCALE: { label: 'Escalar', tone: 'good' },
  WATCH: { label: 'Vigilar', tone: 'neutral' },
  CONTINUE: { label: 'Seguir', tone: 'neutral' },
};
const CONFIDENCE = { low: ['Baja', 1], medium: ['Media', 2], high: ['Alta', 3] };
const PRIORITY = ['STOP', 'REPLACE_CREATIVE', 'SCALE', 'WATCH', 'CONTINUE'];
const METRICS = {
  cpa: ['CPA', money], spend: ['Inversión', money], revenue: ['Ingresos', money], roas: ['ROAS', roas], purchases: ['Compras', int],
  impressions: ['Impresiones', int], frequency: ['Frecuencia', decimal], ctr_pct: ['CTR (enlace)', v => `${decimal(v)}%`],
};
// Objective groups, in display order. label heads a group, chip tags a card, kpi turns the stored KPIs into the header summary.
const plural = (n, one, many) => `${int(n)} ${n === 1 ? one : many}`;
const has = v => typeof v === 'number' && Number.isFinite(v);
const OBJECTIVES = {
  sales: { label: 'Ventas', chip: 'Ventas', kpi: k => [has(k.purchases) && plural(k.purchases, 'compra', 'compras'), has(k.cpa) && `CPA ${money(k.cpa)}`, has(k.roas) && `ROAS ${roas(k.roas)}`] },
  traffic_site: { label: 'Tráfico al sitio', chip: 'Tráfico al sitio', kpi: k => [has(k.link_clicks) && plural(k.link_clicks, 'clic', 'clics'), has(k.cpc) && `${money(k.cpc)} por clic`, has(k.landing_page_views) && plural(k.landing_page_views, 'visita a la página', 'visitas a la página')] },
  profile_growth: { label: 'Crecimiento de perfil / seguidores', chip: 'Perfil / seguidores', kpi: k => [has(k.profile_visits) && plural(k.profile_visits, 'visita al perfil', 'visitas al perfil'), has(k.cost_per_profile_visit) && `${money(k.cost_per_profile_visit)} por visita`, has(k.follows) && plural(k.follows, 'seguimiento', 'seguimientos')] },
  engagement: { label: 'Interacción', chip: 'Interacción', kpi: k => [has(k.interactions) && plural(k.interactions, 'interacción', 'interacciones'), has(k.cost_per_interaction) && `${money(k.cost_per_interaction)} por interacción`] },
  leads: { label: 'Clientes potenciales', chip: 'Clientes potenciales', kpi: () => [] },
  awareness: { label: 'Reconocimiento', chip: 'Reconocimiento', kpi: k => [has(k.impressions) && plural(k.impressions, 'impresión', 'impresiones'), has(k.cpm) && `CPM ${money(k.cpm)}`] },
  other: { label: 'Otras campañas', chip: 'Otras', kpi: () => [] },
};
const OBJECTIVE_ORDER = Object.keys(OBJECTIVES);
export const objectiveOf = rec => (Object.hasOwn(OBJECTIVES, rec?.objective_group) ? rec.objective_group : 'other');
const objectiveChip = rec => h('span', { class: 'badge badge-info objective-chip' }, OBJECTIVES[objectiveOf(rec)].chip);
const kpiLine = entry => {
  const parts = OBJECTIVES[entry?.group]?.kpi(entry?.kpis || {}).filter(Boolean) || [];
  if (!parts.length && has(entry?.spend)) parts.push(`${money(entry.spend)} invertidos`);
  return parts.join(' · ');
};
const actionLabel = action => (ACTIONS[action] || { label: String(action || 'N/D') }).label;
const byPriority = (a, b) => PRIORITY.indexOf(a.action) - PRIORITY.indexOf(b.action);

// A plain next step for each action. The agent never applies anything: these are instructions for the person reading.
function nextStep(rec) {
  const thing = rec.entity_type === 'ad' ? 'este anuncio' : 'esta campaña';
  switch (rec.action) {
    case 'STOP': return `Pausa ${thing} en Ads Manager y revisa cómo queda en la fecha indicada.`;
    case 'REPLACE_CREATIVE': return 'Sube un creativo nuevo para este anuncio y pausa el actual cuando el nuevo ya esté corriendo.';
    case 'SCALE': return 'Sube el presupuesto un 20% o menos y espera a la fecha de revisión antes de subirlo otra vez.';
    case 'CONTINUE': return `Déjal${rec.entity_type === 'ad' ? 'o' : 'a'} como está: va bien.`;
    default: return 'No cambies nada por ahora; vuelve a revisarlo en la fecha indicada.';
  }
}

// Fallback for "Por qué" when the agent gave no evidence lines: the cited metrics, with formatted numbers.
function metricLine({ path, value }, windows) {
  const m = /(?:^|\.)([CB])\.([a-z_]+)$/.exec(String(path));
  const spec = m && METRICS[m[2]];
  if (!spec) return `${path}: ${decimal(value)}`;
  const span = windows?.[m[1]] ? windowRange(windows[m[1]].from, windows[m[1]].to) : null;
  return `${spec[0]} (${span && span !== 'N/D' ? span : m[1] === 'C' ? 'esta semana' : 'la semana anterior'}): ${spec[1](value)}`;
}

// The two windows an alert compares, in dates ("21–27 sep vs 14–20 sep"). Null for runs stored before the windows were kept.
const comparisonText = windows => {
  const [c, b] = [windows?.C, windows?.B].map(w => (w ? windowRange(w.from, w.to) : 'N/D'));
  return c !== 'N/D' && b !== 'N/D' ? `Comparación: ${c} vs ${b}` : null;
};

const reasons = (rec, windows) => (Array.isArray(rec.evidence) && rec.evidence.length ? rec.evidence : (Array.isArray(rec.cited_metrics) ? rec.cited_metrics.map(metric => metricLine(metric, windows)) : []));
const reviewText = rec => (rec.review_after ? `Revisar el ${shortDate(rec.review_after)}` : `Revisar en ${rec.review_after_days} días`);

const block = (title, ...content) => h('section', { class: 'alert-block' }, h('h3', { class: 'alert-block-title' }, title), content);

function confidenceMeter(confidence) {
  const [label, level] = CONFIDENCE[confidence] || ['N/D', 0];
  return h('span', { class: 'alert-confidence' },
    h('span', { class: 'meter', role: 'img', 'aria-label': `Confianza: ${label}` }, [1, 2, 3].map(n => h('span', { class: n <= level ? 'meter-seg is-on' : 'meter-seg' }))),
    h('span', { class: 'small muted' }, `Confianza ${label}`));
}

export const idOf = rec => rec?.id ?? `${rec?.entity_type}:${rec?.entity_id}`;

// ctrl: { isRead(rec), toggle(rec) (the explicit button), open(rec) (the card was expanded), track(id, sync) }.
function recommendationCard(rec, ctrl) {
  const action = ACTIONS[rec.action] || { label: String(rec.action || 'N/D'), tone: 'neutral' };
  const isAd = rec.entity_type === 'ad';
  const lines = reasons(rec, ctrl.windows);
  const comparison = comparisonText(ctrl.windows);
  const readButton = h('button', { type: 'button', class: 'btn btn-ghost alert-read-btn', onclick: () => ctrl.toggle(rec) });
  const more = h('details', { class: 'alert-more', ontoggle: () => { if (more.open === true) ctrl.open(rec); } },
    h('summary', { class: 'alert-more-summary' }, 'Ver detalle'),
    block('Por qué', lines.length ? h('ul', { class: 'alert-why' }, lines.map(line => h('li', {}, line))) : h('p', { class: 'small muted' }, 'Sin más detalle.')),
    block('Qué hacer', h('p', {}, nextStep(rec))));
  const card = h('div', { class: 'card alert-card' },
    h('div', { class: 'alert-top' },
      h('div', { class: 'alert-entity' }, badge(action.label, action.tone), h('span', { class: 'alert-entity-name name' }, rec.entity_name || rec.entity_id || 'N/D'), h('span', { class: 'muted small' }, isAd ? 'Anuncio' : 'Campaña'), objectiveChip(rec)),
      h('a', { class: 'link link-inline', href: isAd ? '/app/#/creativos' : '/app/#/campanas' }, isAd ? 'Ver en Creativos →' : 'Ver en Campañas →')),
    rec.guardrail ? h('p', { class: 'small muted' }, `Ajustada a Vigilar por una regla de seguridad (propuesta original: ${actionLabel(rec.original_action)}).`) : null,
    block('Qué pasa', h('p', {}, rec.rationale)),
    comparison ? h('p', { class: 'alert-window small muted' }, comparison) : null,
    more,
    h('div', { class: 'alert-foot' }, confidenceMeter(rec.confidence), h('span', { class: 'small muted' }, reviewText(rec)), readButton));
  // Colour and read state follow the live state, so a toggle never needs the whole list rebuilt.
  const sync = () => {
    const read = ctrl.isRead(rec);
    card.className = `card alert-card alert-${action.tone}${read ? ' is-read' : ''}`;
    const label = read ? 'Marcar como no leída' : 'Marcar como leída';
    readButton.setAttribute('aria-label', label);
    replace(readButton, icon(read ? 'rotate-ccw' : 'check', { size: 16 }), h('span', {}, label));
  };
  sync();
  ctrl.track(idOf(rec), sync);
  return card;
}

// "3 recomendaciones hoy: 0 para pausar · 0 cambiar creativo · 3 vigilar". Escalar and seguir only show when there are some.
function headline(recs) {
  const n = action => recs.filter(r => r.action === action).length;
  const parts = [`${n('STOP')} para pausar`, `${n('REPLACE_CREATIVE')} cambiar creativo`];
  if (n('SCALE')) parts.push(`${n('SCALE')} para escalar`);
  parts.push(`${n('WATCH')} vigilar`);
  if (n('CONTINUE')) parts.push(`${n('CONTINUE')} seguir`);
  return `${recs.length} ${recs.length === 1 ? 'recomendación' : 'recomendaciones'} hoy: ${parts.join(' · ')}`;
}

// How far the data goes: the day the run was made and, when known, the last closed day inside the comparison.
const asOfText = run => `Datos al ${shortDate(run.date)}${run.windows?.C?.to ? ` · cierre hasta el ${shortDate(run.windows.C.to)}` : ''}`;

const hasItems = run => run && run.status === 'ok' && Array.isArray(run.recommendations) && run.recommendations.length > 0;

// Shown when the agent cannot run, so an empty list is never mistaken for "nothing to recommend".
function agentOffCard(agent) {
  const [what, next] = reasonText({ reason: agent.reason, provider: agent.provider });
  return h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Agente apagado'), badge('○ No configurado', 'neutral')),
    h('p', {}, what), agent.model ? h('p', { class: 'small muted' }, `Modelo: ${agent.model}`) : null, next ? h('p', { class: 'small' }, `Siguiente paso: ${next}`) : null);
}

function technicalDetails(run) {
  const line = `Ejecución del ${shortDate(run.date)} · Generada ${dateTime(run.generated_at)} · Modelo ${run.model || 'N/D'}${run.served_by && run.served_by !== run.model ? ` (respondió ${run.served_by})` : ''} · Playbook ${run.playbook_version || 'N/D'}${run.skill_version ? ` · Guía ${run.skill_version}` : ''}`;
  return h('details', { class: 'card tech-details' }, h('summary', { class: 'tech-summary' }, 'Detalles técnicos'), h('p', { class: 'muted small' }, line));
}

function drawRun(data, ctx) {
  const run = data?.run;
  const off = data?.agent?.reason ? agentOffCard(data.agent) : null;
  if (off && !hasItems(run)) return h('div', { class: 'stack' }, off);
  const notice = h('p', { class: 'muted small' }, 'El agente solo recomienda: nunca aplica cambios en Meta. Las decisiones son de quien revisa el panel.');
  if (!hasItems(run)) {
    return h('div', { class: 'stack' }, notice, h('div', { class: 'card' }, h('h2', { class: 'card-title' }, 'Sin recomendaciones hoy'),
      h('p', { class: 'muted' }, run ? 'La última ejecución no produjo recomendaciones.' : 'Aún no hay ejecuciones del agente.'),
      data?.agent?.model ? h('p', { class: 'small muted' }, `Modelo: ${data.agent.model}`) : null));
  }

  const recs = [...run.recommendations].sort(byPriority);
  const entries = Array.isArray(run.objectives) ? run.objectives : [];
  let filter = 'ALL';
  let objective = 'ALL';
  let readOpen = false;
  let read = new Set(Array.isArray(data.read) ? data.read : []);
  const pinned = new Set(); // opened while unread: they stay in place (already counted as read) until the list is next repainted
  const syncs = new Map();
  const isRead = rec => read.has(idOf(rec));
  const unread = () => recs.filter(r => !isRead(r)).length;

  const list = h('div', { class: 'stack alert-groups' });
  const readBox = h('div', { class: 'alerts-read-box' });
  const status = h('p', { class: 'alerts-status small', role: 'status' });
  const unreadLine = h('p', { class: 'alerts-unread muted' });
  const actions = h('div', { class: 'alerts-actions' });

  const ctrl = {
    windows: run.windows,
    isRead,
    track: (id, sync) => syncs.set(id, sync),
    toggle: rec => { change([idOf(rec)], !isRead(rec), { settle: true }); },
    open: rec => { if (!isRead(rec)) { pinned.add(idOf(rec)); change([idOf(rec)], true, { settle: false }); } },
  };

  function paintSummary() {
    const n = unread();
    replace(unreadLine, n === 0 ? 'Todo al día: no tienes alertas sin leer.' : `${n} ${n === 1 ? 'alerta sin leer' : 'alertas sin leer'} de ${recs.length}.`);
    replace(actions, n > 0 ? h('button', { type: 'button', class: 'btn btn-ghost alerts-read-all', onclick: () => change(recs.filter(r => !isRead(r)).map(idOf), true, { settle: true, all: true }) }, icon('check', { size: 16 }), h('span', {}, 'Marcar todas como leídas')) : null);
  }

  function paintList() {
    syncs.clear();
    const visible = recs.filter(r => (filter === 'ALL' || r.action === filter) && (objective === 'ALL' || objectiveOf(r) === objective));
    const inList = visible.filter(r => !isRead(r) || pinned.has(idOf(r)));
    const folded = visible.filter(r => isRead(r) && !pinned.has(idOf(r)));
    replace(list, OBJECTIVE_ORDER.filter(group => inList.some(r => objectiveOf(r) === group)).map(group => {
      const items = inList.filter(r => objectiveOf(r) === group);
      const kpi = kpiLine(entries.find(e => e.group === group));
      return h('section', { class: 'stack alert-group' },
        h('div', { class: 'alert-group-head' },
          h('h2', { class: 'alert-group-title' }, OBJECTIVES[group].label),
          h('span', { class: 'alert-group-count small muted' }, `${items.length} ${items.length === 1 ? 'alerta' : 'alertas'}`),
          kpi ? h('p', { class: 'alert-group-kpi small muted' }, kpi) : null),
        items.map(r => recommendationCard(r, ctrl)));
    }));
    replace(readBox, folded.length ? h('details', { class: 'alerts-read', open: readOpen, ontoggle: event => { readOpen = event.target?.open === true; } },
      h('summary', { class: 'alerts-read-summary' }, `Leídas (${folded.length})`),
      h('div', { class: 'stack alerts-read-list' }, folded.map(r => recommendationCard(r, ctrl)))) : null);
  }

  // Optimistic: the page, the count and the badges move first; a failed save puts everything back and says so.
  async function change(ids, value, { settle, all = false }) {
    const before = new Set(read);
    for (const id of ids) { if (value) read.add(id); else { read.delete(id); pinned.delete(id); } }
    replace(status, '');
    publish();
    if (settle) { pinned.clear(); paintList(); } else for (const id of ids) syncs.get(id)?.();
    paintSummary();
    let result = null;
    try {
      result = await ctx.api.post(all ? 'alerts/read-all' : value ? 'alerts/read' : 'alerts/unread', all ? { date: run.date } : { date: run.date, ids });
    } catch { result = null; }
    if (result?.ok) {
      if (Array.isArray(result.data?.read)) read = new Set(result.data.read);
      publish(); paintSummary();
      return;
    }
    read = before;
    pinned.clear();
    publish(); paintList(); paintSummary();
    replace(status, 'No se pudo guardar. Intenta de nuevo.');
  }
  const publish = () => setAlertCount(unread());

  const actionChoices = [['ALL', `Todas (${recs.length})`], ...PRIORITY.filter(a => recs.some(r => r.action === a)).map(a => [a, `${actionLabel(a)} (${recs.filter(r => r.action === a).length})`])];
  const present = OBJECTIVE_ORDER.filter(group => recs.some(r => objectiveOf(r) === group));
  const objectiveChoices = present.length > 1 ? [['ALL', `Todos los objetivos (${recs.length})`], ...present.map(g => [g, `${OBJECTIVES[g].chip} (${recs.filter(r => objectiveOf(r) === g).length})`])] : [];
  const rowOf = (choices, current, set) => {
    const buttons = choices.map(([value, text]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => { set(value); pinned.clear(); syncAll(); paintList(); } }, text));
    return { buttons, choices, current };
  };
  const rows = [rowOf(actionChoices, () => filter, v => { filter = v; }), rowOf(objectiveChoices, () => objective, v => { objective = v; })];
  function syncAll() {
    for (const row of rows) row.buttons.forEach((chipEl, i) => {
      const active = row.choices[i][0] === row.current();
      chipEl.className = active ? 'chip is-active' : 'chip';
      chipEl.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
  }
  syncAll();
  paintList();
  paintSummary();
  publish();
  const chips = rows[0].buttons;

  return h('div', { class: 'stack' },
    off,
    h('div', { class: 'card alerts-summary' },
      h('h2', { class: 'alerts-headline' }, headline(recs)),
      h('p', { class: 'alerts-asof small muted' }, asOfText(run)),
      run.summary ? h('p', { class: 'muted' }, run.summary) : null,
      h('div', { class: 'alerts-unread-row' }, unreadLine, actions),
      status,
      h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por acción' }, chips),
      rows[1].buttons.length ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Filtrar por objetivo' }, rows[1].buttons) : null),
    notice,
    list,
    readBox,
    Array.isArray(run.data_gaps) && run.data_gaps.length ? h('div', { class: 'card' }, h('h2', { class: 'card-title' }, 'Limitaciones de los datos'), h('ul', { class: 'evidence-list' }, run.data_gaps.map(gap => h('li', { class: 'evidence-line' }, gap)))) : null,
    technicalDetails(run));
}

// Number of UNREAD alerts from an `alerts` API result (the sidebar badge, the bell and the menu dot). No read list: all unread.
export function alertCount(result) {
  const run = result?.ok ? result.data?.run : null;
  if (!hasItems(run)) return 0;
  const read = new Set(Array.isArray(result.data.read) ? result.data.read : []);
  return run.recommendations.filter(r => !read.has(idOf(r))).length;
}

// Icon and tone per action, for the activity feed tiles.
const ACTION_TILE = { STOP: ['alert-triangle', 'bad'], REPLACE_CREATIVE: ['refresh-cw', 'warn'], SCALE: ['trending-up', 'good'], WATCH: ['eye', 'neutral'], CONTINUE: ['check-circle', 'neutral'] };

function activityRow(rec) {
  const [iconName, tone] = ACTION_TILE[rec.action] || ['eye', 'neutral'];
  const label = actionLabel(rec.action);
  return h('div', { class: 'activity-row' },
    h('span', { class: `icon-tile tone-${tone}` }, icon(iconName, { size: 18 })),
    h('div', { class: 'activity-body' },
      h('div', { class: 'activity-title' }, label),
      h('p', { class: 'activity-text small muted' }, rec.rationale),
      h('div', { class: 'activity-meta small muted' }, `Recomendación · ${rec.entity_type === 'ad' ? 'Anuncio' : 'Campaña'}: `, h('span', { class: 'name' }, rec.entity_name || rec.entity_id || 'N/D'), ' ', objectiveChip(rec))));
}

// "Actividad reciente" for Resumen: the top agent recommendations as rows. A failed call or an empty run says so calmly.
export function activityCard(ctx, { limit = 3 } = {}) {
  const body = h('div', { class: 'activity-list' }, h('p', { class: 'muted small' }, 'Cargando…'));
  const card = h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Actividad reciente'), h('a', { class: 'link link-inline', href: '/app/#/alertas' }, 'Ver todas →')),
    body);
  const empty = () => replace(body, h('p', { class: 'muted small' }, 'Sin actividad reciente del agente.'));
  Promise.resolve(ctx.api.get('alerts', {})).then(result => {
    const run = result?.ok ? result.data?.run : null;
    if (!hasItems(run)) return empty();
    const top = [...run.recommendations].sort(byPriority).slice(0, limit);
    replace(body, top.map(activityRow));
  }).catch(empty);
  return card;
}

export default {
  route: 'alertas',
  label: 'Alertas',
  render(ctx) {
    const body = h('div', { class: 'stack' }, h('p', { class: 'muted loading' }, 'Cargando…'));
    const root = h('div', { class: 'stack' },
      pageHeader({ ctx, title: 'Alertas', subtitle: 'Recomendaciones diarias del agente de optimización.', bell: false }),
      body);
    Promise.resolve(ctx.api.get('alerts', {})).then(result => {
      replace(body, result?.ok
        ? drawRun(result.data, ctx)
        : h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No se pudieron cargar las alertas. Intenta de nuevo.')));
    }).catch(() => replace(body, h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No se pudieron cargar las alertas. Intenta de nuevo.'))));
    return root;
  },
};
