// Plain-language framing of the purchase funnel. Every step is expressed against product visits ("X out of every 100
// visits"), because Meta attributes each event on its own: checkouts can exceed carts when people buy without a cart.
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const one = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });

export const STEP_LABELS = Object.freeze(['visitas a producto', 'añadidos al carrito', 'pagos iniciados', 'compras']);
// What the website (pixel) numbers are, and what they are not. Shown on Resumen, Campañas and Píxel.
export const WEB_NOTE = 'Cifras del sitio web (píxel). Ads Manager puede mostrar un total mayor si incluye acciones dentro de Instagram/Facebook.';
export const PROVISIONAL_NOTE = 'Meta puede ajustar las cifras de los últimos 7 días (más en los últimos 3).';
export const WEB_SUB = 'Sitio web';

// "Incluyendo Instagram/Facebook: 9": only when Meta reported an omni total and it differs from the website count.
export function allNote(count, all) {
  return isNum(count) && isNum(all) && all !== count ? `Incluyendo Instagram/Facebook: ${whole.format(all)}` : null;
}

// "5 de 7 días" while some days are missing; null when the period is complete or the payload does not say.
export function coverageText(covered, expected) {
  return isNum(covered) && isNum(expected) && expected > 0 && covered < expected ? `${covered} de ${expected} días` : null;
}

export const DIRECT_BUY_NOTE = 'Algunas personas inician el pago sin pasar por el carrito (compra directa).';

const counts = f => [f?.content, f?.carts, f?.checkout, f?.purchases];

// Share of product visits, one decimal, as text. Null without a usable base.
export function perHundred(count, content) {
  if (!isNum(count) || !isNum(content) || content <= 0) return null;
  return one.format((count / content) * 100);
}

// True when a step-to-step rate is above 100%: its display is capped and explained instead of shown.
export const overHundred = rate => isNum(rate) && rate > 1;

// The step with the largest share lost against the step before it. Steps that grew or have no base are ignored.
export function biggestDrop(funnel) {
  const values = counts(funnel);
  let best = null;
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1], now = values[i];
    if (!isNum(prev) || !isNum(now) || prev <= 0 || now >= prev) continue;
    const lost = (prev - now) / prev;
    if (!best || lost > best.lost) best = { from: STEP_LABELS[i - 1], to: STEP_LABELS[i], lost };
  }
  return best;
}

// What "nobody got to this step" sounds like, by step index (1 = carts, 2 = checkout, 3 = purchases).
const NONE_REACHED = Object.freeze([null, 'ninguno añadió al carrito', 'ninguno inició el pago', 'ninguno terminó en compra']);

// "solo X de cada 100 continúan", or "ninguno ..." when the whole step was lost.
function dropPhrase(drop) {
  const kept = (1 - drop.lost) * 100;
  if (kept <= 0) return NONE_REACHED[STEP_LABELS.indexOf(drop.to)] || 'ninguno continuó';
  return `solo ${kept < 0.05 ? 'menos de 0.1' : one.format(kept)} de cada 100 continúan`;
}

const plural = (n, singular, many) => (n === 1 ? singular : many);

// One deterministic paragraph. `source` is 'ads' (events Meta attributes to ads) or 'pixel' (the pixel's own stats).
export function funnelSummary(funnel, { days, source = 'ads', covered } = {}) {
  const [content, carts, checkout, purchases] = counts(funnel);
  if (![content, carts, checkout, purchases].every(isNum)) return null;
  // "En los últimos 7 días" is only true when the 7 days are all there.
  const period = isNum(covered) && covered < days ? `Con ${covered} de ${days} días disponibles` : `En los últimos ${days} días`;
  if (content === 0) return `${period}, ${source === 'ads' ? 'no hay visitas a producto atribuidas a los anuncios' : 'el píxel no registró visitas a producto'}.`;
  const who = source === 'ads' ? 'los anuncios generaron' : 'el píxel registró';
  const share = perHundred(carts, content);
  const head = `${period}, ${who} ${whole.format(content)} ${plural(content, 'visita', 'visitas')} a producto; ${whole.format(carts)} ${plural(carts, 'añadió', 'añadieron')} al carrito (${share}%), ${whole.format(checkout)} ${plural(checkout, 'inició', 'iniciaron')} pago y ${whole.format(purchases)} ${plural(purchases, 'compra', 'compras')}${source === 'ads' ? plural(purchases, ' atribuida', ' atribuidas') : ''}.`;
  const drop = biggestDrop(funnel);
  if (!drop) return head;
  return `${head} La mayor pérdida está entre ${drop.from} y ${drop.to}: ${dropPhrase(drop)}.`;
}

// Step-to-step conversion shown between funnel cards ("3.6% siguen"). Null rate is N/D; a rate over 100% is capped.
export function followText(rate, nd = 'N/D') {
  if (!isNum(rate)) return nd;
  if (overHundred(rate)) return 'Más de 100% siguen';
  return `${one.format(rate * 100)}% siguen`;
}
