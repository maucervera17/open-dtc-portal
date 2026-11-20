import { h } from '/app/dom.js';
import { icon } from '/app/icons.js';
import { createChatPanel, newConversation } from '/app/chat-panel.js';

// The agent panel, docked as a column of the app shell (like a side agent in a hosting dashboard). The shell mounts it once,
// outside the view container, so navigating never destroys it. On desktop it shrinks the page; below 1024px the same element
// becomes a full-screen sheet. It shares the in-memory conversation with the Preguntar page.
//
// `initiallyOpen` and `width` come from the shell's storage. `onState({ open, visible })` reports the user's choice and what is
// actually on screen (it is hidden while the full Preguntar page is showing). `onWidth(px)` and `onExpand()` are the shell's hooks.
export const CHAT_WIDTH = Object.freeze({ min: 320, max: 640, initial: 400, step: 24 });
export const clampWidth = value => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(CHAT_WIDTH.max, Math.max(CHAT_WIDTH.min, n)) : CHAT_WIDTH.initial;
};

export function createChatDrawer({ brand = 'DTC Portal', api, view, initiallyOpen = false, width = CHAT_WIDTH.initial, onState = () => {}, onWidth = () => {}, onExpand = () => {} }) {
  let listButton = null; // built below; the panel reports list and memory changes that happen inside it (for example choosing a conversation)
  let memoryButton = null;
  const panel = createChatPanel({
    api, variant: 'drawer', view,
    onList: open => { listButton?.setAttribute('aria-pressed', open ? 'true' : 'false'); },
    onMemory: open => { memoryButton?.setAttribute('aria-pressed', open ? 'true' : 'false'); },
  });
  let current = clampWidth(width);

  const control = (label, name, onclick, className = 'icon-btn') => h('button', { type: 'button', class: className, 'aria-label': label, title: label, onclick }, icon(name, { size: 16 }));
  const reset = control('Nueva conversación', 'square-pen', () => { newConversation(); panel.focus(); });
  listButton = control('Conversaciones', 'history', () => { panel.toggleList(); });
  listButton.setAttribute('aria-pressed', panel.isListOpen() ? 'true' : 'false');
  memoryButton = control('Memoria', 'bookmark', () => { panel.toggleMemory(); });
  memoryButton.setAttribute('aria-pressed', panel.isMemoryOpen() ? 'true' : 'false');
  const expand = control('Expandir', 'maximize-2', () => onExpand(), 'icon-btn chat-expand');
  expand.setAttribute('title', 'Abrir en pantalla completa');
  const close = control('Cerrar', 'x', () => setOpen(false));
  const handle = h('div', { class: 'chat-resize', role: 'separator', 'aria-orientation': 'vertical', 'aria-label': 'Ajustar el ancho del panel', tabindex: 0 });
  const paintHandle = () => { handle.setAttribute('aria-valuemin', String(CHAT_WIDTH.min)); handle.setAttribute('aria-valuemax', String(CHAT_WIDTH.max)); handle.setAttribute('aria-valuenow', String(current)); };
  const dialog = h('aside', { class: 'chat-drawer', role: 'dialog', 'aria-modal': 'false', 'aria-label': `Agente ${brand}` },
    handle,
    h('div', { class: 'chat-drawer-head' },
      h('span', { class: 'icon-tile chat-agent-icon' }, icon('sparkles', { size: 16 })),
      h('h2', { class: 'chat-drawer-title' }, `Agente ${brand}`),
      listButton, memoryButton, reset, expand, close),
    panel.node);
  const fab = h('button', { type: 'button', class: 'chat-fab', 'aria-label': 'Preguntar al agente', 'aria-haspopup': 'dialog', 'aria-expanded': 'false' }, icon('message-circle', { size: 24 }));

  let isOpen = Boolean(initiallyOpen);
  let suppressed = false; // the full Preguntar page is on screen: the panel steps aside without forgetting its state
  let opener = fab;
  const paint = () => {
    const visible = isOpen && !suppressed;
    dialog.hidden = !visible;
    fab.hidden = visible || suppressed;
    fab.setAttribute('aria-expanded', visible ? 'true' : 'false');
    onState({ open: isOpen, visible });
    return visible;
  };
  function setOpen(open, { focus = true } = {}) {
    isOpen = open;
    paint();
    if (!focus) return;
    if (open) panel.focus();
    else { try { opener.focus(); } catch { /* the opener is gone */ } }
  }
  const open = from => { if (from) opener = from; setOpen(true); };
  // Escape only closes the panel while focus is inside it, so it never competes with a modal or a page control.
  const onKey = event => { if (event.key === 'Escape' && !dialog.hidden && dialog.contains(document.activeElement)) setOpen(false); };

  const setWidth = next => {
    current = clampWidth(next);
    paintHandle();
    onWidth(current);
  };
  handle.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); setWidth(current + CHAT_WIDTH.step); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); setWidth(current - CHAT_WIDTH.step); }
    else if (event.key === 'Home') { event.preventDefault(); setWidth(CHAT_WIDTH.min); }
    else if (event.key === 'End') { event.preventDefault(); setWidth(CHAT_WIDTH.max); }
  });
  // Pointer drag: the panel hugs the right edge, so its width is the distance from the pointer to the viewport edge.
  handle.addEventListener('pointerdown', event => {
    event.preventDefault();
    const move = moved => setWidth((globalThis.innerWidth || 0) - moved.clientX);
    const stop = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', stop); document.removeEventListener('pointercancel', stop); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', stop);
    document.addEventListener('pointercancel', stop);
  });

  fab.addEventListener('click', () => { opener = fab; setOpen(true); });
  document.addEventListener('keydown', onKey);
  paintHandle();
  paint();
  onWidth(current);

  return {
    dialog, fab, open,
    close: () => setOpen(false, { focus: false }),
    isOpen: () => !dialog.hidden,
    // Called by the shell on every navigation: the panel hides on Preguntar and comes back as it was elsewhere.
    setSuppressed: value => { if (suppressed === Boolean(value)) return; suppressed = Boolean(value); paint(); },
    destroy: () => { document.removeEventListener('keydown', onKey); panel.destroy(); },
  };
}
