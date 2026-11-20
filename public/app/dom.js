// Tiny element builder. Text always goes through textContent or text nodes, and
// inline styling is refused: the CSP allows classes and CSSOM only.
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name === 'text') el.textContent = String(value);
    else if (name === 'style') continue;
    else if (name.startsWith('on')) { if (typeof value === 'function') el.addEventListener(name.slice(2), value); }
    else el.setAttribute(name, value === true ? '' : String(value));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    el.append(typeof child === 'object' ? child : document.createTextNode(String(child)));
  }
}

export function replace(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}
