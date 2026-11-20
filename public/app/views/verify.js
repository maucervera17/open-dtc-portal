import { h } from '/app/dom.js';

const TOKEN = /^[A-Za-z0-9_-]{43}$/;

// Rendering never calls the API: mail scanners that prefetch the link must not burn the single-use token.
// Only the explicit button click consumes it.
export function renderVerify({ api, token, onDone }) {
  const back = h('a', { href: '/app/#/login', class: 'link' }, 'Solicitar un nuevo enlace');
  if (!TOKEN.test(String(token || ''))) {
    return h('section', { class: 'auth-card' },
      h('div', { class: 'brand-card' }, h('img', { class: 'brand-logo', src: '/app/brand/logo-wordmark.svg', alt: 'DTC Portal', width: 240, height: 54 })),
      h('h1', { class: 'auth-title' }, 'Enlace no válido'),
      h('p', { class: 'muted' }, 'Este enlace no es válido. Solicita uno nuevo para entrar.'),
      back);
  }
  let busy = false;
  const message = h('p', { class: 'form-note', role: 'status' });
  const button = h('button', {
    type: 'button',
    class: 'btn btn-primary',
    onclick: async () => {
      if (busy) return;
      busy = true;
      button.disabled = true;
      message.textContent = '';
      const result = await api.consume(token);
      if (result.ok) { onDone(result.data); return; }
      message.textContent = 'El enlace no es válido o ya expiró. Solicita uno nuevo.';
      button.disabled = false;
      busy = false;
    },
  }, 'Entrar');
  return h('section', { class: 'auth-card' },
    h('div', { class: 'brand-card' }, h('img', { class: 'brand-logo', src: '/app/brand/logo-wordmark.svg', alt: 'DTC Portal', width: 240, height: 54 })),
    h('h1', { class: 'auth-title' }, 'Confirma tu acceso'),
    h('p', { class: 'muted' }, 'Pulsa el botón para iniciar sesión en este dispositivo.'),
    button, message, back);
}
