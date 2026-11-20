import { h } from '/app/dom.js';
import { icon } from '/app/icons.js';
import { localToday, dayIn, dateTimeIn, shiftDate, shortDate, truncate } from '/app/format.js';

// The list of saved conversations: pure view code. The shared chat state lives in chat-panel.js; this module only turns
// { items, currentId, status } into DOM and reports clicks through the handlers. Titles are text nodes, never markup.
export const GROUPS = Object.freeze(['Hoy', 'Ayer', 'Últimos 7 días', 'Anteriores']);

// Items arrive newest first and stay in that order inside their group. Days are days of the account's time zone, like the rest of the panel.
export function groupConversations(items, now = new Date()) {
  const today = localToday(now);
  const yesterday = shiftDate(today, -1);
  const weekStart = shiftDate(today, -7);
  const buckets = new Map(GROUPS.map(label => [label, []]));
  for (const item of items) {
    const at = new Date(item.updated_at);
    const day = Number.isNaN(at.getTime()) ? '' : dayIn(at);
    const label = day === today ? 'Hoy' : day === yesterday ? 'Ayer' : day && day >= weekStart && day < yesterday ? 'Últimos 7 días' : 'Anteriores';
    buckets.get(label).push(item);
  }
  return GROUPS.map(label => ({ label, items: buckets.get(label) })).filter(group => group.items.length);
}

const MAX_TITLE = 80;
const clock = { format: at => dateTimeIn(at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) };

// "hace 5 min", "hace 3 h", "ayer 14:20" or "12 sep" (days of the account's time zone). Unparseable dates give an empty string.
export function relativeTime(iso, now = new Date()) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const ms = Math.max(0, now.getTime() - at.getTime());
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const day = dayIn(at);
  const today = localToday(now);
  if (day === today) return `hace ${Math.floor(ms / 3600000)} h`;
  if (day === shiftDate(today, -1)) return `ayer ${clock.format(at)}`;
  return shortDate(day);
}

const plain = text => String(text).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
// Client-side title filter: case and accent insensitive. An empty query keeps everything.
export const filterConversations = (items, query) => {
  const needle = plain(String(query || '').trim());
  return needle ? items.filter(item => plain(item.title).includes(needle)) : items;
};

const button = (label, className, onclick, content = label) => h('button', { type: 'button', class: className, 'aria-label': label, title: label, onclick }, content);
const countLabel = n => (n === 1 ? '1 mensaje' : `${n} mensajes`);

function row(item, { currentId, editingId, confirmingId, menuId, busy, handlers, opens, now }) {
  const current = item.id === currentId;
  const tile = h('span', { class: 'conv-tile' }, icon('message-circle', { size: 16 }));
  if (item.id === editingId) {
    const input = h('input', { class: 'conv-rename', type: 'text', maxlength: MAX_TITLE, 'aria-label': 'Nuevo título', value: item.title });
    input.value = item.title;
    const save = () => handlers.onRenameSave(item.id, String(input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); save(); } else if (event.key === 'Escape') { event.preventDefault(); handlers.onRenameCancel(); }
    });
    queueMicrotask(() => { try { input.focus(); input.select?.(); } catch { /* not focusable */ } });
    return h('li', { class: 'conv-item is-editing' }, tile, input,
      h('div', { class: 'conv-edit-actions' }, button('Guardar título', 'text-btn', save, 'Guardar'), button('Cancelar renombrar', 'text-btn', () => handlers.onRenameCancel(), 'Cancelar')));
  }
  if (item.id === confirmingId) {
    return h('li', { class: 'conv-item is-confirming' },
      h('span', { class: 'conv-confirm small' }, '¿Eliminar esta conversación?'),
      h('div', { class: 'conv-edit-actions' }, button('Confirmar eliminar', 'text-btn conv-danger', () => handlers.onDeleteConfirm(item.id), 'Eliminar'), button('Cancelar eliminar', 'text-btn', () => handlers.onDeleteCancel(), 'Cancelar')));
  }
  const meta = [relativeTime(item.updated_at, now), item.message_count > 0 ? countLabel(item.message_count) : ''].filter(Boolean).join(' · ');
  const open = h('button', { type: 'button', class: 'conv-open', 'aria-current': current ? 'true' : null, disabled: busy ? true : null, onclick: () => handlers.onSelect(item.id) },
    tile, h('span', { class: 'conv-text' }, h('span', { class: 'conv-title' }, truncate(item.title, 60)), h('span', { class: 'conv-meta' }, meta)));
  opens.push(open);
  open.addEventListener('keydown', event => {
    const at = opens.indexOf(open);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      opens[Math.max(0, Math.min(opens.length - 1, at + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (event.key === 'Enter') { event.preventDefault(); handlers.onSelect(item.id); }
  });
  const menuOpen = item.id === menuId;
  const more = h('button', { type: 'button', class: 'conv-more', 'aria-label': `Acciones: ${truncate(item.title, 40)}`, 'aria-haspopup': 'menu', 'aria-expanded': menuOpen ? 'true' : 'false', onclick: () => handlers.onMenu(item.id) }, icon('more-horizontal', { size: 16 }));
  const actions = h('div', { class: 'conv-actions' }, more);
  if (menuOpen) {
    const entry = (label, className, onclick, name) => h('button', { type: 'button', role: 'menuitem', class: className, 'aria-label': `${label}: ${truncate(item.title, 40)}`, onclick }, icon(name, { size: 14 }), label);
    const menu = h('div', { class: 'conv-menu', role: 'menu' },
      entry('Renombrar', 'conv-menu-item', () => handlers.onRenameStart(item.id), 'pencil'),
      entry('Eliminar', 'conv-menu-item conv-danger', () => handlers.onDeleteStart(item.id), 'trash-2'));
    menu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation?.(); handlers.onMenuClose(); } });
    queueMicrotask(() => { try { menu.children[0]?.focus(); } catch { /* not focusable */ } });
    actions.append(menu);
  }
  return h('li', { class: `${current ? 'conv-item is-current' : 'conv-item'}${menuOpen ? ' has-menu' : ''}` }, open, actions);
}

const skeletonRows = () => h('div', { class: 'conv-skeletons', role: 'status', 'aria-label': 'Cargando conversaciones' },
  [0, 1, 2].map(() => h('div', { class: 'conv-skeleton', 'aria-hidden': 'true' }, h('span', { class: 'conv-skel-tile' }), h('span', { class: 'conv-skel-lines' }, h('span', { class: 'conv-skel-line' }), h('span', { class: 'conv-skel-line is-short' })))));

function emptyState(starters, handlers) {
  return h('div', { class: 'conv-empty-state' },
    h('span', { class: 'conv-empty-art' }, icon('message-circle', { size: 28 })),
    h('p', { class: 'conv-empty-title' }, 'Tus conversaciones aparecerán aquí'),
    h('p', { class: 'small muted conv-empty-text' }, 'Pregunta algo al agente y la conversación se guarda automáticamente'),
    h('div', { class: 'conv-starters' }, starters.slice(0, 2).map(q => h('button', { type: 'button', class: 'chip-btn conv-starter', onclick: () => handlers.onStarter(q) }, q))));
}

function memoryRow({ count, pending, pressed }, handlers) {
  return h('button', { type: 'button', class: 'conv-memory chat-memory-toggle', 'aria-pressed': pressed ? 'true' : 'false', onclick: () => handlers.onMemory() },
    h('span', { class: 'conv-tile' }, icon('brain', { size: 16 })),
    h('span', { class: 'conv-memory-label' }, 'Memoria del agente'),
    pending ? h('span', { class: 'conv-dot', role: 'img', 'aria-label': 'Hay notas por revisar', title: 'Hay notas por revisar' }) : null,
    h('span', { class: 'conv-badge' }, String(count)));
}

// Returns an array of nodes for the list area: "Nueva conversación", the search field, one section per day group (or the
// loading, empty and no-result states) and the memory row at the bottom. `search` is the panel's persistent input node.
export function conversationNodes({ items, currentId = null, status = 'idle', editingId = null, confirmingId = null, menuId = null, busy = false, notice = '', query = '', search = null, memory = { count: 0, pending: false, pressed: false }, starters = [], handlers, now }) {
  const nodes = [h('button', { type: 'button', class: 'btn btn-primary conv-new', onclick: () => handlers.onNew() }, icon('plus', { size: 16 }), 'Nueva conversación')];
  const loading = status === 'loading' && !items.length;
  const empty = !loading && !items.length;
  if (search && !loading && !empty) nodes.push(h('div', { class: 'conv-search' }, icon('search', { size: 16, class: 'conv-search-icon' }), search));
  if (notice) nodes.push(h('p', { class: 'small conv-notice', role: 'status' }, notice));
  const body = h('div', { class: 'conv-body' });
  if (loading) body.append(skeletonRows());
  else if (status === 'error' && !items.length) body.append(h('p', { class: 'small muted conv-empty' }, 'No se pudieron cargar las conversaciones.'));
  else if (empty) body.append(emptyState(starters, handlers));
  else {
    const shown = filterConversations(items, query);
    const opens = [];
    if (!shown.length) body.append(h('p', { class: 'small muted conv-empty conv-no-results', role: 'status' }, 'Sin resultados'));
    for (const group of groupConversations(shown, now)) {
      body.append(h('section', { class: 'conv-group' },
        h('h3', { class: 'conv-group-title' }, group.label),
        h('ul', { class: 'conv-list' }, group.items.map(item => row(item, { currentId, editingId, confirmingId, menuId, busy, handlers, opens, now })))));
    }
  }
  nodes.push(body, memoryRow(memory, handlers));
  return nodes;
}
