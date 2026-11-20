import { h, replace } from '/app/dom.js';
import { displayName, money, int, roas, cpaText, ctrText, decimal, shortDate, ND } from '/app/format.js';
import { safePreviewSrc } from '/app/preview-rule.js';
import { rangeView, badge, deliveryPill, thumbImage } from '/app/ui.js';

const FORMAT = 'MOBILE_FEED_STANDARD';
const PREVIEW_ERROR = 'Vista previa no disponible';

// Second line of defence: the server already validated, but the iframe is only ever built from a src that passes the same rule here.
export { safePreviewSrc };

const CHIPS = {
  FATIGUED: ['Fatiga', 'bad'],
  SIGNALS: ['Vigilar', 'warn'],
  INSUFFICIENT_SAMPLE: ['Muestra insuficiente', 'neutral'],
};

const cell = (label, value) => h('div', { class: 'metric' }, h('span', { class: 'metric-label' }, label), h('span', { class: 'metric-value num' }, value));

function thumbnail(ad) {
  const url = ad.creative?.image_url || ad.creative?.thumbnail_url || null;
  return thumbImage(url, displayName(ad.name) || 'Anuncio');
}

// The evidence behind a fatigue state: baseline week versus the latest closed week.
function evidence(fatigue) {
  const { evidence: e, signals, state } = fatigue;
  if (state === 'INSUFFICIENT_SAMPLE' || !e || !e.C || !e.B) {
    return h('p', { class: 'muted small' }, 'No hay impresiones, inversión o compras suficientes en las dos semanas para evaluar la fatiga.');
  }
  const line = (label, before, after, flagged) => h('li', { class: flagged ? 'evidence-line is-flagged' : 'evidence-line' },
    h('span', {}, label), h('span', { class: 'num' }, `${before} → ${after}`), flagged ? badge('Señal', 'warn') : null);
  return h('div', { class: 'evidence' },
    h('p', { class: 'muted small' }, `Semana previa → última semana cerrada${fatigue.as_of ? ` (al ${shortDate(fatigue.as_of)})` : ''}`),
    h('ul', { class: 'evidence-list' },
      line('Frecuencia', decimal(e.B.frequency), decimal(e.C.frequency), signals?.freq_up),
      line('CTR (enlace)', ctrText(e.B.ctr), ctrText(e.C.ctr), signals?.ctr_down),
      line('CPA', money(e.B.cpa), money(e.C.cpa), signals?.cpa_up)));
}

let modalSeq = 0;

// Centered dialog for one ad preview. Built with DOM APIs only; the iframe src has already passed safePreviewSrc.
function openPreviewModal(ad, opener, api) {
  const doc = document;
  const titleId = `preview-title-${++modalSeq}`;
  const close = h('button', { type: 'button', class: 'modal-close', 'aria-label': 'Cerrar' }, '×');
  const loading = h('p', { class: 'muted small', role: 'status' }, 'Cargando vista previa…');
  const body = h('div', { class: 'modal-body' }, loading);
  const dialog = h('div', { class: 'modal-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabindex: '-1' },
    h('div', { class: 'modal-head' }, h('h2', { class: 'modal-title', id: titleId }, displayName(ad.name) || 'Anuncio'), close),
    body);
  const backdrop = h('div', { class: 'modal-backdrop' }, dialog);
  let closed = false;

  const dismiss = () => {
    if (closed) return;
    closed = true;
    doc.removeEventListener('keydown', onKey);
    doc.removeEventListener('focusin', onFocusIn);
    backdrop.remove();
    doc.body.classList.remove('modal-open');
    opener.focus();
  };
  // The close button is the only control of ours inside the dialog, so Tab always lands on it.
  const onKey = event => {
    if (event.key === 'Escape') dismiss();
    else if (event.key === 'Tab') { event.preventDefault(); close.focus(); }
  };
  const onFocusIn = event => { if (event.target && event.target !== close && !dialog.contains(event.target)) close.focus(); };

  close.addEventListener('click', dismiss);
  backdrop.addEventListener('click', event => { if (event.target === backdrop) dismiss(); });
  doc.addEventListener('keydown', onKey);
  doc.addEventListener('focusin', onFocusIn);
  doc.body.classList.add('modal-open');
  doc.body.append(backdrop);
  close.focus();

  (async () => {
    const result = await api.get('creatives/preview', { ad_id: ad.id, format: FORMAT });
    if (closed) return;
    const src = result.ok ? safePreviewSrc(result.data?.src) : null;
    if (!src) { replace(body, h('p', { class: 'muted small' }, PREVIEW_ERROR)); return; }
    const frame = h('iframe', {
      class: 'preview-frame is-loading', src, title: `Vista previa de ${displayName(ad.name) || 'anuncio'}`,
      sandbox: 'allow-scripts allow-same-origin allow-popups', referrerpolicy: 'no-referrer',
    });
    frame.addEventListener('load', () => { frame.className = 'preview-frame'; loading.remove(); });
    body.append(frame);
  })();
}

function previewBox(ad, api) {
  const button = h('button', { type: 'button', class: 'btn btn-sm' }, 'Ver vista previa');
  button.addEventListener('click', () => openPreviewModal(ad, button, api));
  return h('div', { class: 'preview-box' }, button);
}

function card(ad, api) {
  const m = ad.metrics || {};
  const chip = CHIPS[ad.fatigue?.state];
  return h('article', { class: 'card creative' },
    thumbnail(ad),
    h('div', { class: 'creative-body' },
      h('div', { class: 'name-cell' }, h('span', { class: 'name' }, displayName(ad.name) || ND), deliveryPill(ad), chip ? badge(chip[0], chip[1]) : null),
      h('p', { class: 'muted small' }, [displayName(ad.campaign_name), displayName(ad.adset_name)].filter(Boolean).join(' · ') || ND),
      h('div', { class: 'metric-grid metric-grid-sm' },
        cell('Compras', int(m.purchases)), cell('CPA', cpaText(m)), cell('ROAS', roas(m.roas)), cell('Carritos (sitio web)', int(m.carts)), cell('CTR (enlace)', ctrText(m.ctr)), cell('Frecuencia', decimal(m.frequency))),
      ad.fatigue ? evidence(ad.fatigue) : null,
      previewBox(ad, api)));
}

const FILTERS = [
  { key: 'running', label: 'En circulación', match: ad => ad.delivery === 'running' },
  { key: 'no_delivery', label: 'Sin entrega', match: ad => ad.delivery === 'no_delivery' },
  { key: 'ended', label: 'Terminados', match: ad => ad.delivery === 'ended' },
  { key: 'all', label: 'Todos', match: () => true },
];
const EMPTY = { running: 'No hay anuncios en circulación en este momento.', no_delivery: 'No hay anuncios sin entrega reciente.', ended: 'No hay anuncios terminados.', all: 'No hay anuncios en este momento.' };

function draw(container, data, api) {
  let current = 'running';
  const list = h('div', { class: 'stack' });
  const buttons = FILTERS.map(f => {
    const count = data.ads.filter(f.match).length;
    const button = h('button', { type: 'button', class: 'chip delivery-chip', 'aria-pressed': 'false' }, `${f.label} (${count})`);
    button.addEventListener('click', () => { current = f.key; paint(); });
    return button;
  });
  function paint() {
    buttons.forEach((button, i) => {
      const active = FILTERS[i].key === current;
      button.className = active ? 'chip delivery-chip is-active' : 'chip delivery-chip';
      button.setAttribute('aria-pressed', active ? 'true' : 'false');
    });
    const shown = data.ads.filter(FILTERS.find(f => f.key === current).match);
    replace(list, shown.length
      ? h('div', { class: 'creative-grid' }, shown.map(ad => card(ad, api)))
      : h('p', { class: 'muted' }, EMPTY[current]));
  }
  paint();
  container.append(h('div', { class: 'chips', role: 'group', 'aria-label': 'Estado de entrega' }, buttons), list);
}

export default {
  route: 'creativos',
  label: 'Creativos',
  render: ctx => rangeView({ ctx, title: 'Creativos', module: 'creatives', endpoint: 'creatives', draw: (container, data) => draw(container, data, ctx.api) }),
};
