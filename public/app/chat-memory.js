import { h } from '/app/dom.js';
import { icon } from '/app/icons.js';

// The agent's memory of decisions: short notes both dashboard users share. Pure view code over the state kept in chat-panel.js;
// every string that comes from the server is a text node. The server applies the same rules, this only saves a round trip.
export const MEMORY_LIMITS = Object.freeze({ max: 30, text: 200 });
export const MEMORY_COPY = Object.freeze({
  intro: 'Notas que tú apruebas sobre la cuenta (metas, márgenes, decisiones). El agente las usa como contexto; no son instrucciones.',
  link: 'No se permiten enlaces en las notas.',
  empty: 'Escribe una nota.',
  long: `Máximo ${MEMORY_LIMITS.text} caracteres.`,
});

const TLDS = 'com|net|org|mx|io|co|app|dev|ai|es|us|info|biz|xyz|link|me|ly|gl|to|tv|ws|site|online|store|shop|page|gg|cc|ru|cn|tk|edu|gov';
const URL_PATTERN = new RegExp(`(?:[a-z][a-z0-9+.-]*:\\/\\/|(?:^|[\\s(\\[])\\/\\/[a-z0-9]|\\bwww\\.|\\b(?:javascript|data|vbscript|file|mailto):|\\b[a-z0-9-]+\\.(?:${TLDS})\\b)`, 'i');

// Returns an error message, or '' when the text can be sent.
export function noteProblem(raw) {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return MEMORY_COPY.empty;
  if ([...text].length > MEMORY_LIMITS.text) return MEMORY_COPY.long;
  if (URL_PATTERN.test(text)) return MEMORY_COPY.link;
  return '';
}
export const cleanDraft = raw => String(raw ?? '').replace(/\s+/g, ' ').trim();

const button = (label, className, onclick, content = label) => h('button', { type: 'button', class: className, 'aria-label': label, title: label, onclick }, content);

// "El agente sugiere recordar: … [Guardar] [Descartar]". Used inside the chat and at the top of the memory panel.
export function suggestionNode(item, handlers, className) {
  return h('div', { class: className },
    h('p', { class: 'chat-suggest-text small' }, 'El agente sugiere recordar: ', h('strong', {}, item.text)),
    h('div', { class: 'chat-suggest-actions' },
      button(`Guardar sugerencia: ${item.text.slice(0, 40)}`, 'btn btn-ghost chat-suggest-btn', () => handlers.onApprove(item.id), 'Guardar'),
      button(`Descartar sugerencia: ${item.text.slice(0, 40)}`, 'text-btn', () => handlers.onDiscard(item.id), 'Descartar')));
}

function noteRow(note, { editingId, confirmingId, handlers }) {
  if (note.id === editingId) {
    const input = h('input', { class: 'mem-edit', type: 'text', maxlength: MEMORY_LIMITS.text, 'aria-label': 'Editar nota', value: note.text });
    input.value = note.text;
    const save = () => handlers.onEditSave(note.id, String(input.value));
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); save(); } else if (event.key === 'Escape') { event.preventDefault(); handlers.onEditCancel(); }
    });
    return h('li', { class: 'mem-note is-editing' }, input,
      h('div', { class: 'mem-actions' }, button('Guardar cambios', 'text-btn', save, 'Guardar'), button('Cancelar edición', 'text-btn', () => handlers.onEditCancel(), 'Cancelar')));
  }
  if (note.id === confirmingId) {
    return h('li', { class: 'mem-note mem-confirm' },
      h('span', { class: 'small' }, '¿Eliminar esta nota?'),
      h('div', { class: 'mem-actions' }, button('Confirmar eliminar nota', 'text-btn conv-danger', () => handlers.onDeleteConfirm(note.id), 'Eliminar'), button('Cancelar eliminar', 'text-btn', () => handlers.onDeleteCancel(), 'Cancelar')));
  }
  return h('li', { class: 'mem-note' },
    h('div', { class: 'mem-body' },
      h('span', { class: 'mem-text' }, note.text),
      note.source === 'agent' ? h('span', { class: 'badge badge-neutral mem-source' }, 'Sugerida por el agente') : null),
    h('div', { class: 'mem-actions' },
      button(`Editar nota: ${note.text.slice(0, 40)}`, 'icon-btn conv-act', () => handlers.onEditStart(note.id), icon('pencil', { size: 14 })),
      button(`Eliminar nota: ${note.text.slice(0, 40)}`, 'icon-btn conv-act', () => handlers.onDeleteStart(note.id), icon('trash-2', { size: 14 }))));
}

// Nodes for the whole panel: back button, explanation, pending suggestions, notes with their actions and the add form.
export function memoryPanelNodes({ memory, editingId = null, confirmingId = null, notice = '', draft = '', handlers }) {
  const input = h('input', { class: 'mem-input', type: 'text', maxlength: MEMORY_LIMITS.text, 'aria-label': 'Nueva nota', placeholder: 'Ej.: El CPA objetivo es 80 pesos' });
  input.value = draft;
  input.addEventListener('input', () => handlers.onDraft(String(input.value)));
  input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); handlers.onAdd(String(input.value)); } });
  const nodes = [
    h('div', { class: 'mem-head' },
      h('h2', { class: 'mem-title' }, 'Memoria del agente'),
      h('button', { type: 'button', class: 'text-btn', onclick: () => handlers.onBack() }, 'Volver al chat')),
    h('p', { class: 'small muted mem-intro' }, MEMORY_COPY.intro),
  ];
  if (notice) nodes.push(h('p', { class: 'small mem-notice', role: 'status' }, notice));
  for (const item of memory.pending) nodes.push(suggestionNode(item, handlers, 'mem-pending'));
  if (memory.status === 'error' && !memory.notes.length) nodes.push(h('p', { class: 'small muted' }, 'No se pudo cargar la memoria.'));
  else if (memory.status === 'loading' && !memory.notes.length) nodes.push(h('p', { class: 'small muted' }, 'Cargando…'));
  else if (!memory.notes.length) nodes.push(h('p', { class: 'small muted' }, 'Todavía no hay notas guardadas.'));
  if (memory.notes.length) nodes.push(h('ul', { class: 'mem-list' }, memory.notes.map(note => noteRow(note, { editingId, confirmingId, handlers }))));
  nodes.push(h('div', { class: 'mem-add' }, input,
    h('div', { class: 'mem-add-row' },
      h('span', { class: 'small muted mem-count' }, `${memory.notes.length} / ${MEMORY_LIMITS.max}`),
      button('Guardar nota', 'btn btn-ghost', () => handlers.onAdd(String(input.value)), 'Guardar nota'))));
  return nodes;
}
