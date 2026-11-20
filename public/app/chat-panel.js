import { h, replace } from '/app/dom.js';
import { shortDate, greeting, truncate, dateTime, ND } from '/app/format.js';
import { icon } from '/app/icons.js';
import { MAX_IMAGES, ACCEPT, ACCEPTED_TYPES, hooks } from '/app/chat-images.js';
import { conversationNodes } from '/app/chat-conversations.js';
import { memoryPanelNodes, suggestionNode, noteProblem, cleanDraft } from '/app/chat-memory.js';

// The Ask-the-agent conversation, shared by the full Preguntar page and the side drawer. Both mount the same panel over
// one in-memory state, so a conversation started in either place continues in the other. Conversations are saved on the
// server (per user); the browser keeps only the id of the open one in sessionStorage, and never any image.
export const MAX_QUESTION = 1000;
const MAX_HISTORY = 8;
const MAX_TURN = 2000;
const MAX_TITLE = 80;

// Suggestion cards of the empty state: the question that gets sent, an icon and a one-line description of what it checks.
export const STARTER_CARDS = Object.freeze([
  { question: '¿Qué campaña debería pausar y por qué?', icon: 'alert-triangle', hint: 'Compara inversión y resultados por campaña.' },
  { question: '¿Qué creativo está funcionando mejor?', icon: 'image', hint: 'Ordena tus anuncios por rendimiento.' },
  { question: '¿Por qué no hay compras esta semana?', icon: 'shopping-bag', hint: 'Revisa dónde se frenan las ventas.' },
  { question: '¿Dónde se pierde la gente en el embudo?', icon: 'trending-down', hint: 'Mira en qué paso baja más el avance.' },
]);
export const STARTERS = STARTER_CARDS.map(card => card.question);

// Composer: it grows with its lines up to six, the counter only shows close to the limit, and the "thinking" hint rotates.
export const MAX_INPUT_LINES = 6;
export const COUNTER_FROM = 800;
export const inputRows = text => Math.min(MAX_INPUT_LINES, Math.max(1, String(text).split('\n').length));
export const THINKING_HINTS = Object.freeze(['Revisando campañas…', 'Calculando embudo…', 'Comparando semanas…', 'Revisando creativos…']);
export const HINT_MS = 2400;
const NEAR_BOTTOM = 80; // px from the end of the log that still counts as "at the bottom"

const DISCLAIMER = 'Las respuestas pueden tener errores; verifica antes de actuar.';

const ERRORS = {
  429: 'Llegaste al límite de preguntas por ahora. Intenta de nuevo más tarde.',
  503: 'El agente no está disponible en este momento.',
  400: 'No se pudo enviar la pregunta. Revisa el texto e intenta de nuevo.',
  413: 'Las imágenes pesan demasiado. Quita alguna e intenta de nuevo.',
};
const OWN_COPY = new Set([400, 413, 429, 503]); // statuses the server sends itself, with their own copy even when the body is empty
const NOTICES = {
  max: `Máximo ${MAX_IMAGES} imágenes por pregunta.`,
  type: 'Solo se aceptan imágenes PNG, JPEG o WEBP.',
  failed: 'No se pudo procesar la imagen.',
  text: 'Escribe una pregunta para acompañar las imágenes.',
};
const IMAGES_NOTE = 'Las imágenes solo se envían con esta pregunta.';
const GENERIC_ERROR = 'No se pudo obtener una respuesta. Intenta de nuevo.';
// The server answers within 85 s (CHAT_DEADLINE_MS) and says so itself; the browser waits a little longer than that.
export const ASK_TIMEOUT_MS = 95000;
export const SLOW_MESSAGE = 'La respuesta tardó demasiado. Intenta de nuevo o haz una pregunta más concreta.';
export const ELAPSED_TICK_MS = 1000;

// `attachments` are the images waiting in the composer: { blob, mime, data (base64), url (blob: URL) }.
// `conversationId` is the saved conversation being continued (null until the server returns one); `conv` is the list of saved
// conversations shown in the drawer and in the left column of the page.
const state = {
  turns: [], pending: false, draft: '', attachments: [], generation: 0, listeners: new Set(),
  conversationId: null, conv: { items: [], status: 'idle' }, listOpen: false, sheetOpen: false, editingId: null, confirmingId: null, menuId: null, query: '', notice: '', restoreTried: false,
  // The agent's memory of decisions: notes both users share, plus the suggestions still waiting for a yes or a no.
  memory: { notes: [], pending: [], status: 'idle' }, memoryOpen: false, memEditingId: null, memConfirmingId: null, memNotice: '', memDraft: '',
};
// A panel that fails to redraw (for example one left over from a torn-down screen) never breaks the others.
const notify = () => { for (const fn of [...state.listeners]) { try { fn(); } catch { /* best effort */ } } };

// Conversation id of the open conversation, kept in sessionStorage so a reload lands where the user was. Blocked storage is fine.
const CONV_KEY = 'bf.chat.conv';
const ID_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const readStoredId = () => { try { const value = globalThis.sessionStorage?.getItem(CONV_KEY); return ID_PATTERN.test(value || '') ? value : null; } catch { return null; } };
const writeStoredId = id => { try { if (id) globalThis.sessionStorage?.setItem(CONV_KEY, id); else globalThis.sessionStorage?.removeItem(CONV_KEY); } catch { /* not persisted */ } };

// Empties the open conversation (turns, draft, images, id). An answer still in flight is discarded.
const revoke = url => { try { URL.revokeObjectURL(url); } catch { /* already gone */ } };
function resetTurns() {
  for (const turn of state.turns) for (const image of turn.images || []) revoke(image.url);
  for (const attachment of state.attachments) revoke(attachment.url);
  state.attachments = [];
  state.turns = [];
  state.draft = '';
  state.pending = false;
  state.generation += 1;
  state.conversationId = null;
  state.listOpen = false;
  state.memoryOpen = false;
  state.sheetOpen = false;
  state.editingId = null;
  state.confirmingId = null;
  state.menuId = null;
  state.notice = '';
  writeStoredId(null);
}
// "Nueva conversación": a clean chat; the saved list stays as it is.
export function newConversation() { resetTurns(); notify(); }
// Logout and session expiry: everything goes, including the cached list of saved conversations.
export function clearConversation() {
  resetTurns();
  state.conv = { items: [], status: 'idle' };
  state.query = '';
  state.memory = { notes: [], pending: [], status: 'idle' };
  state.memEditingId = null;
  state.memConfirmingId = null;
  state.memNotice = '';
  state.memDraft = '';
  state.restoreTried = false;
  notify();
}

// Longest prefix that fits the server limit, cut on a code point so a surrogate pair is never split.
function clip(text, max) {
  let out = '';
  for (const char of String(text)) { if (out.length + char.length > max) break; out += char; }
  return out;
}

const tidy = line => line.replace(/^#{1,6}\s+/, '').trim();

// Inline text to DOM nodes: **x** becomes a <b> element built with createElement, everything else is a text node. A tag inside
// the text (or inside the bold part) stays literal characters; an unmatched or stray marker is dropped, never turned into bold.
const BOLD = /\*\*(.+?)\*\*/g;
const plainPart = text => String(text).replace(/\*\*|__/g, '');
export function richText(text) {
  const source = String(text);
  const nodes = [];
  let last = 0;
  for (const match of source.matchAll(BOLD)) {
    const before = plainPart(source.slice(last, match.index));
    if (before) nodes.push(before);
    const inner = plainPart(match[1]);
    if (inner) nodes.push(h('b', {}, inner));
    last = match.index + match[0].length;
  }
  const rest = plainPart(source.slice(last));
  if (rest) nodes.push(rest);
  return nodes;
}

// Model text to DOM with text nodes only: blank lines split paragraphs, "- " lines become list items. Markup in the
// text stays literal characters; there is no HTML path in this function.
function adCards(cards){
 return (Array.isArray(cards)?cards:[]).filter(a=>/^[\w-]{1,80}$/.test(a.id)).slice(0,3).map(a=>{
  const media='/api/inspiration-media?id='+encodeURIComponent(a.id);
  const preview=a.video?h('video',{controls:true,preload:'none',poster:media+'&kind=image',src:media+'&kind=video'}):h('img',{src:media+'&kind=image',alt:'Anuncio de '+a.brand,loading:'lazy'});
  preview.addEventListener('error',()=>{preview.hidden=true;});
  return h('article',{class:'chat-ad-card'},h('strong',{},a.brand),preview,h('p',{},a.copy),h('a',{href:'https://www.facebook.com/ads/library/?id='+encodeURIComponent(a.id),target:'_blank',rel:'noopener noreferrer'},'Abrir anuncio en Meta ↗'));
 });
}
export function answerNodes(text) {
  const nodes = [];
  for (const block of String(text).replace(/\r/g, '').split(/\n{2,}/)) {
    let paragraph = [];
    let list = null;
    const flushParagraph = () => { if (paragraph.length) nodes.push(h('p', { class: 'chat-text' }, richText(paragraph.join(' ')))); paragraph = []; };
    const flushList = () => { if (list) nodes.push(list); list = null; };
    for (const raw of block.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const item = /^[-*•]\s+(.*)$/.exec(line);
      if (item) {
        flushParagraph();
        list = list || h('ul', { class: 'chat-items' });
        list.append(h('li', {}, richText(tidy(item[1]))));
      } else {
        flushList();
        paragraph.push(tidy(line));
      }
    }
    flushParagraph();
    flushList();
  }
  return nodes;
}

// Plain-text copy of an answer. The clipboard API can be missing or refused: never let that throw into the view.
async function copyText(text, button) {
  let label = 'Copiado';
  try { await navigator.clipboard.writeText(text); } catch { label = 'No se pudo copiar'; }
  button.textContent = label;
  const timer = setTimeout(() => { button.textContent = 'Copiar'; }, 1500);
  if (typeof timer?.unref === 'function') timer.unref();
}

const stampNode = turn => (typeof turn.at === 'string' && turn.at && dateTime(turn.at) !== ND ? h('time', { class: 'chat-time small muted', datetime: turn.at }, dateTime(turn.at)) : null);
const nowIso = () => new Date().toISOString();

// ctx: { onFeedback(turn, value), onRegenerate() or null }. Feedback is local to this session: it is not sent anywhere.
function turnNode(turn, ctx) {
  if (turn.role === 'user') {
    const shots = turn.images?.length ? h('div', { class: 'chat-user-images' }, turn.images.map(image => h('img', { class: 'chat-thumb', src: image.url, alt: 'Captura adjunta' }))) : null;
    return h('div', { class: 'chat-turn chat-user' }, shots, h('p', { class: 'chat-text' }, turn.text), stampNode(turn));
  }
  if (turn.role === 'error') {
    const retry = turn.retry && ctx.onRetry ? h('button', { type: 'button', class: 'text-btn chat-retry', onclick: () => ctx.onRetry() }, icon('refresh-cw', { size: 12 }), 'Reintentar') : null;
    return h('div', { class: 'chat-turn chat-error', role: 'alert' }, h('p', { class: 'chat-text' }, turn.text), retry);
  }
  const meta = [turn.served_by || turn.model, turn.skill_version ? `Guía: ${turn.skill_version}` : null, turn.facts_date ? `Datos al ${shortDate(turn.facts_date)}` : null].filter(Boolean).join(' · ');
  const copy = h('button', { type: 'button', class: 'text-btn' }, 'Copiar');
  copy.addEventListener('click', () => copyText(turn.text, copy));
  const rate = (value, label, iconName) => {
    const button = h('button', { type: 'button', class: 'chat-act', 'aria-label': label, 'aria-pressed': turn.feedback === value ? 'true' : 'false' }, icon(iconName, { size: 14 }));
    button.addEventListener('click', () => ctx.onFeedback(turn, value));
    return button;
  };
  const regenerate = ctx.onRegenerate ? h('button', { type: 'button', class: 'text-btn chat-regen', onclick: () => ctx.onRegenerate() }, icon('refresh-cw', { size: 12 }), 'Regenerar') : null;
  return h('div', { class: 'chat-turn chat-agent' },
    h('span', { class: 'chat-avatar', 'aria-hidden': 'true' }, icon('sparkles', { size: 14 })),
    h('div', { class: 'chat-agent-body' }, answerNodes(turn.text),adCards(turn.ads),
      h('div', { class: 'chat-foot' }, copy, rate(1, 'Respuesta útil', 'thumbs-up'), rate(-1, 'Respuesta poco útil', 'thumbs-down'), regenerate,
        meta ? h('span', { class: 'small muted' }, meta) : null, stampNode(turn))));
}

// `variant`: 'page' (greeting, conversation header, composer docked under the log) or 'drawer' (compact; the drawer owns
// the header). `view()` returns the allowlisted view name sent as `context_view`, or null. `onList(open)` tells the drawer
// header whether the conversation list is showing, and `onMemory(open)` the same for the memory panel.
// Returns { node, focus, destroy, toggleList, isListOpen, toggleMemory, isMemoryOpen }.
export function createChatPanel({ api, variant = 'page', view = () => null, onList = () => {}, onMemory = () => {} }) {
  const drawer = variant === 'drawer';
  const root = h('div', { class: drawer ? 'chat-page chat-panel-drawer' : 'chat-page' });
  const list = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
  const counter = h('span', { class: 'chat-counter small muted' }, `0/${MAX_QUESTION}`);
  counter.hidden = true;
  const input = h('textarea', { class: 'chat-input', rows: 1, maxlength: MAX_QUESTION, 'aria-label': 'Tu pregunta', placeholder: 'Pregunta sobre tus campañas…' });
  const sendButton = h('button', { type: 'button', class: 'btn-send', 'aria-label': 'Enviar' }, icon('arrow-up', { size: 16 }));
  // The counter stays quiet until the user is near the limit; the box grows with its lines (CSS caps the height at six lines).
  const paintCounter = () => {
    const length = String(input.value).length;
    counter.textContent = `${length}/${MAX_QUESTION}`;
    counter.hidden = length <= COUNTER_FROM;
    counter.className = length >= MAX_QUESTION - 50 ? 'chat-counter small is-near' : 'chat-counter small muted';
  };
  // Rows follow the lines the user typed; browsers with `field-sizing: content` also grow for wrapped text (see the CSS).
  const fitInput = () => { input.setAttribute('rows', String(inputRows(input.value))); };
  const fileInput = h('input', { type: 'file', accept: ACCEPT, multiple: true, 'aria-hidden': 'true', tabindex: -1 });
  fileInput.hidden = true;
  const attachButton = h('button', { type: 'button', class: 'icon-btn chat-attach', 'aria-label': 'Adjuntar imagen' }, icon('image', { size: 18 }));
  const tray = h('div', { class: 'chat-tray' });
  const notice = h('p', { class: 'small chat-notice', role: 'status' });
  const composer = h('div', { class: 'chat-compose' }, tray, notice, input, fileInput, h('div', { class: 'chat-actions' }, h('div', { class: 'chat-actions-left' }, attachButton, counter), sendButton));
  const setNotice = text => { notice.textContent = text; };
  const removeAttachment = attachment => { revoke(attachment.url); state.attachments = state.attachments.filter(a => a !== attachment); notify(); };
  const starters = h('div', { class: 'chat-starters', role: 'group', 'aria-label': 'Preguntas sugeridas' }, STARTER_CARDS.map(card => h('button', { type: 'button', class: 'chat-starter', 'aria-label': card.question, onclick: () => { ask(card.question); } },
    h('span', { class: 'icon-tile chat-starter-icon' }, icon(card.icon, { size: 18 })),
    h('span', { class: 'chat-starter-text' }, h('span', { class: 'chat-starter-title' }, card.question), h('span', { class: 'chat-starter-hint small muted' }, card.hint)))));
  const disclaimer = h('p', { class: 'small muted chat-disclaimer' }, DISCLAIMER);
  const scroller = drawer ? h('div', { class: 'chat-scroll' }) : list;
  const listArea = h('div', { class: 'conv-panel' });
  const searchInput = h('input', { class: 'conv-search-input', type: 'search', placeholder: 'Buscar conversaciones', 'aria-label': 'Buscar conversaciones', autocomplete: 'off', maxlength: MAX_TITLE });
  const hasApi = typeof api?.get === 'function';

  // ---- scrolling ----
  // The log follows the newest message when the user is at the bottom; if they scrolled up to read, a pill offers the jump.
  const pill = h('button', { type: 'button', class: 'chat-new-pill' }, '↓ Nuevos mensajes');
  pill.hidden = true;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const reducedMotion = () => { try { return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches); } catch { return false; } };
  const newestOf = el => el.lastElementChild || el.children?.[el.children.length - 1] || null;
  function atBottom() {
    if (drawer) {
      if (!finite(scroller.scrollHeight) || !finite(scroller.clientHeight) || !finite(scroller.scrollTop)) return true;
      return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < NEAR_BOTTOM;
    }
    const doc = globalThis.document?.documentElement;
    if (!doc || !finite(globalThis.scrollY) || !finite(globalThis.innerHeight) || !finite(doc.scrollHeight)) return true;
    return doc.scrollHeight - globalThis.scrollY - globalThis.innerHeight < NEAR_BOTTOM;
  }
  function scrollNewest({ instant = false } = {}) {
    const target = newestOf(list);
    const behavior = instant || reducedMotion() ? 'auto' : 'smooth';
    if (target && typeof target.scrollIntoView === 'function') target.scrollIntoView({ behavior, block: 'end' });
    else if (drawer) { try { scroller.scrollTop = scroller.scrollHeight; } catch { /* layout is best effort */ } }
    pill.hidden = true;
  }
  pill.addEventListener('click', () => scrollNewest());
  const onScroll = () => { if (!pill.hidden && atBottom()) pill.hidden = true; };
  if (drawer) scroller.addEventListener('scroll', onScroll); else globalThis.addEventListener?.('scroll', onScroll);

  // "Pensando…": a hint that changes every few seconds while an answer is pending.
  const hintEl = h('span', { class: 'thinking-hint small muted' }, THINKING_HINTS[0]);
  let hintTimer = null;
  let hintAt = 0;
  const startHints = () => {
    if (hintTimer) return;
    hintAt = 0;
    hintEl.textContent = THINKING_HINTS[0];
    hintTimer = setInterval(() => { hintAt = (hintAt + 1) % THINKING_HINTS.length; hintEl.textContent = THINKING_HINTS[hintAt]; }, HINT_MS);
    if (typeof hintTimer?.unref === 'function') hintTimer.unref();
  };
  const stopHints = () => { if (hintTimer) clearInterval(hintTimer); hintTimer = null; stopElapsed(); };
  // "Pensando… 12 s": whole seconds since the question was sent, written with textContent once a second.
  const elapsedEl = h('span', { class: 'thinking-elapsed small muted' }, '');
  let elapsedTimer = null;
  let elapsedFrom = 0;
  const paintElapsed = () => { const s = Math.max(0, Math.floor((Date.now() - elapsedFrom) / 1000)); elapsedEl.textContent = s > 0 ? `${s} s` : ''; };
  const startElapsed = () => {
    if (elapsedTimer) return;
    elapsedFrom = state.askedAt || Date.now();
    paintElapsed();
    elapsedTimer = setInterval(paintElapsed, ELAPSED_TICK_MS);
    if (typeof elapsedTimer?.unref === 'function') elapsedTimer.unref();
  };
  function stopElapsed() { if (elapsedTimer) clearInterval(elapsedTimer); elapsedTimer = null; elapsedEl.textContent = ''; }

  // ---- saved conversations ----
  const validItem = item => item && typeof item === 'object' && ID_PATTERN.test(item.id || '') && typeof item.title === 'string' && typeof item.updated_at === 'string';
  async function refreshList() {
    if (!hasApi) return;
    if (state.conv.status !== 'ready') state.conv.status = 'loading';
    let result = null;
    try { result = await api.get('conversations'); } catch { result = null; }
    if (result?.ok && Array.isArray(result.data?.conversations)) {
      state.conv = { items: result.data.conversations.filter(validItem).map(item => ({ id: item.id, title: item.title, updated_at: item.updated_at, message_count: Number(item.message_count) || 0 })), status: 'ready' };
    } else state.conv.status = 'error';
    notify();
  }
  const forgetItem = id => { state.conv.items = state.conv.items.filter(item => item.id !== id); };

  // Opens a saved conversation: its messages replace the open chat. An answer still in flight for another one is discarded.
  async function select(id) {
    if (!hasApi || !ID_PATTERN.test(String(id))) return;
    const generation = ++state.generation;
    state.pending = false;
    state.sheetOpen = false;
    state.memoryOpen = false; // choosing a conversation always lands on the chat
    state.notice = '';
    let result = null;
    try { result = await api.get('conversation', { id }); } catch { result = null; }
    if (generation !== state.generation) return;
    if (result?.ok && Array.isArray(result.data?.messages)) {
      for (const turn of state.turns) for (const image of turn.images || []) revoke(image.url);
      for (const attachment of state.attachments) revoke(attachment.url);
      state.attachments = [];
      state.draft = '';
      state.turns = result.data.messages.filter(m => (m?.role === 'user' || m?.role === 'agent') && typeof m.text === 'string')
        .map(m => ({ role: m.role, text: m.text, ads:m.ads, ...(typeof m.model === 'string' ? { model: m.model } : {}), ...(typeof m.at === 'string' && m.at ? { at: m.at } : {}) }));
      state.conversationId = id;
      state.listOpen = false;
      writeStoredId(id);
    } else if (result?.status === 404) {
      forgetItem(id);
      if (readStoredId() === id) writeStoredId(null);
      if (state.conversationId === id) state.conversationId = null;
      state.notice = 'Esa conversación ya no existe.';
    } else state.notice = 'No se pudo abrir la conversación. Intenta de nuevo.';
    notify();
  }

  async function saveRename(id, raw) {
    const title = clip(String(raw).replace(/\s+/g, ' ').trim(), MAX_TITLE);
    if (!title) return;
    const result = await api.post('conversation/rename', { id, title });
    if (result.ok) {
      const saved = typeof result.data?.title === 'string' ? result.data.title : title;
      state.conv.items = state.conv.items.map(item => (item.id === id ? { ...item, title: saved } : item));
      state.editingId = null;
      state.notice = '';
    } else state.notice = 'No se pudo renombrar la conversación.';
    notify();
  }
  async function confirmDelete(id) {
    const result = await api.post('conversation/delete', { id });
    state.confirmingId = null;
    if (result.ok || result.status === 404) {
      forgetItem(id);
      if (state.conversationId === id) { resetTurns(); state.conv = { ...state.conv }; }
      state.notice = '';
    } else state.notice = 'No se pudo eliminar la conversación.';
    notify();
  }
  const handlers = {
    onSelect: id => { select(id); },
    onNew: () => { newConversation(); },
    onRenameStart: id => { state.editingId = id; state.confirmingId = null; state.menuId = null; notify(); },
    onRenameCancel: () => { state.editingId = null; notify(); },
    onRenameSave: (id, raw) => { saveRename(id, raw); },
    onDeleteStart: id => { state.confirmingId = id; state.editingId = null; state.menuId = null; notify(); },
    onMenu: id => { state.menuId = state.menuId === id ? null : id; notify(); },
    onMenuClose: () => { state.menuId = null; notify(); },
    onMemory: () => { toggleMemory(); },
    onStarter: question => { newConversation(); ask(question); },
    onDeleteCancel: () => { state.confirmingId = null; notify(); },
    onDeleteConfirm: id => { confirmDelete(id); },
  };
  // Typing in the search field repaints only the list; the input node is reused, so it is focused again after the swap.
  const paintList = () => {
    const typing = globalThis.document?.activeElement === searchInput;
    if (searchInput.value !== state.query) searchInput.value = state.query;
    replace(listArea, conversationNodes({
      items: state.conv.items, currentId: state.conversationId, status: state.conv.status, editingId: state.editingId, confirmingId: state.confirmingId, menuId: state.menuId,
      notice: state.notice, query: state.query, search: searchInput, starters: STARTERS, handlers,
      memory: { count: state.memory.notes.length, pending: state.memory.pending.length > 0, pressed: state.memoryOpen },
    }));
    if (typing) { try { searchInput.focus(); const end = String(searchInput.value).length; searchInput.setSelectionRange?.(end, end); } catch { /* not focusable */ } }
  };
  searchInput.addEventListener('input', () => { state.query = String(searchInput.value); paintList(); });
  // A click anywhere outside an open row menu closes it.
  const closeMenuOutside = event => {
    if (!state.menuId) return;
    const inside = event?.target?.closest?.('.conv-actions');
    if (!inside) { state.menuId = null; notify(); }
  };
  if (typeof document !== 'undefined') document.addEventListener('click', closeMenuOutside);

  // ---- memory of decisions ----
  const validNote = n => n && typeof n === 'object' && ID_PATTERN.test(n.id || '') && typeof n.text === 'string' && n.text.length > 0;
  const noteOf = n => ({ id: n.id, text: n.text, created_at: String(n.created_at ?? ''), source: n.source === 'agent' ? 'agent' : 'user' });
  async function refreshMemory() {
    if (!hasApi) return;
    if (state.memory.status === 'idle') state.memory.status = 'loading';
    let result = null;
    try { result = await api.get('memory'); } catch { result = null; }
    if (result?.ok && Array.isArray(result.data?.notes) && Array.isArray(result.data?.pending)) {
      state.memory = { notes: result.data.notes.filter(validNote).map(noteOf), pending: result.data.pending.filter(validNote).map(n => ({ id: n.id, text: n.text })), status: 'ready' };
    } else state.memory.status = 'error';
    notify();
  }
  const MEMORY_ERRORS = {
    400: 'La nota no es válida. Revisa el texto (sin enlaces, máximo 200 caracteres).',
    404: 'Esa nota ya no existe.',
    409: 'La memoria está llena (máximo 30 notas). Elimina alguna para guardar otra.',
    429: 'Demasiados cambios. Intenta de nuevo más tarde.',
  };
  // One write to the memory API. Returns the response data, or null after setting the notice.
  async function memoryCall(route, body) {
    let result;
    try { result = await api.post(route, body); } catch { result = { ok: false, status: 0 }; }
    if (!result?.ok) {
      state.memNotice = MEMORY_ERRORS[result?.status] || 'No se pudo guardar el cambio. Intenta de nuevo.';
      if (result?.status === 404) refreshMemory();
      notify();
      return null;
    }
    state.memNotice = '';
    return result.data || {};
  }
  const memoryHandlers = {
    onBack: () => { state.memoryOpen = false; notify(); },
    onDraft: value => { state.memDraft = value; },
    onAdd: async raw => {
      const problem = noteProblem(raw);
      if (problem) { state.memNotice = problem; notify(); return; }
      const data = await memoryCall('memory/add', { text: cleanDraft(raw) });
      if (validNote(data?.note)) { state.memory.notes = [...state.memory.notes, noteOf(data.note)]; state.memDraft = ''; }
      notify();
    },
    onEditStart: id => { state.memEditingId = id; state.memConfirmingId = null; notify(); },
    onEditCancel: () => { state.memEditingId = null; notify(); },
    onEditSave: async (id, raw) => {
      const problem = noteProblem(raw);
      if (problem) { state.memNotice = problem; notify(); return; }
      const data = await memoryCall('memory/edit', { id, text: cleanDraft(raw) });
      if (validNote(data?.note)) { state.memory.notes = state.memory.notes.map(n => (n.id === id ? noteOf(data.note) : n)); state.memEditingId = null; }
      notify();
    },
    onDeleteStart: id => { state.memConfirmingId = id; state.memEditingId = null; notify(); },
    onDeleteCancel: () => { state.memConfirmingId = null; notify(); },
    onDeleteConfirm: async id => {
      const data = await memoryCall('memory/delete', { id });
      state.memConfirmingId = null;
      if (data) state.memory.notes = state.memory.notes.filter(n => n.id !== id);
      notify();
    },
    onApprove: async id => {
      const data = await memoryCall('memory/approve', { id });
      if (validNote(data?.note)) { state.memory.pending = state.memory.pending.filter(n => n.id !== id); state.memory.notes = [...state.memory.notes, noteOf(data.note)]; }
      notify();
    },
    onDiscard: async id => {
      const data = await memoryCall('memory/discard', { id });
      if (data) state.memory.pending = state.memory.pending.filter(n => n.id !== id);
      notify();
    },
  };
  const memArea = h('div', { class: 'mem-panel' });
  const suggestArea = h('div', { class: 'chat-suggestions' });
  const paintMemory = () => {
    replace(memArea, state.memoryOpen ? memoryPanelNodes({ memory: state.memory, editingId: state.memEditingId, confirmingId: state.memConfirmingId, notice: state.memNotice, draft: state.memDraft, handlers: memoryHandlers }) : null);
    // Suggestions the agent made are shown under the conversation, the newest three; the panel lists all of them.
    replace(suggestArea, state.turns.length ? state.memory.pending.slice(-3).map(item => suggestionNode(item, memoryHandlers, 'chat-suggest')) : null);
  };

  // Page: a left column (a sheet on small screens). Drawer: the list replaces the chat while the header toggle is on.
  const sheetButton = h('button', { type: 'button', class: 'btn btn-ghost chat-history-toggle', 'aria-expanded': 'false', 'aria-controls': 'chat-history' }, icon('history', { size: 14 }), 'Conversaciones');
  const closeSheet = h('button', { type: 'button', class: 'icon-btn chat-history-close', 'aria-label': 'Cerrar conversaciones' }, icon('x', { size: 16 }));
  const memoryButtons = [0].map(() => h('button', { type: 'button', class: 'btn btn-ghost chat-memory-toggle', 'aria-pressed': 'false' }, icon('bookmark', { size: 14 }), 'Memoria'));
  const aside = h('aside', { class: 'chat-history', id: 'chat-history', 'aria-label': 'Conversaciones' },
    h('div', { class: 'chat-history-head' }, h('h2', { class: 'chat-history-title' }, 'Conversaciones'), closeSheet), listArea);
  const backdrop = h('div', { class: 'chat-history-backdrop' });
  const setSheet = open => { state.sheetOpen = open; notify(); };
  sheetButton.addEventListener('click', () => setSheet(!state.sheetOpen));
  closeSheet.addEventListener('click', () => setSheet(false));
  backdrop.addEventListener('click', () => setSheet(false));
  aside.addEventListener('keydown', event => { if (event.key === 'Escape' && state.sheetOpen) { event.preventDefault(); setSheet(false); } });
  const shell = h('div', { class: 'chat-shell' }, backdrop, aside, h('div', { class: 'chat-main' }, h('div', { class: 'chat-history-bar' }, sheetButton, memoryButtons[0]), root));
  const toggleList = () => {
    state.listOpen = !state.listOpen;
    if (state.listOpen) { state.memoryOpen = false; refreshList(); }
    notify();
    return state.listOpen;
  };
  const toggleMemory = () => {
    state.memoryOpen = !state.memoryOpen;
    if (state.memoryOpen) { state.listOpen = false; state.sheetOpen = false; state.memNotice = ''; refreshMemory(); }
    notify();
    return state.memoryOpen;
  };
  for (const b of memoryButtons) b.addEventListener('click', () => toggleMemory());

  // Two layouts over the same composer node: an empty state, and a conversation with the composer pinned below.
  const layout = pending => {
    const empty = !state.turns.length && !pending;
    if (drawer && state.listOpen) {
      replace(root, h('div', { class: 'chat-scroll' }, listArea));
      return;
    }
    if (state.memoryOpen) {
      replace(root, drawer ? h('div', { class: 'chat-scroll' }, memArea) : memArea);
      return;
    }
    if (drawer) {
      replace(scroller, empty
        ? h('div', { class: 'chat-empty' }, h('p', { class: 'chat-headline' }, '¿En qué te ayudo con tus anuncios?'), starters)
        : [list, suggestArea]);
      replace(root, scroller, h('div', { class: 'chat-dock' }, pill, composer, disclaimer));
      return;
    }
    if (empty) {
      replace(root, h('div', { class: 'chat-empty' },
        h('h1', { class: 'chat-greeting' }, greeting()),
        h('p', { class: 'chat-headline' }, '¿En qué te ayudo con tus anuncios?'),
        composer, starters, disclaimer));
      return;
    }
    const first = state.turns.find(t => t.role === 'user');
    const saved = state.conv.items.find(item => item.id === state.conversationId);
    replace(root,
      h('div', { class: 'chat-head' },
        h('span', { class: 'chat-title' }, saved ? truncate(saved.title, 60) : truncate(first?.text || 'Conversación', 60)),
        h('button', { type: 'button', class: 'text-btn', onclick: () => { newConversation(); } }, 'Nueva conversación')),
      list,
      suggestArea,
      h('div', { class: 'chat-dock' }, pill, composer, disclaimer));
  };
  let seenTurns = 0;
  let seenGeneration = -1;
  let seenPending = false;
  const lastUserIndex = () => state.turns.map(t => t.role).lastIndexOf('user');
  // Regenerate only the very last answer, and only when the question had no screenshots (they are never kept).
  const canRegenerate = () => !state.pending && state.turns.at(-1)?.role === 'agent' && lastUserIndex() >= 0 && !state.turns[lastUserIndex()].images?.length;
  const onFeedback = (turn, value) => { turn.feedback = turn.feedback === value ? 0 : value; notify(); };
  const draw = () => {
    const pending = state.pending;
    const stick = atBottom();
    layout(pending);
    paintList();
    paintMemory();
    for (const b of memoryButtons) b.setAttribute('aria-pressed', state.memoryOpen ? 'true' : 'false');
    try { onMemory(state.memoryOpen); } catch { /* the header is best effort */ }
    aside.className = state.sheetOpen ? 'chat-history is-open' : 'chat-history';
    backdrop.hidden = !state.sheetOpen;
    sheetButton.setAttribute('aria-expanded', state.sheetOpen ? 'true' : 'false');
    try { onList(state.listOpen); } catch { /* the header is best effort */ }
    const regenerate = canRegenerate() ? () => { regenerateLast(); } : null;
    replace(list, state.turns.map((turn, i) => turnNode(turn, { onFeedback, onRegenerate: i === state.turns.length - 1 ? regenerate : null, onRetry: i === state.turns.length - 1 && !pending ? retryLast : null })), pending
      ? h('div', { class: 'thinking', role: 'status' }, h('span', { class: 'thinking-label' }, 'Pensando…'), elapsedEl, h('span', { class: 'thinking-dots', 'aria-hidden': 'true' }, [0, 1, 2].map(() => h('span', { class: 'thinking-dot' }))), hintEl)
      : null);
    if (pending) { startHints(); startElapsed(); } else stopHints();
    if (input.value !== state.draft) input.value = state.draft;
    paintCounter();
    fitInput();
    replace(sendButton, pending ? h('span', { class: 'btn-send-spinner', 'aria-hidden': 'true' }) : icon('arrow-up', { size: 16 }));
    sendButton.className = pending ? 'btn-send is-pending' : 'btn-send';
    sendButton.disabled = pending;
    if (pending) sendButton.setAttribute('aria-busy', 'true'); else sendButton.removeAttribute('aria-busy');
    replace(tray, state.attachments.length ? [
      h('div', { class: 'chat-attachments' }, state.attachments.map((attachment, i) => {
        const remove = h('button', { type: 'button', class: 'chat-remove', 'aria-label': 'Quitar imagen' }, '×');
        remove.addEventListener('click', () => removeAttachment(attachment));
        return h('div', { class: 'chat-attachment' }, h('img', { class: 'chat-thumb', src: attachment.url, alt: `Captura ${i + 1}` }), remove);
      })),
      h('p', { class: 'small muted chat-note' }, IMAGES_NOTE),
    ] : null);
    tray.hidden = !state.attachments.length;
    // The user's own message always scrolls; an answer follows only when they were already at the bottom, else the pill appears.
    const sent = state.turns.at(-1)?.role === 'user' || (pending && !seenPending);
    if (!state.turns.length) pill.hidden = true;
    else if (state.generation !== seenGeneration) scrollNewest({ instant: true });
    else if (state.turns.length > seenTurns || (pending && !seenPending)) { if (sent || stick) scrollNewest(); else pill.hidden = false; }
    seenTurns = state.turns.length;
    seenGeneration = state.generation;
    seenPending = pending;
  };

  // Files are processed one after another (a chained promise), so two quick picks can never overshoot the limit.
  let adding = Promise.resolve();
  const addFiles = list => { const files = [...list]; adding = adding.then(() => addAll(files)); return adding; };
  async function addAll(files) {
    let problem = '';
    for (const file of files) {
      if (!ACCEPTED_TYPES.has(file?.type)) { problem = NOTICES.type; continue; }
      if (state.attachments.length >= MAX_IMAGES) { problem = NOTICES.max; break; }
      try {
        const prepared = await hooks.prepare(file);
        state.attachments.push({ ...prepared, url: URL.createObjectURL(prepared.blob) });
      } catch { problem = NOTICES.failed; }
    }
    setNotice(problem);
    notify();
  }

  async function ask(raw) {
    const question = String(raw ?? '').trim();
    if (state.pending) return;
    if (!question) { if (state.attachments.length) setNotice(NOTICES.text); return; }
    // A saved conversation keeps its own history on the server, so only its id travels; without one, the last turns go along.
    const body = { question };
    if (state.conversationId) body.conversation_id = state.conversationId;
    else body.history = state.turns.filter(t => t.role === 'user' || t.role === 'agent').slice(-MAX_HISTORY).map(t => ({ role: t.role, text: clip(t.text, MAX_TURN) }));
    const context = view();
    if (context) body.context_view = context;
    const turn = { role: 'user', text: question, at: nowIso() };
    if (state.attachments.length) {
      body.images = state.attachments.map(({ mime, data }) => ({ mime, data }));
      // The composer URLs are released now; the bubble gets its own, released when the conversation is cleared.
      turn.images = state.attachments.map(({ blob }) => ({ url: URL.createObjectURL(blob) }));
      for (const attachment of state.attachments) revoke(attachment.url);
      state.attachments = [];
    }
    setNotice('');
    state.turns.push(turn);
    state.draft = '';
    state.pending = true;
    state.askedAt = Date.now();
    const generation = state.generation;
    notify();
    const result = await api.post('ask', body, { timeoutMs: ASK_TIMEOUT_MS });
    if (generation !== state.generation) { refreshList(); return; }
    if (result.ok && typeof result.data?.answer === 'string') {
      state.turns.push({ role: 'agent', text: result.data.answer, ads:result.data.ads, at: nowIso(), model: result.data.model, served_by: result.data.served_by, skill_version: result.data.skill_version, facts_date: result.data.facts_date });
      const id = result.data.conversation_id;
      if (typeof id === 'string' && ID_PATTERN.test(id)) { state.conversationId = id; writeStoredId(id); refreshList(); }
      // Notes the agent suggests arrive with the answer; they wait for the user's yes or no.
      for (const proposal of Array.isArray(result.data.memory_proposals) ? result.data.memory_proposals : []) {
        if (validNote(proposal) && !state.memory.pending.some(n => n.id === proposal.id)) state.memory.pending = [...state.memory.pending, { id: proposal.id, text: proposal.text }];
      }
    } else if (result.status === 404 && state.conversationId) {
      state.conversationId = null;
      writeStoredId(null);
      state.turns.push({ role: 'error', text: 'Esa conversación ya no existe. Tu próxima pregunta iniciará una nueva.' });
      refreshList();
    } else {
      const overloaded = result.data?.error === 'agent_overloaded' && typeof result.data.message === 'string';
      // A timeout (ours or the server's), a dropped connection or a platform error page (504 HTML, no JSON) get the same
      // friendly notice and a button that sends the same question again.
      const slow = result.timedOut || result.data?.error === 'agent_timeout' || result.status === 0 || (!overloaded && !OWN_COPY.has(result.status) && (result.data === null || result.status >= 500 && !ERRORS[result.status]));
      const retry = (slow || overloaded) && !turn.images?.length;
      const text = slow ? SLOW_MESSAGE : overloaded ? result.data.message : (ERRORS[result.status] || GENERIC_ERROR);
      state.turns.push({ role: 'error', text, ...(retry ? { retry: true } : {}) });
    }
    state.pending = false;
    notify();
  }

  // Asks the last question again: the question and its answer leave the log, the new exchange takes their place.
  function regenerateLast() {
    if (!canRegenerate()) return;
    const at = lastUserIndex();
    const question = state.turns[at].text;
    state.turns.splice(at);
    ask(question);
  }

  // Sends the question that got no answer again: the failed exchange leaves the log and the new one takes its place.
  function retryLast() {
    if (state.pending || state.turns.at(-1)?.role !== 'error' || !state.turns.at(-1).retry) return;
    const at = lastUserIndex();
    if (at < 0) return;
    const question = state.turns[at].text;
    state.turns.splice(at);
    ask(question);
  }

  input.addEventListener('input', () => { state.draft = String(input.value); paintCounter(); fitInput(); });
  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault();
    ask(input.value);
  });
  sendButton.addEventListener('click', () => { ask(input.value); });

  attachButton.addEventListener('click', () => { fileInput.click(); });
  fileInput.addEventListener('change', () => { const files = [...(fileInput.files || [])]; fileInput.value = ''; addFiles(files); });
  const dragging = on => { composer.className = on ? 'chat-compose is-dragover' : 'chat-compose'; };
  const carriesFiles = transfer => Array.from(transfer?.types || []).includes('Files');
  composer.addEventListener('dragover', event => { if (!carriesFiles(event.dataTransfer)) return; event.preventDefault(); dragging(true); });
  composer.addEventListener('dragleave', () => dragging(false));
  composer.addEventListener('drop', event => {
    dragging(false);
    const files = [...(event.dataTransfer?.files || [])];
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });
  // Pasted screenshots: `files` first, then file items. Pasted text is left to the browser.
  input.addEventListener('paste', event => {
    const data = event.clipboardData;
    let files = [...(data?.files || [])];
    if (!files.length) files = [...(data?.items || [])].filter(item => item.kind === 'file').map(item => item.getAsFile?.()).filter(Boolean);
    files = files.filter(file => String(file.type).startsWith('image/'));
    if (!files.length) return;
    event.preventDefault();
    addFiles(files);
  });

  state.listeners.add(draw);
  draw();
  // The page shows the list right away; the drawer loads it when the user opens it. A stored id restores once per session.
  if (!drawer && state.conv.status === 'idle') refreshList();
  if (state.memory.status === 'idle') refreshMemory();
  if (!state.restoreTried) {
    state.restoreTried = true;
    const stored = readStoredId();
    if (stored && !state.turns.length && !state.conversationId) select(stored);
  }
  return {
    node: drawer ? root : shell,
    focus: () => { try { input.focus(); } catch { /* not focusable yet */ } },
    toggleList,
    isListOpen: () => state.listOpen,
    toggleMemory,
    isMemoryOpen: () => state.memoryOpen,
    destroy: () => {
      state.listeners.delete(draw);
      stopHints();
      if (!drawer) globalThis.removeEventListener?.('scroll', onScroll);
      if (typeof document !== 'undefined') document.removeEventListener?.('click', closeMenuOutside);
    },
  };
}
