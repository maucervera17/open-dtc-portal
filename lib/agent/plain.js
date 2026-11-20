import { rangeLabel, cleanWindows } from './windows.js';

// Deterministic plain-language pass over the agent's prose. It runs after validation (the validator sees the original text, so
// every number is checked first) and again when stored runs are read, so runs written before it existed read the same way.
// It only touches words: numbers are kept, apart from money, which is shown as "$694 MXN". It is idempotent.

// C and B are only rewritten where they are clearly the current and the previous window: after "periodo", "en", "frente a"...,
// around "vs", next to a metric name or before "<number>" labels such as "B: $56". A capital letter anywhere else ("Kit B",
// "Producto C", "Plan B") is a name and stays as it is.
const L = '[\\p{L}\\p{N}_]';
const WINDOW_WORD = new RegExp(`(?:^|(?<!${L}))(?:(?:el|la)\\s+)?(?:[Pp]eriodo|[Vv]entana|[Ss]emana)\\s+([CB])(?!${L})`, 'gu');
const VERSUS = new RegExp(`(?<![\\p{L}\\p{N}_$])([CB])(\\s*(?:vs\\.?|versus|frente a|contra|/)\\s*)([CB])(?!${L})`, 'gu');
const PREPOSITION = new RegExp(`(?<!${L})((?:en|durante|entre|desde|hasta)\\s+|(?:frente a|contra|vs\\.?|versus)\\s+)(?:(?:la|el)\\s+)?([CB])(?!${L})`, 'giu');
const AFTER_METRIC = new RegExp(`(?<!${L})(gasto|cpa|roas|compras|ctr|frecuencia|ingresos?|impresiones|clics?)(\\s*:?\\s+)([CB])(?!${L})(?=\\s*[:$\\d(])`, 'giu');
const PARENTHESIZED = /\(([CB])\)/g;
const LABEL_COLON = new RegExp(`(?<=^|[(,;/]\\s*|[.!?]\\s+|(?<!${L})(?:y|e|vs\\.?|con|contra|versus)\\s+)([CB])(?=\\s*:\\s*[$\\d])`, 'gu');
const THIS_WEEK = 'esta semana';
const LAST_WEEK = 'la semana anterior';

// How C and B are written. With the real windows: "la semana del 21 al 27 sep" in running text and "del 21 al 27 sep" before a
// colon or a number; without them (runs stored before the windows were kept) the generic "esta semana" and "la semana anterior".
function phrasesFor(windows) {
  const known = cleanWindows(windows);
  const range = letter => (known ? rangeLabel(known[letter].from, known[letter].to) : '');
  return {
    long: letter => (known ? `la semana del ${range(letter)}` : letter === 'C' ? THIS_WEEK : LAST_WEEK),
    short: letter => (known ? `del ${range(letter)}` : letter === 'C' ? THIS_WEEK : LAST_WEEK),
  };
}

const ENUMS = [
  [/\bINSUFFICIENT_SAMPLE\b/g, 'muestra insuficiente'],
  [/\bFATIGUED\b/g, 'fatiga'],
  [/\bSIGNALS\b/g, 'señales'],
  [/\bREPLACE_CREATIVE\b/g, 'cambiar el creativo'],
  [/\bSTOP\b/g, 'pausar'],
  [/\bCONTINUE\b/g, 'seguir'],
  [/\bSCALE\b/g, 'escalar'],
  [/\bWATCH\b/g, 'vigilar'],
  [/\btracking_suspect\b/g, 'posible problema de medición'],
  [/\brastreo\s+sospechoso\b/gi, 'posible problema de medición'],
  [/\bfatigue_state\b/g, 'estado de fatiga'],
  [/\bpurchase_events_7d\b/g, 'eventos de compra (7 días)'],
  [/\bpurchase_events_web_7d\b/g, 'eventos de compra del sitio web (7 días)'],
  [/\bpurchase_events_server_7d\b/g, 'eventos de compra del servidor (7 días)'],
  [/\bstop_min_spend_c\b/g, 'gasto mínimo para pausar'],
  [/\bmin_purchases\b/g, 'mínimo de compras'],
  [/\bmin_impressions\b/g, 'mínimo de impresiones'],
  [/\bmin_spend\b/g, 'gasto mínimo'],
  [/\bctr_pct\b/g, 'CTR'],
  [/\bprofile_growth\b/g, 'crecimiento de perfil'],
  [/\btraffic_site\b/g, 'tráfico al sitio'],
  [/\bobjective_group\b/g, 'objetivo de la campaña'],
  [/\bcost_per_profile_visit\b/g, 'costo por visita al perfil'],
  [/\bcost_per_interaction\b/g, 'costo por interacción'],
  [/\bprofile_visits\b/g, 'visitas al perfil'],
  [/\blink_clicks\b/g, 'clics al enlace'],
  [/\bcpc_link\b/g, 'costo por clic al enlace'],
  [/\bnot_available_by_design\b/g, 'no disponible por diseño'],
];

const mx0 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });
const mx2 = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const AMOUNT = '\\d[\\d,]*(?:\\.\\d+)?';
const MONEY_AFTER = new RegExp(`(?<![\\w.,])\\$?(${AMOUNT})\\s*MXN\\b`, 'g');
const MONEY_BEFORE = new RegExp(`\\bMXN\\s*\\$?(${AMOUNT})`, 'g');

// Amounts from 100 up are shown without cents ($694 MXN); smaller ones keep them ($45.60 MXN), where cents still matter.
function money(raw) {
  const value = Number(raw.replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  return `${(Math.abs(value) >= 100 ? mx0 : mx2).format(value)} MXN`;
}

// Upper-cases the first letter when the replacement opens a sentence.
function casing(text, offset, phrase) {
  const before = text.slice(0, offset);
  return before.trim() === '' || /[.!?]\s+$/.test(before) || /\n\s*$/.test(before) ? phrase[0].toUpperCase() + phrase.slice(1) : phrase;
}

export function plainText(text, windows) {
  if (typeof text !== 'string' || !text) return text;
  const { long, short } = phrasesFor(windows);
  let out = text;
  out = out.replace(WINDOW_WORD, (match, letter, offset, whole) => casing(whole, offset, long(letter)));
  out = out.replace(VERSUS, (match, a, middle, b, offset, whole) => casing(whole, offset, `${long(a)}${middle}${long(b)}`));
  out = out.replace(PARENTHESIZED, (match, letter) => `(${short(letter)})`);
  out = out.replace(PREPOSITION, (match, lead, letter) => `${lead}${long(letter)}`);
  out = out.replace(AFTER_METRIC, (match, metric, gap, letter) => `${metric}${gap}${short(letter)}`);
  out = out.replace(LABEL_COLON, (match, letter, offset, whole) => casing(whole, offset, short(letter)));
  for (const [pattern, phrase] of ENUMS) out = out.replace(pattern, (match, ...rest) => casing(out, rest.at(-2), phrase));
  out = out.replace(MONEY_AFTER, (match, amount) => money(amount) || match);
  out = out.replace(MONEY_BEFORE, (match, amount) => money(amount) || match);
  return out;
}

const plainList = (list, windows) => (Array.isArray(list) ? list.map(item => plainText(item, windows)) : list);

// A stored or freshly validated run with its prose rewritten. Ids, names, metric paths, actions and codes are data: untouched.
export function plainRun(run, windows) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) return run;
  const w = windows ?? run.windows;
  const out = { ...run };
  if (typeof out.summary === 'string') out.summary = plainText(out.summary, w);
  if (Array.isArray(out.data_gaps)) out.data_gaps = plainList(out.data_gaps, w);
  if (Array.isArray(out.recommendations)) {
    out.recommendations = out.recommendations.map(rec => (rec && typeof rec === 'object'
      ? { ...rec, ...(typeof rec.rationale === 'string' ? { rationale: plainText(rec.rationale, w) } : {}), ...(Array.isArray(rec.evidence) ? { evidence: plainList(rec.evidence, w) } : {}) }
      : rec));
  }
  return out;
}
