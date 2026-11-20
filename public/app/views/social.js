import { h, replace } from '/app/dom.js';
import { displayName, int, percent, shortDate, timeOf, dateTime, truncate } from '/app/format.js';
import { badge, table, thumbImage, pageHeader, chartSummary, provisionalChip, adjustableChip, PRESETS } from '/app/ui.js';
import { coverageText } from '/app/funnel.js';
import { isPhone } from '/app/breakpoints.js';
import { watchResize } from '/app/chart-resize.js';
import { groupedBarsConfig, levelLineConfig, summaryOf, hasProvisional, chartColors } from '/app/chart-config.js';

const UNAVAILABLE = 'No disponible';
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const show = (v, format = int) => (isNum(v) ? format(v) : UNAVAILABLE);
const signed = v => (isNum(v) ? `${v > 0 ? '+' : ''}${int(v)}` : UNAVAILABLE);
const has = values => values.some(isNum);
const INSTAGRAM_LINK = /^https:\/\/www\.instagram\.com\//;
const CAPTION_MAX = 120;
const DAY_MS = 86400000;

function cssVar(name, fallback) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; } catch { return fallback; }
}

function kpi(label, value, note) {
  return h('div', { class: 'card kpi' },
    h('div', { class: 'kpi-label' }, label),
    h('div', { class: 'kpi-value num' }, value),
    note ? h('div', { class: 'kpi-delta muted' }, note) : null);
}

// Chart card. Charts need Chart.js; a missing library or a series with no numbers degrades on its own. Above the chart sit the
// summary (total and daily average) and, when some days are still provisional, the legend chip that explains the lighter bars.
function chartCard({ title, hint, available, config, summary, provisional, adjustable = [] }, tools) {
  const box = h('div', { class: 'chart-box' });
  const Chart = globalThis.Chart;
  const card = h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, title), hint ? h('span', { class: 'muted small' }, hint) : null));
  if (!available) box.replaceChildren(h('p', { class: 'muted' }, `${UNAVAILABLE}: todavía no hay datos para esta gráfica.`));
  else if (typeof Chart !== 'function') box.replaceChildren(h('p', { class: 'muted' }, 'La gráfica no está disponible en este momento.'));
  else {
    const canvas = h('canvas', { role: 'img', 'aria-label': title });
    box.append(canvas);
    card.append(h('div', { class: 'chart-meta' }, chartSummary(summary()), hasProvisional(provisional) ? provisionalChip() : null, hasProvisional(adjustable) ? adjustableChip() : null));
    let chart = tools.chart(new Chart(canvas, config()));
    tools.chart({ destroy: watchResize(box, () => chart) });
  }
  card.append(box);
  return card;
}

const oneDecimal = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const dayCount = (from, to) => Math.max(1, Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS));

function charts(container, data, tools) {
  const series = data.series;
  const dates = series.map(s => s.date);
  const provisional = series.map(s => Boolean(s.provisional));
  const adjustable = series.map(s => Boolean(s.adjustable) && !s.provisional);
  const colors = chartColors(cssVar);
  const c2 = cssVar('--chart-2', '#0f9d58'), c3 = cssVar('--chart-3', '#b7791f');
  const bad = cssVar('--bad', '#d93025');
  const points = data.followers;
  const countSummary = (name, values) => ({ name, stats: summaryOf({ kind: 'count', values, format: int }) });
  const flows = [
    { label: 'Nuevos seguidores', values: series.map(s => s.follows), color: c2 },
    { label: 'Bajas', values: series.map(s => s.unfollows), color: bad },
    { label: 'Neto', values: series.map(s => s.net), color: colors.main },
  ];
  const reach = [
    { label: 'Alcance', values: series.map(s => s.reach), color: colors.main },
    { label: 'Interacciones', values: series.map(s => s.total_interactions), color: c2 },
    { label: 'Cuentas interactuando', values: series.map(s => s.accounts_engaged), color: c3 },
  ];
  const change = data.followers_change;
  // The change is between the first and the last capture: say which dates, they are not always the ends of the period.
  const spanText = data.followers_change_from && data.followers_change_to ? ` del ${shortDate(data.followers_change_from)} al ${shortDate(data.followers_change_to)}` : null;
  const span = points.length >= 2 ? dayCount(points[0].date, points.at(-1).date) : null;

  container.append(
    chartCard({
      title: 'Seguidores', hint: isNum(change) ? `Cambio en el periodo: ${signed(change)}${spanText ? ` (${spanText.trim()})` : ''}` : 'Se guarda una captura por día desde la primera ejecución',
      available: points.length >= 1, provisional: points.map(p => Boolean(p.provisional)), adjustable: points.map(p => Boolean(p.adjustable) && !p.provisional),
      summary: () => [{ stats: [
        { label: 'Cambio en el periodo', value: isNum(change) ? signed(change) : UNAVAILABLE },
        { label: 'Promedio diario', value: isNum(change) && span ? `${change > 0 ? '+' : ''}${oneDecimal.format(change / span)}` : UNAVAILABLE },
      ] }],
      config: () => levelLineConfig({ label: 'Seguidores', dates: points.map(p => p.date), values: points.map(p => p.count), provisional: points.map(p => Boolean(p.provisional)), adjustable: points.map(p => Boolean(p.adjustable) && !p.provisional), format: int, colors, compact: isPhone() }),
    }, tools),
    chartCard({
      title: 'Nuevos seguidores y bajas por día',
      available: has(series.map(s => s.follows)) || has(series.map(s => s.unfollows)), provisional, adjustable,
      summary: () => flows.map(f => countSummary(f.label, f.values)),
      config: () => groupedBarsConfig({ dates, provisional, adjustable, series: flows, format: int, colors, compact: isPhone() }),
    }, tools),
    chartCard({
      title: 'Alcance e interacciones',
      available: has(series.map(s => s.reach)) || has(series.map(s => s.total_interactions)) || has(series.map(s => s.accounts_engaged)), provisional, adjustable,
      summary: () => reach.map(r => countSummary(r.label, r.values)),
      config: () => groupedBarsConfig({ dates, provisional, adjustable, series: reach, format: int, colors, compact: isPhone() }),
    }, tools));
}

function kpis(data) {
  const t = data.totals;
  const current = isNum(data.profile?.followers_count) ? data.profile.followers_count : data.followers.at(-1)?.count;
  return h('div', { class: 'kpis kpis-social' },
    kpi('Seguidores', show(current), isNum(data.followers_change) ? `${signed(data.followers_change)}${data.followers_change_from && data.followers_change_to ? ` del ${shortDate(data.followers_change_from)} al ${shortDate(data.followers_change_to)}` : ' en el periodo'}` : 'Sin cambio calculable'),
    kpi('Nuevos seguidores', show(t.follows)),
    kpi('Bajas', show(t.unfollows)),
    kpi('Altas − bajas (Instagram)', show(t.net, signed), 'Meta calcula altas y bajas por separado; puede no coincidir con el total de seguidores.'),
    kpi('Alcance', show(t.reach), 'Suma del alcance diario'),
    kpi('Me gusta', show(t.likes)),
    kpi('Interacciones', show(t.total_interactions)),
    kpi('Cuentas interactuando', show(t.accounts_engaged)),
    kpi('Tasa de interacción', show(t.engagement_rate, percent), 'Interacciones / alcance diario'));
}

function dailyTable(series) {
  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Por día')),
    table([
      { label: 'Fecha', cell: s => h('span', { class: 'name-cell' }, h('span', { class: 'name' }, shortDate(s.date)), s.provisional ? badge('Provisional', 'warn') : null, s.adjustable && !s.provisional ? badge('Puede ajustarse', 'neutral') : null) },
      { label: 'Alcance', num: true, cell: s => show(s.reach) },
      { label: 'Me gusta', num: true, cell: s => show(s.likes) },
      { label: 'Interacciones', num: true, cell: s => show(s.total_interactions) },
      { label: 'Tasa', num: true, cell: s => show(s.engagement_rate, percent) },
      { label: 'Nuevos', num: true, cell: s => show(s.follows) },
      { label: 'Bajas', num: true, cell: s => show(s.unfollows) },
      { label: 'Neto', num: true, cell: s => show(s.net, signed) },
    ], [...series].reverse(), { keepLayout: true }));
}

function thumbnail(post) {
  const url = post.thumbnail_url;
  return thumbImage(url, 'Publicación de Instagram');
}

const POST_METRICS = [['views', 'Visualizaciones'], ['reach', 'Alcance'], ['likes', 'Me gusta'], ['comments', 'Comentarios'], ['shares', 'Compartidos'], ['saved', 'Guardados'], ['total_interactions', 'Interacciones']];
const TYPES = { IMAGE: 'Imagen', VIDEO: 'Video', CAROUSEL_ALBUM: 'Carrusel' };

function postCard(post, generatedAt) {
  const caption = displayName(post.caption);
  const age = Date.parse(generatedAt) - Date.parse(String(post.timestamp ?? '').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  const fresh = Number.isFinite(age) && age < 2 * DAY_MS;
  const metrics = post.metrics || {};
  return h('div', { class: 'card creative' },
    thumbnail(post),
    h('div', { class: 'creative-body' },
      h('div', { class: 'name-cell' },
        badge(TYPES[post.media_type] || 'Publicación'),
        fresh ? badge('Provisional', 'warn') : null,
        h('span', { class: 'muted small' }, dateTime(post.timestamp))),
      h('p', { class: 'name' }, caption ? truncate(caption, CAPTION_MAX) : 'Sin texto'),
      h('ul', { class: 'evidence-list' }, POST_METRICS.map(([key, label]) => h('li', { class: 'evidence-line' }, h('span', { class: 'muted' }, label), h('span', { class: 'num' }, show(metrics[key]))))),
      typeof post.permalink === 'string' && INSTAGRAM_LINK.test(post.permalink)
        ? h('a', { class: 'link', href: post.permalink, target: '_blank', rel: 'noopener noreferrer' }, 'Ver en Instagram') : null));
}

function postsSection(data) {
  const head = () => h('div', { class: 'card-head' }, h('h2', { class: 'card-title' }, 'Publicaciones recientes'), h('span', { class: 'muted small' }, 'Ordenadas por visualizaciones'));
  if (data.posts_status !== 'ok' || !Array.isArray(data.posts)) {
    return h('div', { class: 'card' }, head(), h('p', { class: 'muted' }, `${UNAVAILABLE}: Instagram no devolvió las publicaciones en este momento.`));
  }
  if (!data.posts.length) return h('div', { class: 'card' }, head(), h('p', { class: 'muted' }, 'Todavía no hay publicaciones recientes.'));
  return h('div', { class: 'stack' }, head(), h('div', { class: 'creative-grid' }, data.posts.map(post => postCard(post, data.generated_at))));
}

function draw(container, data, tools) {
  container.append(kpis(data));
  const gap = coverageText(data.days_covered, data.days_expected);
  if (gap) container.append(h('p', { class: 'coverage-note small muted' }, `Solo hay datos de ${gap} en este periodo.`));
  if (data.range && data.range.to >= data.provisional_from) {
    container.append(h('div', { class: 'statusline' }, badge('Provisional', 'warn'), h('span', { class: 'muted small' }, 'Las cifras de las últimas 48 horas (más claras en las gráficas) pueden cambiar cuando Instagram termine de procesarlas.')));
  }
  charts(container, data, tools);
  container.append(dailyTable(data.series), postsSection(data));
}

export default {
  route: 'social',
  label: 'Redes',
  render(ctx) {
    let days = 14;
    let request = 0;
    let instances = [];
    const destroy = () => { for (const chart of instances) { try { chart.destroy(); } catch { /* already gone */ } } instances = []; };
    ctx.onCleanup(destroy);
    const body = h('div', { class: 'stack' });
    const meta = h('span', { class: 'muted small' });
    const chips = PRESETS.map(value => h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onclick: () => { days = value; sync(); load(); } }, `${value} días`));
    function sync() {
      chips.forEach((chip, i) => {
        const active = PRESETS[i] === days;
        chip.className = active ? 'chip is-active' : 'chip';
        chip.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    async function load() {
      const current = ++request;
      replace(body, h('p', { class: 'muted loading' }, 'Cargando…'));
      const result = await ctx.api.get('social', { days });
      if (current !== request) return;
      if (!result.ok) {
        replace(body, h('div', { class: 'card' }, h('p', { class: 'muted' }, result.status === 503
          ? 'El servicio está ocupado. Intenta de nuevo en unos segundos.'
          : 'No se pudieron cargar los datos. Intenta de nuevo.')));
        return;
      }
      destroy();
      meta.textContent = `${result.data.source === 'stale' ? 'Datos guardados, pueden estar desactualizados. ' : ''}Actualizado a las ${timeOf(result.data.generated_at)}`;
      const container = h('div', { class: 'stack' });
      draw(container, result.data, { chart: instance => { if (instance) instances.push(instance); return instance; } });
      replace(body, container);
    }
    sync();
    const root = h('div', { class: 'stack' },
      pageHeader({ ctx, title: 'Redes sociales', subtitle: 'Instagram: capturas diarias de la cuenta y publicaciones recientes.', actions: [h('div', { class: 'chips', role: 'group', 'aria-label': 'Periodo' }, chips)] }),
      h('div', { class: 'statusline' }, meta),
      body);
    load();
    return root;
  },
};
