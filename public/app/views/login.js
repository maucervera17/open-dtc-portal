import { h } from '/app/dom.js';

// The confirmation is identical whatever the server answers, so the screen never reveals who is allowed in.
export function renderLogin({ api }) {
  const email = h('input', { type: 'email', name: 'email', autocomplete: 'email', required: true, placeholder: 'tu@correo.com', class: 'input', 'aria-label': 'Correo electrónico' });
  const button = h('button', { type: 'submit', class: 'btn btn-primary' }, 'Enviar enlace de acceso');
  const message = h('p', { class: 'form-note', role: 'status' });
  const form = h('form', {
    class: 'form',
    onsubmit: async event => {
      event.preventDefault();
      const value = email.value.trim().toLowerCase();
      if (!value) return;
      button.disabled = true;
      await api.requestLink(value);
      message.textContent = 'Si tu correo está autorizado, recibirás un enlace de acceso en unos minutos. El enlace caduca en 15 minutos.';
      button.disabled = false;
    },
  }, h('label', { class: 'label' }, 'Correo electrónico', email), button, message);
  return h('section', { class: 'auth-card' },
    h('div', { class: 'brand-card' }, h('img', { class: 'brand-logo', src: '/app/brand/logo-wordmark.svg', alt: 'DTC Portal', width: 240, height: 54 })),
    h('p', { class: 'kicker' }, 'Panel de Meta Ads'),
    h('h1', { class: 'auth-title' }, 'Acceso privado'),
    h('p', { class: 'muted' }, 'Te enviaremos un enlace de un solo uso.'),
    form);
}
