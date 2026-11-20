import { shortDate, ND } from '/app/format.js';

// Chart.js configuration for the dashboard, built as plain objects (no DOM, no inline styles: the CSP only allows JS options).
//
// Reading rules: daily counts and spend are bars, ratios (CPA, ROAS, CTR) are lines, nothing is smoothed. Days Meta still adjusts
// are drawn lighter (bars with an outline) or dashed (lines with hollow points), and the average is a dashed "Promedio" line.
export const PROVISIONAL_LABEL = 'Provisional (Meta aún ajusta)';
export const ADJUSTABLE_LABEL = 'Puede ajustarse';
export const AVERAGE_LABEL = 'Promedio';
const DASH = [6, 4];

const oneDecimal = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const nums = values => values.filter(isNum);
const sum = values => nums(values).reduce((a, b) => a + b, 0);
const mean = values => { const list = nums(values); return list.length ? sum(list) / list.length : null; };

export const hasProvisional = flags => flags.some(Boolean);

// Average reference: the mean of the delivered days (provisional days are incomplete), or of every day when all are provisional.
function referenceOf(values, provisional) {
  const settled = mean(values.filter((_, i) => !provisional[i]));
  return settled === null ? mean(values) : settled;
}

// Summary shown above a chart. Counts and money: period total and daily average. Ratios have no total: the period value.
export function summaryOf({ kind, values, format, overall = null }) {
  const show = v => (isNum(v) ? format(v) : ND);
  if (kind === 'ratio') return [{ label: 'Promedio del periodo', value: show(overall) }];
  const list = nums(values);
  // A daily average of counts is rarely whole: one decimal, instead of rounding 0.7 to 1.
  const averageFormat = kind === 'count' ? v => oneDecimal.format(v) : format;
  return [
    { label: 'Total del periodo', value: list.length ? format(sum(list)) : ND },
    { label: 'Promedio diario', value: list.length ? averageFormat(mean(list)) : ND },
  ];
}

// Few, flat x labels on phones: autoSkip drops the ones that do not fit and they are never rotated.
const xTicks = (colors, compact) => (compact
  ? { color: colors.tick, autoSkip: true, maxRotation: 0, minRotation: 0, maxTicksLimit: 5 }
  : { color: colors.tick, maxRotation: 0, autoSkip: true });

function options({ dates, provisional, adjustable = [], format, tickFormat = format, count = false, zero = true, legend = false, colors, compact = false }) {
  const y = { beginAtZero: zero, grid: { color: colors.grid }, border: { display: false }, ticks: { color: colors.tick, maxTicksLimit: 6, callback: v => tickFormat(v) } };
  if (count) y.ticks.precision = 0;
  return {
    responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
    plugins: {
      // Phones: the provisional chip above the chart already explains the lighter days, and a legend would eat the height.
      legend: legend && !compact ? { display: true, position: 'bottom', labels: { color: colors.tick, usePointStyle: true, boxWidth: 8 } } : { display: false },
      tooltip: { callbacks: {
        title: items => (items?.length ? shortDate(dates[items[0].dataIndex]) : ''),
        label: item => `${item.dataset.label}: ${format(item.parsed.y)}${item.datasetIndex !== 0 ? '' : provisional[item.dataIndex] ? ' · Provisional (Meta aún ajusta)' : adjustable[item.dataIndex] ? ` · ${ADJUSTABLE_LABEL}` : ''}`,
      } },
    },
    scales: { x: { grid: { display: false }, ticks: xTicks(colors, compact) }, y },
  };
}

const barDataset = ({ label, values, provisional, color, soft, order = 1 }) => ({
  label, data: values, order,
  backgroundColor: provisional.map(p => (p ? soft : color)),
  borderColor: provisional.map(() => color),
  borderWidth: provisional.map(p => (p ? 1 : 0)),
  borderRadius: 4, maxBarThickness: 28,
});

const lineDataset = ({ label, values, provisional, colors, order = 1 }) => ({
  label, data: values, order,
  borderColor: colors.main, backgroundColor: colors.main, tension: 0, pointRadius: 3, spanGaps: false,
  pointBackgroundColor: provisional.map(p => (p ? colors.surface : colors.main)),
  pointBorderColor: provisional.map(() => colors.main),
  segment: { borderDash: ctx => (provisional[ctx.p1DataIndex] ? DASH : undefined) },
});

const averageDataset = (dates, value, colors) => ({
  type: 'line', label: AVERAGE_LABEL, data: dates.map(() => value), order: 0,
  borderColor: colors.avg, backgroundColor: colors.avg, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, tension: 0, fill: false,
});

// One metric over time with its average. kind: 'count' | 'money' (bars) or 'ratio' (line). `average` overrides the computed
// reference (ratios pass the period-weighted value, because the mean of daily ratios is misleading).
export function seriesConfig({ label, kind, dates, values, provisional, adjustable = [], format, tickFormat, colors, average, compact = false }) {
  const bars = kind !== 'ratio';
  const reference = isNum(average) ? average : referenceOf(values, provisional);
  const main = bars
    ? barDataset({ label, values, provisional, color: colors.main, soft: colors.soft })
    : lineDataset({ label, values, provisional, colors });
  const datasets = [main];
  if (isNum(reference)) datasets.push(averageDataset(dates, reference, colors));
  return {
    type: bars ? 'bar' : 'line',
    data: { labels: dates.map(shortDate), datasets },
    options: options({ dates, provisional, adjustable, format, tickFormat, count: kind === 'count', zero: bars, legend: datasets.length > 1, colors, compact }),
  };
}

// Several daily counts side by side (for example new followers and unfollows). `series`: [{ label, values, color, soft? }].
export function groupedBarsConfig({ dates, provisional, adjustable = [], series, format, colors, compact = false }) {
  return {
    type: 'bar',
    data: { labels: dates.map(shortDate), datasets: series.map(s => barDataset({ label: s.label, values: s.values, provisional, color: s.color, soft: s.soft || fade(s.color, 0.35) })) },
    options: options({ dates, provisional, adjustable, format, count: true, zero: true, legend: series.length > 1, colors, compact }),
  };
}

// A running level (followers): a straight line that keeps its own range.
export function levelLineConfig({ label, dates, values, provisional, adjustable = [], format, colors, compact = false }) {
  return {
    type: 'line',
    data: { labels: dates.map(shortDate), datasets: [lineDataset({ label, values, provisional, colors })] },
    options: options({ dates, provisional, adjustable, format, count: true, zero: false, legend: false, colors, compact }),
  };
}

// Same colour at a lower opacity, for provisional bars. Non-hex colours (already rgb/rgba) are returned as they are.
export function fade(color, alpha = 0.35) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const hex = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// Theme colours read from the CSS tokens, with safe fallbacks. The palette is the existing brand one; nothing new is introduced.
export function chartColors(cssVar) {
  const main = cssVar('--chart-1', '#1F4373');
  return { main, soft: fade(main, 0.35), avg: cssVar('--muted', '#5a6a7d'), grid: cssVar('--hair', '#EBEBEB'), tick: cssVar('--muted', '#5a6a7d'), surface: cssVar('--surface', '#FFFFFF') };
}
