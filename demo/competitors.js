// Fictional competitor brands and ads for the demo's creative-intelligence module. Shaped like the ScrapeCreators
// Ad Library payload so the portal's normalizer, radar and library run on them unchanged. All names are invented.
import { shift } from '../lib/dates.js';

export const COMPETITORS = [
  { id: 'alpha', name: 'Example Alpha', website: 'https://alpha.example.com/', page_id: '200000000000001', category: 'Café de especialidad', ig: 'examplealpha' },
  { id: 'beta', name: 'Example Beta', website: 'https://beta.example.com/', page_id: '200000000000002', category: 'Hogar y cerámica', ig: 'examplebeta' },
  { id: 'gamma', name: 'Example Gamma', website: 'https://gamma.example.com/', page_id: '200000000000003', category: 'Utensilios de cocina', ig: 'examplegamma' },
  { id: 'delta', name: 'Example Delta', website: 'https://delta.example.com/', page_id: '200000000000004', category: 'Regalos y cajas de temporada', ig: 'exampledelta' },
];

// [body, title, cta, format, started N days ago, ended N days ago | null, similar ads in the group, landing slug]
const SPECS = {
  alpha: [
    ['¿Tu café de la mañana merece más? Recibe granos recién tostados en casa.', 'Suscripción de café', 'Suscríbete', 'IMAGE', 64, null, 4, 'suscripcion'],
    ['¿Tu café de la mañana merece más? Prueba el lote de este mes.', 'Lote del mes', 'Comprar', 'VIDEO', 41, null, 3, 'lote-del-mes'],
    ['Tres orígenes, tres perfiles. Elige el tuyo con el kit de descubrimiento.', 'Kit de descubrimiento', 'Ver kit', 'DCO', 30, null, 1, 'kit-descubrimiento'],
    ['Tostado esta semana, en tu puerta en dos días.', 'Tostado fresco', 'Ordenar', 'IMAGE', 18, null, 2, 'fresco'],
    ['Aprende a preparar café de filtro en cinco minutos.', 'Guía de preparación', 'Leer guía', 'VIDEO', 9, null, 1, 'guia'],
    ['Edición de invierno: notas de canela y cacao.', 'Edición de invierno', 'Descubrir', 'IMAGE', 52, 21, 1, 'invierno'],
  ],
  beta: [
    ['Hecho a mano, pensado para durar. Conoce nuestra línea de tazas.', 'Línea de tazas', 'Ver tazas', 'IMAGE', 70, null, 5, 'tazas'],
    ['Hecho a mano, pensado para durar. Cada pieza es única.', 'Piezas únicas', 'Explorar', 'VIDEO', 48, null, 5, 'piezas-unicas'],
    ['Renueva tu mesa con tonos tierra.', 'Colección tierra', 'Ver colección', 'DCO', 26, null, 1, 'tierra'],
    ['Envío gratis a todo el país en pedidos seleccionados [condiciones en el sitio].', 'Envío gratis', 'Comprar', 'IMAGE', 14, null, 2, 'envio'],
    ['Un set de cuatro platos para estrenar cocina.', 'Set de platos', 'Ver set', 'IMAGE', 33, 12, 1, 'platos'],
    ['Detrás del taller: así nace cada plato.', 'El taller', 'Conocer más', 'VIDEO', 6, null, 1, 'taller'],
    ['Regalos con significado: cerámica personalizada.', 'Personalizados', 'Personalizar', 'IMAGE', 22, null, 1, 'personalizados'],
  ],
  gamma: [
    ['El cuchillo que no necesitas afilar cada mes.', 'Cuchillo de chef', 'Ver cuchillo', 'VIDEO', 55, null, 2, 'cuchillo'],
    ['Cocina más rápido con la tabla de corte modular.', 'Tabla modular', 'Comprar', 'IMAGE', 37, null, 1, 'tabla'],
    ['Cinco utensilios, un solo cajón ordenado.', 'Set de utensilios', 'Ver set', 'DCO', 20, null, 1, 'utensilios'],
    ['Ofertas de temporada en utensilios seleccionados.', 'Temporada', 'Ver ofertas', 'IMAGE', 11, null, 3, 'temporada'],
    ['Prueba nuestra sartén y devuélvela si no te convence [30 días].', 'Sartén antiadherente', 'Probar', 'VIDEO', 44, 8, 1, 'sarten'],
    ['Cocinar en casa, más fácil.', 'Cocina fácil', 'Descubrir', 'IMAGE', 5, null, 1, 'facil'],
  ],
  delta: [
    ['El regalo perfecto en una caja: café, taza y una nota a mano.', 'Caja de regalo', 'Regalar', 'IMAGE', 58, null, 3, 'caja'],
    ['El regalo perfecto en una caja: elige tu combinación.', 'Arma tu caja', 'Armar caja', 'VIDEO', 35, null, 3, 'arma-tu-caja'],
    ['Pedidos de regalo antes del 15 de diciembre llegan a tiempo.', 'Fechas de entrega', 'Ordenar ya', 'IMAGE', 8, null, 1, 'fechas'],
    ['Cajas corporativas para equipos pequeños.', 'Cajas corporativas', 'Cotizar', 'IMAGE', 29, null, 1, 'corporativas'],
    ['Lo que dicen quienes ya regalaron una caja.', 'Reseñas', 'Leer reseñas', 'VIDEO', 16, null, 1, 'resenas'],
    ['Edición limitada de otoño.', 'Edición otoño', 'Ver edición', 'DCO', 61, 25, 1, 'otono'],
  ],
};

export const adId = (brandIndex, i) => String(9000000010000 + brandIndex * 100 + i + 1);
export const imageUrl = id => `https://scontent-demo.fbcdn.net/v/demo/ad-${id}.png`;

// Raw provider-shaped ads for one brand, relative to the demo's "today".
export function rawAdsFor(brand, D) {
  const brandIndex = COMPETITORS.findIndex(b => b.id === brand.id);
  return (SPECS[brand.id] || []).map(([body, title, cta, format, startedAgo, endedAgo, similar, slug], i) => {
    const id = adId(brandIndex, i);
    const start = Date.parse(`${shift(D, -startedAgo)}T15:00:00Z`) / 1000;
    const end = endedAgo ? Date.parse(`${shift(D, -endedAgo)}T15:00:00Z`) / 1000 : null;
    return {
      ad_archive_id: id, page_id: brand.page_id, page_name: brand.name, collation_count: similar, collation_id: `${brand.id}-${similar}-${i}`,
      is_active: !endedAgo, start_date: start, ...(end ? { end_date: end } : {}), publisher_platform: format === 'VIDEO' ? ['INSTAGRAM', 'FACEBOOK'] : ['FACEBOOK', 'INSTAGRAM', 'AUDIENCE_NETWORK'],
      snapshot: {
        page_id: brand.page_id, page_name: brand.name, body: { text: body }, title, cta_text: cta,
        display_format: format, link_url: `${brand.website}products/${slug}?utm_source=facebook&utm_medium=paid&utm_campaign=${slug}`,
        images: format === 'VIDEO' ? [] : [{ original_image_url: imageUrl(id) }],
        videos: format === 'VIDEO' ? [{ video_preview_image_url: imageUrl(id) }] : [],
        cards: format === 'DCO' ? [0, 1, 2].map(c => ({ body, title: `${title} ${c + 1}`, original_image_url: imageUrl(id), link_url: `${brand.website}products/${slug}-${c + 1}` })) : [],
      },
    };
  });
}

export const allRawAds = D => COMPETITORS.flatMap(b => rawAdsFor(b, D));
