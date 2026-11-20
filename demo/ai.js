// Stand-in for the Gemini client (`client.models.generateContent`). It never calls a model: answers are built by plain
// rules from the request itself, are deterministic, and every free-text answer is labelled as a demo.
const DEMO_TAG = '[Demo]';
const DEMO_NOTE = 'Respuesta de ejemplo escrita por reglas, no por un modelo de IA.';

const reply = (value, modelVersion = 'demo-canned') => ({
  text: typeof value === 'string' ? value : JSON.stringify(value),
  candidates: [{ finishReason: 'STOP' }], modelVersion, usageMetadata: {},
});
const parse = text => { try { return JSON.parse(text); } catch { return null; } };
const textOf = contents => {
  if (typeof contents === 'string') return contents;
  const parts = Array.isArray(contents) ? contents.flatMap(c => c?.parts ?? []) : [];
  return parts.filter(p => typeof p?.text === 'string').map(p => p.text).join('\n');
};
const pick = (list, seed) => list[[...String(seed)].reduce((a, c) => a + c.codePointAt(0), 0) % list.length];
const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text);

function factsOf(text) {
  const match = /<facts>\n([\s\S]*?)\n<\/facts>/.exec(text);
  const parsed = match ? parse(match[1]) : null;
  return parsed?.facts ?? parsed ?? null;
}

// The chat. Figures come straight from the facts block the server sent, so they pass the portal's number check.
function chat(text) {
  const facts = factsOf(text);
  const question = (text.split('User question:\n')[1] ?? '').split('\n\n')[0].toLowerCase();
  const account = facts?.account?.C;
  const lines = [];
  if (account && Number.isFinite(account.purchases)) lines.push(`- Compras en el periodo cerrado más reciente: **${account.purchases}**.`);
  if (account && Number.isFinite(account.spend)) lines.push(`- Gasto: **${account.spend} ${facts.currency}**.`);
  if (account && Number.isFinite(account.cpa)) lines.push(`- CPA: **${account.cpa} ${facts.currency}**.`);
  if (account && Number.isFinite(account.roas)) lines.push(`- ROAS: **${account.roas}**.`);
  const fatigued = (facts?.ads ?? []).filter(a => a.fatigue_state === 'FATIGUED').map(a => a.name).slice(0, 2);
  let topic;
  if (/fatiga|creativ|anuncio|ads?\b|reemplaz/.test(question)) {
    topic = fatigued.length
      ? `Los anuncios con señales de fatiga son: ${fatigued.map(n => `«${n}»`).join(' y ')}. Recomiendo preparar una versión nueva del creativo y revisar el resultado antes de decidir.`
      : 'No veo anuncios con las tres señales de fatiga a la vez. Conviene seguir vigilando frecuencia, CTR y CPA.';
  } else if (/pixel|píxel|embudo|carrito|checkout/.test(question)) {
    topic = 'Para revisar el embudo, compara visitas, carritos, inicios de pago y compras en la vista de Píxel. Recomiendo confirmar que los eventos del servidor y del navegador estén llegando.';
  } else if (/instagram|redes|seguidores|social/.test(question)) {
    topic = 'En Redes puedes ver alcance, seguidores ganados y perdidos, y las publicaciones con mejor resultado. Recomiendo repetir el formato de la publicación más vista.';
  } else if (/presupuesto|escal|invertir|gastar/.test(question)) {
    topic = 'Antes de mover presupuesto, recomiendo confirmar que la campaña cumple el mínimo de muestra y que el CPA está por debajo de tu meta. Los últimos días son provisionales.';
  } else if (/competen|inspiraci|radar/.test(question)) {
    topic = 'En Inspiración puedes revisar los anuncios guardados de otras marcas. Su antigüedad y repetición son señales creativas, no prueban ventas.';
  } else {
    topic = 'Puedo ayudarte a leer ventas, campañas, creativos, píxel y redes con los datos que ya están en el panel.';
  }
  return reply([
    `${DEMO_TAG} ${DEMO_NOTE}`,
    lines.length ? `Con los datos del panel:\n${lines.join('\n')}` : null,
    topic,
    'Este panel usa datos ficticios de Example Co.: ninguna cifra corresponde a una tienda real.',
  ].filter(Boolean).join('\n\n'));
}

function analysis(text, schema) {
  const input = parse(text.slice(text.indexOf('{'))) ?? {};
  const copy = String(input.copy ?? '');
  const opening = clip(copy.split(/[.!?\n]/)[0].trim() || 'el anuncio', 120);
  const recipe = {
    did: clip(`Abre con «${opening}» y cierra con una invitación directa.`, 160),
    why: clip('Podría atraer atención porque habla de una situación cotidiana antes de mostrar el producto.', 160),
    steps: ['Escribe tres aperturas propias con el mismo tema.', 'Muestra el producto real en los primeros segundos.', 'Prueba una sola variable contra tu mejor anuncio actual.'],
    hook: 'Antes de comprar, empieza por esta pregunta.',
    analysis: [
      `${DEMO_TAG} ${DEMO_NOTE}`, `Hook: ${opening}.`, 'Ángulo: situación cotidiana seguida de una propuesta concreta.',
      `Oferta: ${input.cta ? `invitación a «${input.cta}»` : 'no se menciona una oferta'}.`,
      'Hipótesis para probar: una apertura en forma de pregunta puede captar más atención que abrir con el catálogo.',
      'Datos faltantes: no se conocen ventas, gasto ni resultados de este anuncio.',
    ].join('\n'),
  };
  if (schema.required.includes('transcript')) recipe.transcript = '';
  return reply(recipe);
}

function plan(text) {
  const evidence = parse(text) ?? {};
  const ads = evidence.competitor_ads ?? [];
  const chosen = [...new Map(ads.map(a => [a.brand, a])).values()].slice(0, 3);
  const base = chosen.length ? chosen : ads.slice(0, 1);
  const actions = base.map((ad, i) => ({
    title: clip(`Probar un hook inspirado en ${ad.brand}`, 80),
    why: clip(`Referencia observada: ${ad.brand} usa esta apertura en su anuncio ${ad.id}. Es una señal creativa, no una prueba de ventas.`, 220),
    hypothesis: clip('Una apertura que parte de una situación cotidiana puede explicar la propuesta mejor que abrir con el catálogo.', 220),
    priority: `P${i + 1}`, effort: i === 0 ? '60 a 90 minutos' : '45 a 60 minutos',
    script: '0 a 3 s: persona en una situación cotidiana y el hook. 3 a 12 s: producto real y su detalle. 12 a 22 s: presentaciones disponibles. 22 a 30 s: invitación a conocer la tienda.',
    visuals: 'Plano de situación cotidiana, close-up del producto real y captura de la tienda. Dos aperturas distintas con el resto idéntico.',
    cta: 'Descubre más en la tienda.', test: clip('A/B del primer hook; misma audiencia, duración y oferta.', 180),
    success: 'Comparar CTR de enlace y visitas a la página; revisar compras y CPA solo con volumen suficiente. Sin atribuir causalidad a una sola venta.',
    source_ids: [ad.id], own_ad_ids: [],
    hooks: ['Antes de comprar, empieza por esta pregunta.', '¿Sabes qué buscas en este tipo de producto?', 'Elegir bien empieza por tener información.'],
    risks: ['Hipótesis sin validar; no escalar inversión automáticamente.', 'No se analizaron los visuales de esta referencia.'],
    daily: {
      did: clip(`${ad.brand} abre con una situación cotidiana y luego presenta el producto.`, 110),
      why: 'Podría funcionar porque el espectador se reconoce antes de ver una oferta.',
      steps: ['Escribe tres aperturas con la misma situación.', 'Graba el producto real con luz natural.', 'Publica dos versiones con una sola variable distinta.'],
    },
  }));
  return reply({
    summary: `${DEMO_TAG} Plan de ejemplo armado por reglas a partir de los anuncios guardados; no lo generó un modelo de IA.`,
    gaps: ['Modo demo: el plan no usa un modelo de IA.', 'No se conocen ventas ni rentabilidad de los competidores.'], actions,
  });
}

function tags(text) {
  const seed = text;
  return reply({
    persona: pick(['Hogares que disfrutan el café', 'Regalos para amantes del café', 'Cocineros caseros'], seed), desire: pick(['Rituales de la mañana', 'Decorar la cocina', 'Regalar algo con significado'], seed + 'd'),
    usp: 'Hecho a mano', narrative: pick(['Proceso artesanal', 'Producto en uso', 'Lanzamiento'], seed + 'n'), message: pick(['Calidad que dura', 'Cuatro colores', 'Envío a todo el país'], seed + 'm'),
    emotion: pick(['Calma', 'Orgullo', 'Curiosidad'], seed + 'e'), visual_hook: pick(['Producto en primer plano', 'Manos trabajando', 'Mesa servida'], seed + 'v'),
    offer: pick(['Sin oferta explícita', 'Envío gratis', 'Edición limitada'], seed + 'o'), format: pick(['Video corto', 'Imagen única', 'Carrusel'], seed + 'f'), production: pick(['Estudio', 'Taller', 'Contenido de cliente'], seed + 'p'),
  });
}

const landing = () => reply({
  product: 'Coincide: anuncio y página presentan la taza Terra hecha a mano.', promise: 'Coincide: ambos hablan de piezas hechas a mano y de elegir color.',
  emotion: 'No verificable: el anuncio es más cálido que la página, que es informativa.', cta: 'Difiere: el anuncio invita a descubrir y la página pide comprar.',
  action: 'Alinear el CTA del anuncio con el de la página para reducir fricción. Ejemplo de demo; no es una auditoría real.',
});

export function createDemoAgentClient() {
  return {
    models: {
      async generateContent(request) {
        const text = textOf(request.contents);
        const schema = request.config?.responseJsonSchema;
        const system = String(request.config?.systemInstruction ?? '');
        if (schema) {
          const required = schema.required ?? [];
          if (required.includes('recommendations')) return reply({ summary: `${DEMO_TAG} Sin recomendaciones nuevas.`, recommendations: [], data_gaps: [] });
          if (required.includes('analysis')) return analysis(text, schema);
          if (required.includes('actions')) return plan(text);
          if (required.includes('persona')) return tags(text);
          if (required.includes('promise')) return landing();
          return reply({});
        }
        if (/resume una conversaci/i.test(system)) return reply(`- ${DEMO_TAG} Resumen de ejemplo de la conversación.\n- Los datos del panel son ficticios.`);
        return chat(text);
      },
    },
  };
}
