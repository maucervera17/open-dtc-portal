// Preserve an explicit extension capture across the login flow. No writes happen until confirmation.
try{const capture=new URLSearchParams(location.hash.split('?')[1]||'').get('capture');if(capture&&capture.length<50000)sessionStorage.setItem('dtc-capture',capture);}catch{}
import integraciones from '/app/views/integraciones.js';
import analiticas from '/app/views/analiticas.js';
import inspiracion from '/app/views/inspiracion.js';
import { h, replace } from '/app/dom.js';
import { createApi } from '/app/api.js';
import { DESKTOP_QUERY } from '/app/breakpoints.js';
import { parseHash } from '/app/router.js';
import { renderLogin } from '/app/views/login.js';
import { renderVerify } from '/app/views/verify.js';
import resumen from '/app/views/resumen.js';
import campanas from '/app/views/campanas.js';
import creativos from '/app/views/creativos.js';
import pixel from '/app/views/pixel.js';
import alertas from '/app/views/alertas.js';
import preguntar from '/app/views/preguntar.js';
import { clearConversation } from '/app/chat-panel.js';
import { createChatDrawer } from '/app/chat-drawer.js';
import social from '/app/views/social.js';
import { icon } from '/app/icons.js';
import { setAlertCount, onAlertCount } from '/app/ui.js';
import { alertCount } from '/app/views/alertas.js';

// Registered data views, in navigation order. Each entry: { route, label, render(ctx) => Node | Promise<Node> }.
export const VIEWS = [resumen, analiticas, campanas, creativos, pixel, alertas, preguntar, social, inspiracion, integraciones];

const DEFAULT_ROUTE = 'resumen';

// Navigation icons by route. Views do not carry their own, so the shell owns the mapping.
const NAV_ICONS = { integraciones: 'help-circle', analiticas: 'bar-chart-3', resumen: 'home', campanas: 'bar-chart-3', creativos: 'image', pixel: 'activity', alertas: 'bell', preguntar: 'message-circle', social: 'users', inspiracion: 'image' };
const COLLAPSE_KEY = 'bf.sidebar.collapsed';

// localStorage can throw (blocked storage, private mode): the sidebar then simply forgets its state.
function readCollapsed() {
  try { return globalThis.localStorage?.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}
function writeCollapsed(collapsed) {
  try { globalThis.localStorage?.setItem(COLLAPSE_KEY, collapsed ? '1' : '0'); } catch { /* not persisted */ }
}

// Web storage can throw (blocked storage, private mode). Every read and write is guarded: state is then kept in memory only.
const readStore = (kind, key) => { try { return globalThis[kind]?.getItem(key) ?? null; } catch { return null; } };
const writeStore = (kind, key, value) => { try { globalThis[kind]?.setItem(key, value); } catch { /* not persisted */ } };
const CHAT_OPEN_KEY = 'bf.chat.open';
const CHAT_WIDTH_KEY = 'bf.chat.width';
const isDesktop = () => { try { return globalThis.matchMedia ? globalThis.matchMedia(DESKTOP_QUERY).matches : true; } catch { return true; } };

// Count badge for a nav item. Hidden (and empty) while there are no alerts.
const makeBadge = (className = 'nav-badge') => h('span', { class: className });
const paintBadge = (el, count) => { el.hidden = count === 0; el.textContent = el.className.includes('nav-dot') ? '' : (count ? String(count) : ''); };

export function start(root, { location, history, api: injected } = {}) {
  let me = null;
  let cleanups = []; // per view: charts, subscriptions
  let frame = null; // the app shell, built once per session and reused by every view
  let navigation = 0;
  let alertTotal = 0;

  const api = injected || createApi({ onUnauthorized: () => { me = null; teardown(); clearConversation(); show(); } });
  const runCleanups = () => { for (const fn of cleanups) { try { fn(); } catch { /* chart teardown is best effort */ } } cleanups = []; };
  const go = hash => { history.replaceState(null, '', `/app/${hash}`); show(); };
  // Logout and session expiry: the docked agent goes away with the shell and its stored open flag is cleared.
  function teardown() {
    if (!frame) return;
    frame.chat.close();
    frame.destroy();
    frame = null;
  }

  function screen(node) { runCleanups(); teardown(); replace(root, node); }

  async function show() {
    const current = ++navigation;
    const { name, params } = parseHash(location.hash);

    if (name === 'verify') {
      const token = params.t || '';
      history.replaceState(null, '', '/app/#/verify'); // keep the token out of the address bar and history
      return screen(renderVerify({ api, token, onDone: async () => { me = null; await load(); go('#/' + (sessionStorage.getItem('dtc-capture')?'inspiracion':DEFAULT_ROUTE)); } }));
    }
    if (!me) await load();
    if (current !== navigation) return;
    if (!me) return screen(renderLogin({ api }));
    if (name === 'login' || name === '') return go('#/' + (VIEWS[0]?.route || DEFAULT_ROUTE));
    shell(name, current);
  }

  async function load() {
    const result = await api.me();
    me = result.ok ? result.data : null;
  }

  // Builds the persistent frame: top bar, sidebar, content column and the docked agent. Navigation only swaps what is inside
  // `main` and the active markers, so the agent panel (and its conversation, draft and scroll) is never re-created.
  function buildFrame() {
    const frameCleanups = [];
    const badges = [];
    const alertLinks = [];
    const marks = []; // { el, route|routes, on, off } active-state bookkeeping per navigation
    const badge = className => { const el = makeBadge(className); badges.push(el); return el; };
    let collapsed = readCollapsed();
    let current = VIEWS[0];
    const shellEl = h('div', { class: collapsed ? 'shell is-collapsed' : 'shell' });
    const workspace = h('div', { class: 'workspace' });
    const main = h('main', { class: 'main', id: 'view' });

    const sidebarLinks = VIEWS.filter(v => v.route !== 'inspiracion' || me.flags?.inspiration).map(v => {
      const link = h('a', { href: `/app/#/${v.route}`, class: 'tab', title: v.label },
        icon(NAV_ICONS[v.route] || 'help-circle', { size: 20, class: 'tab-icon' }),
        h('span', { class: 'tab-label' }, v.label),
        v.route === 'alertas' ? badge() : null);
      if (v.route === 'alertas') alertLinks.push(link);
      marks.push({ el: link, routes: [v.route], on: 'tab is-active', off: 'tab', current: true });
      return link;
    });
    const toggle = h('button', { type: 'button', class: 'sidebar-toggle', 'aria-expanded': collapsed ? 'false' : 'true', 'aria-label': 'Ocultar barra lateral' },
      icon('chevrons-right', { size: 20, class: 'toggle-icon' }), h('span', { class: 'tab-label' }, 'Ocultar'));
    toggle.addEventListener('click', () => {
      collapsed = !collapsed;
      shellEl.className = shellClass();
      toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggle.setAttribute('aria-label', collapsed ? 'Mostrar barra lateral' : 'Ocultar barra lateral');
      writeCollapsed(collapsed);
    });
    // Below 1024px the sidebar is an off-canvas drawer opened from the hamburger in the top bar: backdrop, Escape, closes on
    // navigation and keeps Tab inside while it is open.
    let navOpen = false;
    const shellClass = () => `shell${collapsed ? ' is-collapsed' : ''}${navOpen ? ' nav-open' : ''}`;
    const burger = h('button', { type: 'button', class: 'icon-btn nav-toggle', 'aria-label': 'Abrir menú', 'aria-expanded': 'false', 'aria-controls': 'sidebar-nav' },
      icon('menu', { size: 20 }), badge('nav-dot'));
    const backdrop = h('div', { class: 'nav-backdrop' });
    backdrop.hidden = true;
    const closeNav = h('button', { type: 'button', class: 'icon-btn nav-close', 'aria-label': 'Cerrar menú' }, icon('x', { size: 18 }));
    const nav = h('nav', { class: 'tabs sidebar', id: 'sidebar-nav', 'aria-label': 'Secciones' },
      h('div', { class: 'sidebar-head' }, h('span', { class: 'sidebar-title' }, 'Menú'), closeNav),
      h('div', { class: 'sidebar-items' }, sidebarLinks), toggle);

    const trapStops = () => [closeNav, ...sidebarLinks];
    const setNav = (open, { focus = true } = {}) => {
      if (navOpen === open) return;
      navOpen = open;
      shellEl.className = shellClass();
      backdrop.hidden = !open;
      burger.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body?.classList[open ? 'add' : 'remove']('modal-open');
      if (!focus) return;
      try { (open ? closeNav : burger).focus(); } catch { /* not focusable */ }
    };
    burger.addEventListener('click', () => setNav(!navOpen));
    closeNav.addEventListener('click', () => setNav(false));
    backdrop.addEventListener('click', () => setNav(false));
    for (const link of sidebarLinks) link.addEventListener('click', () => setNav(false, { focus: false }));
    const onNavKey = event => {
      if (!navOpen) return;
      if (event.key === 'Escape') { setNav(false); return; }
      if (event.key !== 'Tab') return;
      const stops = trapStops();
      const at = stops.indexOf(document.activeElement);
      if (event.shiftKey && at <= 0) { event.preventDefault(); stops.at(-1).focus(); }
      else if (!event.shiftKey && (at === stops.length - 1 || at < 0)) { event.preventDefault(); stops[0].focus(); }
    };
    const onNavFocus = event => { if (navOpen && !nav.contains(event.target)) closeNav.focus(); };
    document.addEventListener('keydown', onNavKey);
    document.addEventListener('focusin', onNavFocus);
    frameCleanups.push(() => { document.removeEventListener('keydown', onNavKey); document.removeEventListener('focusin', onNavFocus); setNav(false, { focus: false }); });
    const mqDesktop = globalThis.matchMedia?.(DESKTOP_QUERY);
    const onDesktop = event => { if (event.matches) setNav(false, { focus: false }); };
    mqDesktop?.addEventListener?.('change', onDesktop);
    frameCleanups.push(() => mqDesktop?.removeEventListener?.('change', onDesktop));

    // The alerts count feeds the sidebar badge, the hamburger dot and every page header bell.
    // setAlertCount is the single source: the Alertas page calls it as soon as something is read, and this frame follows at once.
    const paintAll = count => setAlertCount(count);
    frameCleanups.push(onAlertCount(count => {
      alertTotal = count;
      for (const el of badges) paintBadge(el, count);
      for (const link of alertLinks) { if (count) link.setAttribute('aria-label', `Alertas (${count})`); else link.removeAttribute('aria-label'); }
    }));
    paintAll(alertTotal);

    // Shown on every view when the user token is close to its known expiry.
    const banner = me.token_warning ? h('div', { class: 'banner', role: 'alert' },
      h('strong', {}, 'El token de acceso de Meta vence pronto. '),
      'Genera un token de usuario del sistema para evitar interrupciones en el panel.') : null;
    const doLogout = async () => { await api.logout(); me = null; teardown(); clearConversation(); go('#/login'); };
    const logout = h('button', { type: 'button', class: 'btn btn-ghost btn-logout', onclick: doLogout }, 'Salir');

    // Phones: the email and Salir collapse into an avatar button that opens a small menu (text only, closes on Escape,
    // an outside click and navigation).
    const email = me.email || '';
    const accountBtn = h('button', { type: 'button', class: 'account-btn', 'aria-label': 'Cuenta', 'aria-haspopup': 'menu', 'aria-expanded': 'false' },
      h('span', { class: 'avatar' }, (email.trim()[0] || '?').toUpperCase()));
    const accountMenu = h('div', { class: 'account-menu', role: 'menu' },
      h('span', { class: 'account-email small' }, email),
      h('button', { type: 'button', class: 'btn btn-ghost account-out', role: 'menuitem', onclick: doLogout }, 'Salir'));
    accountMenu.hidden = true;
    const account = h('div', { class: 'account' }, accountBtn, accountMenu);
    const setAccount = open => {
      accountMenu.hidden = !open;
      accountBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    accountBtn.addEventListener('click', () => setAccount(accountMenu.hidden));
    const onAccountClick = event => { if (!accountMenu.hidden && !account.contains(event.target)) setAccount(false); };
    const onAccountKey = event => { if (event.key === 'Escape' && !accountMenu.hidden) { setAccount(false); try { accountBtn.focus(); } catch { /* not focusable */ } } };
    document.addEventListener('click', onAccountClick);
    document.addEventListener('keydown', onAccountKey);
    frameCleanups.push(() => { document.removeEventListener('click', onAccountClick); document.removeEventListener('keydown', onAccountKey); });

    // The agent panel is a docked grid column of the workspace: it shrinks the page instead of covering it. It is mounted once
    // here (never inside `main`), and its open state and width survive reloads through web storage.
    const askPill = h('button', { type: 'button', class: 'ask-pill', 'aria-label': 'Preguntar al agente' }, 'Pregúntale al agente…');
    let ready = false; // the initial paint must not overwrite what was stored (for example the open flag on a phone)
    const chat = createChatDrawer({
      brand: me.brand,
      api,
      view: () => current?.route,
      initiallyOpen: isDesktop() && readStore('sessionStorage', CHAT_OPEN_KEY) === '1',
      width: readStore('localStorage', CHAT_WIDTH_KEY) === null ? undefined : Number(readStore('localStorage', CHAT_WIDTH_KEY)),
      onState: ({ open, visible }) => {
        workspace.className = visible ? 'workspace is-docked' : 'workspace';
        if (ready) writeStore('sessionStorage', CHAT_OPEN_KEY, open ? '1' : '0');
      },
      onWidth: px => { workspace.style.setProperty('--chat-w', `${px}px`); if (ready) writeStore('localStorage', CHAT_WIDTH_KEY, String(px)); },
      onExpand: () => { chat.close(); go('#/preguntar'); },
    });
    ready = true;
    askPill.addEventListener('click', () => chat.open(askPill));
    // Phones: the pill is replaced by a compact icon button that opens the same panel.
    const askIcon = h('button', { type: 'button', class: 'icon-btn ask-icon', 'aria-label': 'Preguntar al agente', 'aria-haspopup': 'dialog' }, icon('message-circle', { size: 20 }));
    askIcon.addEventListener('click', () => chat.open(askIcon));

    replace(root,
      h('div', { class: 'announce' }, `Panel de Meta Ads · ${me.brand || 'DTC Portal'}`),
      h('header', { class: 'topbar' },
        burger,
        h('a', { class: 'brand', href: `/app/#/${VIEWS[0]?.route || DEFAULT_ROUTE}` }, h('img', { class: 'brand-logo', src: '/app/brand/logo-wordmark.svg', alt: me.brand || 'DTC Portal', width: 107, height: 24 })),
        askPill,
        askIcon,
        h('div', { class: 'user' }, h('span', { class: 'user-email' }, email), logout, account)),
      workspace,
      backdrop,
      chat.fab);
    replace(shellEl,
      nav,
      h('div', { class: 'content' },
        banner,
        main,
        h('footer', { class: 'footnote' }, 'Cifras en MXN. Atribución predeterminada de Ads Manager.')));
    replace(workspace, shellEl, chat.dialog);

    return {
      main, chat,
      // Points the active markers, the ask pill and the panel at the view being shown.
      enter(view, token) {
        current = view;
        for (const mark of marks) {
          const active = mark.routes.includes(view.route);
          mark.el.className = active ? mark.on : mark.off;
          if (mark.current) { if (active) mark.el.setAttribute('aria-current', 'page'); else mark.el.removeAttribute('aria-current'); }
        }
        askPill.hidden = view.route === 'preguntar'; // the page is the chat
        askIcon.hidden = view.route === 'preguntar';
        setAccount(false);
        chat.setSuppressed(view.route === 'preguntar');
        setNav(false, { focus: false });
        paintAll(alertTotal);
        if (typeof api.get === 'function') {
          Promise.resolve(api.get('alerts', {})).then(result => { alertTotal = alertCount(result); if (token === navigation && frame) paintAll(alertTotal); }).catch(() => {});
        }
      },
      destroy() { for (const fn of frameCleanups) { try { fn(); } catch { /* best effort */ } } chat.destroy(); },
    };
  }

  function shell(name, token) {
    runCleanups();
    const view = VIEWS.find(v => v.route === name) || VIEWS[0];
    if (!frame) frame = buildFrame();
    frame.enter(view, token);
    const { main } = frame;
    if (!view) {
      replace(main, h('div', { class: 'card' }, h('h1', { class: 'card-title' }, 'Sesión iniciada'), h('p', { class: 'muted' }, 'Las secciones del panel se habilitarán próximamente.')));
      return;
    }
    replace(main, h('p', { class: 'muted loading' }, 'Cargando…'));
    Promise.resolve(view.render({ api, me, onCleanup: fn => cleanups.push(fn) }))
      .then(node => { if (token === navigation) replace(main, node); })
      .catch(() => { if (token === navigation) replace(main, h('div', { class: 'card' }, h('p', { class: 'muted' }, 'No se pudo cargar esta sección. Intenta de nuevo.'))); });
  }

  show();
  return { show };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  const root = document.getElementById('app');
  if (root) {
    const app = start(root, { location: window.location, history: window.history });
    window.addEventListener('hashchange', app.show);
  }
}
