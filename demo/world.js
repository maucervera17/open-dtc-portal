// The fictional brand behind the demo: "Example Co." sells ceramics and coffee gear. Everything here is invented and
// deterministic (same day, same numbers), expressed as daily per-ad metrics. The fake Graph API aggregates these rows
// the way Meta would, so the portal's real collectors, validators and views run on them untouched.
import { shift, dayStartMs } from '../lib/dates.js';
import { spendUnit, minorDigits } from '../lib/locale.js';

export const BRAND = 'Example Co.';
export const ACCOUNT_ID = '1234567890123';
export const PIXEL_ID = '5550001234567';
export const IG_ID = '17841400000000001';
export const IG_USERNAME = 'examplecoshop';
export const PAGE_ID = '100000000000001';
export const SITE = 'https://www.example.com';
// The fictional account's currency and time zone, as the fake Graph reports them. Any valid pair works: the amounts below are
// written for a 200-unit "USD 10" and scaled to the currency, so a demo in EUR or JPY stays plausible.
export const DEMO_PROFILE = Object.freeze({ currency: 'USD', timezone: 'America/New_York' });
const BASE_UNIT = 200;

// "-0500" style UTC offset of a time zone at the start of a calendar day, from the platform tz database (daylight saving aware).
export function offsetAt(date, timeZone) {
  const part = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' }).formatToParts(new Date(dayStartMs(date, timeZone))).find(p => p.type === 'timeZoneName')?.value || 'GMT';
  const m = /GMT([+-])(\d{2}):?(\d{2})?/.exec(part);
  return m ? `${m[1]}${m[2]}${m[3] || '00'}` : '+0000';
}

const DAY = 86400000;

function hashOf(text) {
  let h = 1779033703 ^ String(text).length;
  for (const ch of String(text)) { h = Math.imul(h ^ ch.codePointAt(0), 3432918353); h = (h << 13) | (h >>> 19); }
  return h >>> 0;
}
// Uniform [0, 1) from any list of parts. Pure.
export function rand(...parts) {
  let t = (hashOf(parts.join('|')) + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max, ...parts) => min + (max - min) * rand(...parts);
// Whole number whose expectation is x: small counts still vary day to day.
const stochastic = (x, ...parts) => Math.floor(x + rand(...parts));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const CAMPAIGNS = [
  { key: 'evergreen', name: 'Ventas | Catálogo Evergreen', objective: 'OUTCOME_SALES', budget: 90000 },
  { key: 'terra', name: 'Ventas | Lanzamiento Taza Terra', objective: 'OUTCOME_SALES', budget: 60000 },
  { key: 'retarget', name: 'Retargeting | Carrito abandonado', objective: 'OUTCOME_SALES', budget: 30000 },
  { key: 'traffic', name: 'Tráfico | Guías y blog', objective: 'OUTCOME_TRAFFIC', budget: 25000 },
  { key: 'profile', name: 'Crecimiento | Perfil de Instagram', objective: 'OUTCOME_TRAFFIC', budget: 20000 },
  { key: 'engage', name: 'Interacción | Contenido de clientes', objective: 'OUTCOME_ENGAGEMENT', budget: 15000 },
  { key: 'buenfin', name: 'Ventas | Prueba Black Friday (pausada)', objective: 'OUTCOME_SALES', budget: 40000, status: 'PAUSED' },
];

const ADSETS = [
  { key: 'broad', campaign: 'evergreen', name: 'Amplia US 25-54', goal: 'OFFSITE_CONVERSIONS', dest: 'WEBSITE' },
  { key: 'interests', campaign: 'evergreen', name: 'Intereses hogar y café', goal: 'OFFSITE_CONVERSIONS', dest: 'WEBSITE' },
  { key: 'hotsale', campaign: 'evergreen', name: 'Cyber Week (terminado)', goal: 'OFFSITE_CONVERSIONS', dest: 'WEBSITE', endOffset: 6 },
  { key: 'lookalike', campaign: 'terra', name: 'Lookalike compradores 1%', goal: 'OFFSITE_CONVERSIONS', dest: 'WEBSITE' },
  { key: 'visitors', campaign: 'retarget', name: 'Visitantes 14 días', goal: 'OFFSITE_CONVERSIONS', dest: 'WEBSITE' },
  { key: 'guides', campaign: 'traffic', name: 'Lectores de guías', goal: 'LANDING_PAGE_VIEWS', dest: 'WEBSITE' },
  { key: 'visits', campaign: 'profile', name: 'Visitas al perfil', goal: 'PROFILE_VISIT', dest: 'INSTAGRAM_PROFILE' },
  { key: 'social', campaign: 'engage', name: 'Interacción con publicaciones', goal: 'POST_ENGAGEMENT', dest: 'ON_POST' },
  { key: 'combo', campaign: 'buenfin', name: 'Combos Black Friday', goal: 'OFFSITE_CONVERSIONS', dest: 'WEBSITE' },
];

// p: spend/day, cpm, ctr (link, ratio), cart/co/pur: step rates of the funnel, aov. Money is written for a 200-unit "USD 10"
// and scaled to the demo currency in createWorld.
// start/stop: days before today the ad began / stopped delivering. trend: how the ad ages.
const BASE_ADS = [
  { key: 'reel-unboxing', adset: 'broad', name: 'Reel | Unboxing Taza Terra', type: 'VIDEO', kind: 'sales', p: { spend: 520, cpm: 84, ctr: 0.018, cart: 0.13, co: 0.58, pur: 0.58, aov: 640 }, start: 70, trend: 'steady', f0: 1.5 },
  { key: 'img-origen', adset: 'broad', name: 'Imagen | Set Café Origen', type: 'SHARE', kind: 'sales', p: { spend: 380, cpm: 78, ctr: 0.015, cart: 0.12, co: 0.55, pur: 0.5, aov: 590 }, start: 70, trend: 'steady', f0: 1.6 },
  { key: 'carrusel-hogar', adset: 'interests', name: 'Carrusel | Catálogo Hogar', type: 'CAROUSEL', kind: 'sales', p: { spend: 320, cpm: 80, ctr: 0.016, cart: 0.13, co: 0.56, pur: 0.55, aov: 610 }, start: 70, trend: 'fatigue', f0: 1.9 },
  { key: 'video-receta', adset: 'interests', name: 'Video | Receta de café en 30 segundos', type: 'VIDEO', kind: 'sales', p: { spend: 260, cpm: 90, ctr: 0.013, cart: 0.1, co: 0.5, pur: 0.45, aov: 560 }, start: 60, trend: 'steady', f0: 1.7 },
  { key: 'reel-terra', adset: 'lookalike', name: 'Reel | Lanzamiento Terra', type: 'VIDEO', kind: 'sales', p: { spend: 460, cpm: 88, ctr: 0.021, cart: 0.15, co: 0.62, pur: 0.62, aov: 690 }, start: 45, trend: 'rise', f0: 1.4 },
  { key: 'img-colores', adset: 'lookalike', name: 'Imagen | Terra en cuatro colores', type: 'SHARE', kind: 'sales', p: { spend: 230, cpm: 92, ctr: 0.011, cart: 0.06, co: 0.4, pur: 0.3, aov: 600 }, start: 45, trend: 'weak', f0: 1.8 },
  { key: 'din-carrito', adset: 'visitors', name: 'Dinámico | Productos del carrito', type: 'SHARE', kind: 'sales', p: { spend: 240, cpm: 110, ctr: 0.024, cart: 0.2, co: 0.7, pur: 0.68, aov: 650 }, start: 70, trend: 'steady', f0: 2.1 },
  { key: 'img-regalo', adset: 'interests', name: 'Imagen | Regalo edición limitada', type: 'SHARE', kind: 'sales', p: { spend: 180, cpm: 86, ctr: 0.014, cart: 0.1, co: 0.5, pur: 0.45, aov: 620 }, start: 40, stop: 4, trend: 'steady', f0: 1.6 },
  { key: 'reel-nueva', adset: 'broad', name: 'Reel | Nueva temporada', type: 'VIDEO', kind: 'sales', p: { spend: 160, cpm: 82, ctr: 0.017, cart: 0.12, co: 0.55, pur: 0.5, aov: 600 }, start: 8, trend: 'steady', f0: 1.3 },
  { key: 'img-guia', adset: 'guides', name: 'Imagen | Guía de cuidado de cerámica', type: 'SHARE', kind: 'traffic', p: { spend: 150, cpm: 58, ctr: 0.024, cart: 0.015, co: 0.4, pur: 0.2, aov: 600 }, start: 60, trend: 'steady', f0: 1.5 },
  { key: 'reel-cafe', adset: 'guides', name: 'Reel | Cómo preparar café de filtro', type: 'VIDEO', kind: 'traffic', p: { spend: 130, cpm: 62, ctr: 0.02, cart: 0.012, co: 0.4, pur: 0.2, aov: 600 }, start: 60, trend: 'steady', f0: 1.5 },
  { key: 'reel-taller', adset: 'visits', name: 'Reel | Detrás de cámara del taller', type: 'VIDEO', kind: 'profile', p: { spend: 110, cpm: 48, ctr: 0.03, cart: 0, co: 0, pur: 0, aov: 0 }, start: 60, trend: 'steady', f0: 1.6 },
  { key: 'img-tour', adset: 'visits', name: 'Imagen | Tour del taller', type: 'SHARE', kind: 'profile', p: { spend: 90, cpm: 45, ctr: 0.026, cart: 0, co: 0, pur: 0, aov: 0 }, start: 60, trend: 'steady', f0: 1.5 },
  { key: 'reel-resenas', adset: 'social', name: 'Reel | Reseñas de clientes', type: 'VIDEO', kind: 'engagement', p: { spend: 100, cpm: 40, ctr: 0.012, cart: 0, co: 0, pur: 0, aov: 0 }, start: 60, trend: 'steady', f0: 1.5 },
  { key: 'img-buenfin', adset: 'combo', name: 'Imagen | Combo Black Friday', type: 'SHARE', kind: 'sales', p: { spend: 300, cpm: 95, ctr: 0.014, cart: 0.1, co: 0.5, pur: 0.4, aov: 700 }, start: 40, stop: 12, trend: 'steady', f0: 1.7 },
  { key: 'video-hotsale', adset: 'hotsale', name: 'Video | Cyber Week teaser', type: 'VIDEO', kind: 'sales', p: { spend: 280, cpm: 88, ctr: 0.017, cart: 0.12, co: 0.55, pur: 0.5, aov: 610 }, start: 40, stop: 6, trend: 'steady', f0: 1.6 },
];

const COPY = {
  'reel-unboxing': ['Así llega tu Terra: empaque, color y detalle a mano.', 'Descubre la taza Terra'],
  'img-origen': ['Tres orígenes, un solo ritual de las mañanas.', 'Arma tu set de café'],
  'carrusel-hogar': ['Piezas de cerámica pensadas para tu cocina.', 'Ver catálogo'],
  'video-receta': ['Una receta sencilla para empezar el día.', 'Ver la receta'],
  'reel-terra': ['Terra ya está aquí. Hecha a mano, en cuatro colores.', 'Compra Terra'],
  'img-colores': ['Elige tu color favorito de Terra.', 'Comprar ahora'],
  'din-carrito': ['Lo que dejaste en tu carrito te espera.', 'Terminar mi compra'],
  'img-regalo': ['Edición limitada: el regalo para quien ama el café.', 'Ver el regalo'],
  'reel-nueva': ['Nueva temporada, nuevos tonos.', 'Conoce la colección'],
  'img-guia': ['Cómo cuidar tu cerámica para que dure años.', 'Leer la guía'],
  'reel-cafe': ['Café de filtro paso a paso.', 'Leer más'],
  'reel-taller': ['Un día en el taller de Example Co.', 'Seguir en Instagram'],
  'img-tour': ['Conoce dónde nace cada pieza.', 'Visitar el perfil'],
  'reel-resenas': ['Lo que dicen quienes ya usan Example Co.', 'Ver más'],
  'img-buenfin': ['Combos de temporada por tiempo limitado.', 'Ver combos'],
  'video-hotsale': ['Cyber Week: descuentos en piezas seleccionadas.', 'Ver ofertas'],
};

const SEASON = [0.92, 0.96, 1.0, 1.03, 1.06, 1.12, 1.0]; // Sunday..Saturday

const DIMENSIONS = {
  age: [['18-24', 0.1], ['25-34', 0.3], ['35-44', 0.28], ['45-54', 0.2], ['55-64', 0.12]],
  gender: [['female', 0.62], ['male', 0.35], ['unknown', 0.03]],
  placement: [[['facebook', 'feed'], 0.22], [['instagram', 'feed'], 0.2], [['instagram', 'reels'], 0.3], [['instagram', 'story'], 0.14], [['facebook', 'facebook_reels'], 0.14]],
  country: [['US', 0.88], ['CA', 0.08], ['GB', 0.04]],
  impression_device: [['iphone', 0.45], ['android_smartphone', 0.4], ['desktop', 0.1], ['ipad', 0.05]],
};

const SUM_KEYS = ['spend', 'impressions', 'reach', 'clicks', 'lpv', 'content', 'carts', 'checkout', 'purchases', 'revenue', 'profile', 'engagement', 'comments', 'reactions', 'shares', 'saves', 'plays', 'completions'];
const zeroSums = () => Object.fromEntries(SUM_KEYS.map(k => [k, 0]));

export function createWorld(D, profile = DEMO_PROFILE) {
  const k = spendUnit(profile.currency) / BASE_UNIT;
  const tz = profile.timezone;
  const ADS = BASE_ADS.map(a => ({ ...a, p: { ...a.p, spend: a.p.spend * k, cpm: a.p.cpm * k, aov: a.p.aov * k } }));
  // Campaign budgets are written in cents of the base unit; Meta sends them in the currency's own minor unit.
  const budgetOf = base => String(Math.round(base / 100 * k * 10 ** minorDigits(profile.currency)));
  const offsetOf = date => Math.round((Date.parse(`${D}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / DAY);
  const ids = (base, list) => new Map(list.map((e, i) => [e.key, String(base + i + 1)]));
  const campaignIds = ids(120210000000000, CAMPAIGNS), adsetIds = ids(120220000000000, ADSETS), adIds = ids(120230000000000, ADS);

  const campaigns = CAMPAIGNS.map(c => ({ ...c, id: campaignIds.get(c.key), status: c.status || 'ACTIVE' }));
  const campaignByKey = new Map(campaigns.map(c => [c.key, c]));
  const adsets = ADSETS.map(s => {
    const campaign = campaignByKey.get(s.campaign);
    return {
      ...s, id: adsetIds.get(s.key), campaignId: campaign.id, campaignName: campaign.name, campaignObjective: campaign.objective,
      status: campaign.status === 'PAUSED' ? 'CAMPAIGN_PAUSED' : 'ACTIVE', endTime: s.endOffset ? `${shift(D, -s.endOffset)}T23:59:59${offsetAt(shift(D, -s.endOffset), tz)}` : null,
    };
  });
  const adsetByKey = new Map(adsets.map(s => [s.key, s]));
  const ads = ADS.map((a, i) => {
    const adset = adsetByKey.get(a.adset);
    const campaign = campaigns.find(c => c.id === adset.campaignId);
    return {
      ...a, id: adIds.get(a.key), adsetId: adset.id, adsetName: adset.name, campaignId: campaign.id, campaignName: campaign.name,
      status: campaign.status === 'PAUSED' ? 'CAMPAIGN_PAUSED' : 'ACTIVE', body: COPY[a.key][0], cta: COPY[a.key][1], index: i + 1,
      storyId: `${PAGE_ID}_${900000 + i + 1}`, adset, campaign,
    };
  });

  const trendOf = (ad, off) => {
    const o = Math.max(off, 0);
    switch (ad.trend) {
      case 'fatigue': { const age = o >= 16 ? 0 : (16 - o) / 16; return { ctr: 1 - 0.55 * age, pur: 1 - 0.3 * age, freq: 0.07 * (o >= 16 ? 0 : 16 - o) }; }
      case 'rise': { const age = clamp((30 - o) / 30, 0, 1); return { ctr: 0.88 + 0.14 * age, pur: 0.9 + 0.12 * age, freq: 0.01 * (30 - Math.min(o, 30)) }; }
      case 'weak': return { ctr: 0.9, pur: 0.55, freq: 0.012 * (45 - Math.min(o, 45)) };
      default: return { ctr: 1, pur: 1, freq: 0.004 * (45 - Math.min(o, 45)) };
    }
  };
  const frequencyOf = (ad, date) => ad.f0 + trendOf(ad, offsetOf(date)).freq;

  const memo = new Map();
  // Raw metrics of one ad on one day, or null when the ad did not deliver.
  function adDay(ad, date) {
    const off = offsetOf(date);
    if (off > ad.start || (ad.stop !== undefined && off <= ad.stop && off >= 0)) return null;
    if (off < 0) return null; // the future
    const memoKey = `${ad.key}|${date}`;
    if (memo.has(memoKey)) return memo.get(memoKey);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const t = trendOf(ad, off);
    const partial = off === 0 ? 0.45 : 1;
    const spend = Math.round(ad.p.spend * SEASON[dow] * (1 + 0.14 * (rand(ad.key, date, 's') - 0.5) * 2) * partial * 100) / 100;
    const cpm = ad.p.cpm * (1 + 0.1 * (rand(ad.key, date, 'm') - 0.5) * 2) * (ad.trend === 'fatigue' ? 1 + 0.12 * (1 - t.ctr) : 1);
    const impressions = Math.round(spend / cpm * 1000);
    const ctr = ad.p.ctr * t.ctr * (1 + 0.08 * (rand(ad.key, date, 'c') - 0.5) * 2);
    const clicks = stochastic(impressions * ctr, ad.key, date, 'k');
    const lpv = stochastic(clicks * 0.82, ad.key, date, 'l');
    const sales = ad.kind === 'sales' || ad.kind === 'traffic';
    const content = sales ? stochastic(clicks * (ad.kind === 'sales' ? 0.74 : 0.5), ad.key, date, 'v') : 0;
    const carts = stochastic(content * ad.p.cart * (1 + 0.15 * (rand(ad.key, date, 'a') - 0.5) * 2), ad.key, date, 'a2');
    const checkout = stochastic(carts * ad.p.co, ad.key, date, 'i');
    const purchases = stochastic(checkout * ad.p.pur * t.pur, ad.key, date, 'p');
    const revenue = Math.round(purchases * ad.p.aov * (1 + 0.18 * (rand(ad.key, date, 'r') - 0.5) * 2));
    const freq = 1 + (frequencyOf(ad, date) - 1) * 0.15;
    const row = {
      spend, impressions, reach: Math.max(1, Math.round(impressions / freq)), clicks, lpv, content, carts, checkout, purchases, revenue,
      profile: ad.kind === 'profile' ? stochastic(clicks * 0.9, ad.key, date, 'pv') : 0,
      engagement: ad.kind === 'engagement' ? stochastic(impressions * 0.035, ad.key, date, 'e') : stochastic(impressions * 0.004, ad.key, date, 'e'),
      comments: stochastic(impressions * 0.0004, ad.key, date, 'cm'), reactions: stochastic(impressions * 0.0025, ad.key, date, 'rx'),
      shares: stochastic(impressions * 0.0003, ad.key, date, 'sh'), saves: stochastic(impressions * 0.0005, ad.key, date, 'sv'),
      plays: ad.type === 'VIDEO' ? stochastic(impressions * 0.4, ad.key, date, 'vp') : 0,
      completions: ad.type === 'VIDEO' ? stochastic(impressions * 0.06, ad.key, date, 'vc') : 0,
    };
    memo.set(memoKey, row);
    return row;
  }

  const eachDate = (from, to) => { const out = []; for (let d = from; d <= to; d = shift(d, 1)) out.push(d); return out; };

  // Sums of a set of ads over [from, to]. Reach is derived from the window frequency (never summed across days).
  function sums(adList, from, to) {
    const total = zeroSums();
    const dates = eachDate(from, to);
    const span = dates.length;
    for (const ad of adList) {
      const mine = zeroSums();
      for (const date of dates) { const day = adDay(ad, date); if (day) for (const k of SUM_KEYS) mine[k] += day[k]; }
      if (!mine.impressions) continue;
      const freq = 1 + (frequencyOf(ad, to) - 1) * Math.min(1, 0.15 + 0.85 * (span - 1) / 6);
      mine.reach = Math.max(1, Math.round(mine.impressions / freq));
      for (const k of SUM_KEYS) total[k] += mine[k];
    }
    return total;
  }

  function split(values, share) {
    return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, k === 'spend' ? Math.round(v * share * 100) / 100 : Math.round(v * share)]));
  }

  // Meta-style insights row from sums (numbers as strings, zero actions omitted).
  function insightsRow(s, extra = {}) {
    const actions = [];
    const add = (type, value) => { if (value > 0) actions.push({ action_type: type, value: String(Math.round(value)) }); };
    add('landing_page_view', s.lpv); add('offsite_conversion.fb_pixel_view_content', s.content); add('offsite_conversion.fb_pixel_add_to_cart', s.carts);
    add('offsite_conversion.fb_pixel_initiate_checkout', s.checkout); add('offsite_conversion.fb_pixel_purchase', s.purchases);
    add('omni_view_content', s.content * 1.3); add('omni_add_to_cart', s.carts * 1.3); add('omni_initiated_checkout', s.checkout * 1.25);
    add('post_engagement', s.engagement); add('comment', s.comments); add('post_reaction', s.reactions); add('post', s.shares); add('onsite_conversion.post_save', s.saves);
    const row = {
      spend: s.spend.toFixed(2), impressions: String(s.impressions), reach: String(s.reach), frequency: s.reach ? (s.impressions / s.reach).toFixed(4) : '0',
      inline_link_clicks: String(s.clicks), actions,
      ...(s.revenue > 0 ? { action_values: [{ action_type: 'offsite_conversion.fb_pixel_purchase', value: String(s.revenue) }], purchase_roas: [{ action_type: 'omni_purchase', value: s.spend > 0 ? (s.revenue / s.spend).toFixed(2) : '0' }] } : {}),
      ...(s.profile > 0 ? { instagram_profile_visits: String(s.profile) } : {}),
      ...(s.plays > 0 ? { video_play_actions: [{ action_type: 'video_view', value: String(s.plays) }], video_p100_watched_actions: [{ action_type: 'video_view', value: String(s.completions) }] } : {}),
      account_currency: profile.currency, ...extra,
    };
    return row;
  }

  // The insights endpoint. `p` holds the query parameters already parsed.
  function insights({ level = 'account', range, increment, breakdowns }) {
    const { since, until } = range;
    const groupsOf = () => {
      if (level === 'campaign') return campaigns.map(c => ({ ads: ads.filter(a => a.campaignId === c.id), ids: { campaign_id: c.id, campaign_name: c.name, objective: c.objective } }));
      if (level === 'adset') return adsets.map(s => ({ ads: ads.filter(a => a.adsetId === s.id), ids: { campaign_id: s.campaignId, adset_id: s.id, adset_name: s.name } }));
      if (level === 'ad') return ads.map(a => ({ ads: [a], ids: { campaign_id: a.campaignId, adset_id: a.adsetId, ad_id: a.id, ad_name: a.name } }));
      return [{ ads, ids: {} }];
    };
    const buckets = [];
    if (increment === '1') for (const d of eachDate(since, until)) buckets.push([d, d]);
    else if (increment === '7') for (let d = since; d <= until; d = shift(d, 7)) buckets.push([d, shift(d, 6) > until ? until : shift(d, 6)]);
    else if (increment === 'monthly') {
      let d = since;
      while (d <= until) {
        const next = new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 1)).toISOString().slice(0, 10);
        const end = shift(next, -1) > until ? until : shift(next, -1);
        buckets.push([d, end]); d = next;
      }
    } else buckets.push([since, until]);
    const dims = String(breakdowns || '').split(',').filter(Boolean);
    const combos = [];
    const has = k => dims.includes(k);
    const lists = [];
    if (has('age')) lists.push(DIMENSIONS.age.map(([v, w]) => [{ age: v }, w]));
    if (has('gender')) lists.push(DIMENSIONS.gender.map(([v, w]) => [{ gender: v }, w]));
    if (has('publisher_platform')) lists.push(DIMENSIONS.placement.map(([[pf, pos], w]) => [{ publisher_platform: pf, platform_position: pos }, w]));
    if (has('country')) lists.push(DIMENSIONS.country.map(([v, w]) => [{ country: v }, w]));
    if (has('impression_device')) lists.push(DIMENSIONS.impression_device.map(([v, w]) => [{ impression_device: v }, w]));
    const product = (i, acc, share) => { if (i === lists.length) { combos.push([acc, share]); return; } for (const [d, w] of lists[i]) product(i + 1, { ...acc, ...d }, share * w); };
    product(0, {}, 1);
    const rows = [];
    for (const [from, to] of buckets) {
      for (const group of groupsOf()) {
        const s = sums(group.ads, from, to);
        if (!s.impressions) continue;
        for (const [dimension, share] of combos) rows.push(insightsRow(share === 1 && !lists.length ? s : split(s, share), { ...group.ids, ...dimension, date_start: from, date_stop: to }));
      }
    }
    return rows;
  }

  const accountDay = date => sums(ads, date, date);

  // ---- Pixel (per day, web and server sources) ----
  function pixelDay(date) {
    const s = accountDay(date);
    const web = { ViewContent: s.content * 1.55 + 40, AddToCart: s.carts * 1.5 + 6, InitiateCheckout: s.checkout * 1.45 + 3, Purchase: s.purchases * 1.3 + 1 };
    return { web, server: Object.fromEntries(Object.entries(web).map(([k, v]) => [k, v * (k === 'Purchase' ? 0.94 : 0.86)])) };
  }

  // ---- Instagram ----
  const followersOn = date => { const off = offsetOf(date); return Math.round(12480 - 13 * off + 3 * Math.sin(off)); };
  function igDay(date) {
    const off = offsetOf(date);
    const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
    const viral = off >= 18 && off <= 21 ? 2.2 : 1;
    const reach = Math.round((650 + 850 * rand('ig', date, 'r')) * (dow === 0 || dow === 6 ? 1.15 : 1) * viral);
    const likes = Math.round(reach * (0.055 + 0.03 * rand('ig', date, 'l')));
    return {
      reach, views: Math.round(reach * (2 + rand('ig', date, 'v'))), likes, total_interactions: Math.round(likes * (1.5 + 0.4 * rand('ig', date, 'i'))),
      accounts_engaged: Math.round(reach * (0.04 + 0.02 * rand('ig', date, 'e'))),
      follows: Math.round((9 + 14 * rand('ig', date, 'f')) * viral), unfollows: Math.round(2 + 5 * rand('ig', date, 'u')),
      profile_views: Math.round(reach * 0.09),
    };
  }
  const POSTS = [
    ['VIDEO', 'Un día en el taller: del barro a la taza.'], ['IMAGE', 'Terra, ahora en cuatro colores.'], ['CAROUSEL_ALBUM', 'Cinco formas de usar tu taza favorita.'],
    ['VIDEO', 'Café de filtro paso a paso.'], ['IMAGE', 'Nuevo lote recién salido del horno.'], ['VIDEO', 'Lo que dicen quienes ya tienen su Terra.'],
    ['IMAGE', 'El rincón de café ideal para tu cocina.'], ['CAROUSEL_ALBUM', 'Guía rápida para cuidar tu cerámica.'], ['VIDEO', 'Empaque y envío: así cuidamos cada pedido.'],
    ['IMAGE', 'Colores de temporada.'], ['VIDEO', 'Detrás de cámara de la sesión de fotos.'], ['IMAGE', 'Gracias por ser parte de Example Co.'],
  ];
  const posts = POSTS.map(([type, caption], i) => {
    const n = i + 1;
    const date = shift(D, -Math.round(1 + i * 2.4));
    const hit = n === 1 || n === 6 ? 2.6 : n === 3 ? 1.7 : 1;
    const reach = Math.round((1800 + 2600 * rand('post', n, 'r')) * hit);
    const likes = Math.round(reach * (0.06 + 0.04 * rand('post', n, 'l')));
    return {
      id: String(17900000000000 + n), caption, media_type: type, permalink: `https://www.instagram.com/p/EXAMPLE${n}/`,
      timestamp: `${date}T17:30:00+0000`, thumbnail_url: `/demo-media/cdninstagram-post-${n}.png`, media_url: `/demo-media/cdninstagram-post-${n}.png`,
      metrics: { reach, views: Math.round(reach * (type === 'VIDEO' ? 2.8 : 1.6)), likes, comments: Math.round(likes * 0.06), shares: Math.round(likes * 0.09), saved: Math.round(likes * 0.18), total_interactions: Math.round(likes * 1.45) },
    };
  });

  const comments = [
    ['¿Tienen envíos a Monterrey?', 3], ['Me llegó hermosa, gracias.', 8], ['¿El color azul sigue disponible?', 1], ['Excelente calidad, ya pedí otra.', 5],
    ['¿Se puede meter al microondas?', 2], ['Muy bonita, pero tardó en llegar.', 0],
  ];

  return { D, profile, tz, offsetAt: date => offsetAt(date, tz), budgetOf, offsetOf, campaigns, adsets, ads, insights, accountDay, pixelDay, followersOn, igDay, posts, comments, sums, eachDate };
}
