// Fills the in-memory store at boot, using the portal's own collectors wherever possible: the snapshot job, the sales,
// pixel and Instagram backfills and the inspiration service all run for real against the fake Graph / ScrapeCreators
// APIs. Only the agent's daily run and a few user-authored records (notes, one conversation, saved reports) are written
// directly, because a model call would be needed to produce them.
import { shift } from '../lib/dates.js';
import { formatMoneyWithCode, activeProfile, minSpendFor, spendUnit } from '../lib/locale.js';
import { createMetaClient } from '../lib/meta-client.js';
import { createDashCron } from '../lib/dash/cron.js';
import { today } from '../lib/dash/range.js';
import { K } from '../lib/dash/store.js';
import { writeSnap, snapshotSales, datesBetween } from '../lib/dash/snapshot.js';
import { snapshotPixel } from '../lib/dash/pixel.js';
import { backfillInstagram } from '../lib/dash/social.js';
import { buildFacts, inputHash } from '../lib/agent/facts.js';
import { objectiveSummary } from '../lib/agent/objectives.js';
import { PLAYBOOK_VERSION } from '../lib/agent/playbook.js';
import { SKILL_VERSION } from '../lib/agent/skills/claude-ads-meta.js';
import { computeJournal } from '../lib/agent/journal.js';
import { addNote, addProposals } from '../lib/agent/memory.js';
import { userHash, appendExchange } from '../lib/agent/conversations.js';
import { createInspiration } from '../lib/inspiration/service.js';
import { createIntelligence } from '../lib/inspiration/intelligence.js';
import { analyzeCopy } from '../lib/inspiration/analysis.js';
import { COMPETITORS, adId } from './competitors.js';

export const DEMO_EMAIL = 'demo@example.com';
const HISTORY_DAYS = 60;
const isNum = v => typeof v === 'number' && Number.isFinite(v);
// Amounts in the account currency the snapshot job resolved (the demo account's own currency).
const money = n => formatMoneyWithCode(n);
// Amounts written for a 200-unit base (see demo/world.js), expressed in the demo currency.
const scaled = base => Math.round(base * spendUnit(activeProfile().currency) / 200);

async function runSnapshotJob({ env, store, fetch, now }) {
  const handler = createDashCron({ env, store, fetch, now });
  const out = { code: 200, body: null };
  const res = { setHeader() {}, status(code) { out.code = code; return res; }, json(body) { out.body = body; return res; } };
  await handler({ method: 'GET', headers: { authorization: `Bearer ${env.CRON_SECRET}` }, query: { job: 'snapshot' } }, res);
  if (out.code !== 200 || out.body?.status !== 'ok') throw new Error(`demo seed: snapshot job did not finish cleanly: ${JSON.stringify(out.body)}`);
  return out.body;
}

// One stored agent run: real entity ids, names and figures taken from the facts the portal built, phrased by rules.
function buildRun({ facts, D, date, trim }) {
  const recs = [];
  const add = (type, list, index, action, confidence, rationale, evidence, keys, days) => {
    const e = facts[list][index];
    recs.push({
      entity_type: type, entity_id: e.id, entity_name: e.name, objective_group: e.objective_group, action, confidence, rationale, evidence,
      cited_metrics: keys.map(k => ({ path: `${list}.${index}.C.${k}`, value: e.C?.[k] })).filter(m => isNum(m.value)),
      review_after_days: days, review_after: shift(date, days),
    });
  };
  const ads = facts.ads;
  const running = i => ads[i].delivery === 'running';
  const fatigued = ads.findIndex(a => a.fatigue_state === 'FATIGUED');
  if (fatigued >= 0) {
    const { C, B } = ads[fatigued];
    add('ad', 'ads', fatigued, 'REPLACE_CREATIVE', 'high', 'La frecuencia subió, el CTR bajó y el costo por compra aumentó frente a la semana anterior. Es momento de preparar un creativo nuevo.',
      [`CTR: ${C.ctr_pct}% frente a ${B.ctr_pct}%`, `Frecuencia: ${C.frequency} frente a ${B.frequency}`, `CPA: ${money(C.cpa)} frente a ${money(B.cpa)}`], ['ctr_pct', 'frequency', 'cpa'], 3);
  }
  const eligible = ads.map((a, i) => i).filter(i => running(i) && ads[i].objective_group === 'sales' && ads[i].C?.purchases >= 6 && isNum(ads[i].C.cpa));
  eligible.sort((a, b) => ads[a].C.cpa - ads[b].C.cpa);
  if (eligible.length) {
    const i = eligible[0], { C } = ads[i];
    const scale = isNum(facts.targets?.cpa) && C.cpa <= 0.9 * facts.targets.cpa;
    add('ad', 'ads', i, scale ? 'SCALE' : 'CONTINUE', 'medium', scale ? 'Mantiene el costo por compra por debajo de tu meta con volumen suficiente. Se puede subir el presupuesto de forma gradual.' : 'Es el anuncio con mejor costo por compra de la cuenta. Conviene dejarlo correr y revisar en unos días.',
      [`CPA: ${money(C.cpa)}`, `Compras: ${C.purchases}`, `Gasto: ${money(C.spend)}`], ['cpa', 'purchases', 'spend'], 7);
  }
  const weak = ads.findIndex(a => a.delivery === 'running' && a.objective_group === 'sales' && a.C?.spend >= (facts.gates?.stop_min_spend_c ?? 2.5 * spendUnit(activeProfile().currency)) && (a.C.purchases ?? 0) <= 1);
  if (weak >= 0) {
    const { C } = ads[weak];
    add('ad', 'ads', weak, 'STOP', 'medium', 'Gastó por encima del mínimo de muestra y casi no generó compras. Recomiendo pausarlo y mover ese presupuesto a un anuncio que sí convierte.',
      [`Gasto: ${money(C.spend)}`, `Compras: ${C.purchases}`], ['spend', 'purchases'], 5);
  }
  const fresh = ads.findIndex(a => a.delivery === 'running' && a.fatigue_state === 'INSUFFICIENT_SAMPLE' && !(a.C?.purchases >= 3) && a.objective_group === 'sales' && a.C?.spend > 0);
  if (fresh >= 0 && fresh !== weak) {
    const { C } = ads[fresh];
    add('ad', 'ads', fresh, 'WATCH', 'low', 'Todavía no reúne la muestra mínima para decidir. Conviene esperar unos días más antes de juzgarlo.', [`Gasto: ${money(C.spend)}`, `Impresiones: ${C.impressions}`], ['spend', 'impressions'], 4);
  }
  const campaigns = facts.campaigns;
  const salesCampaign = campaigns.findIndex(c => c.objective_group === 'sales' && isNum(c.C?.roas));
  if (salesCampaign >= 0) {
    const { C } = campaigns[salesCampaign];
    add('campaign', 'campaigns', salesCampaign, 'CONTINUE', 'high', 'La campaña cumple la meta de retorno con volumen suficiente. Recomiendo mantenerla.', [`ROAS: ${C.roas}`, `CPA: ${money(C.cpa)}`, `Compras: ${C.purchases}`], ['roas', 'cpa', 'purchases'], 7);
  }
  const profile = campaigns.findIndex(c => c.objective_group === 'profile_growth');
  if (profile >= 0) {
    const { C } = campaigns[profile];
    add('campaign', 'campaigns', profile, 'CONTINUE', 'medium', 'Esta campaña se mide por visitas al perfil y su costo por visita se mantiene estable. Recomiendo seguirla.', [`Visitas al perfil: ${C.profile_visits}`, `Gasto: ${money(C.spend)}`], ['profile_visits', 'spend'], 7);
  }
  const traffic = campaigns.findIndex(c => c.objective_group === 'traffic_site');
  if (traffic >= 0) {
    const { C } = campaigns[traffic];
    add('campaign', 'campaigns', traffic, 'WATCH', 'low', 'El tráfico llega, pero conviene revisar cuántas visitas llegan a ver producto antes de decidir.', [`Clics al enlace: ${C.link_clicks}`, `Gasto: ${money(C.spend)}`], ['link_clicks', 'spend'], 5);
  }
  const kept = trim ? recs.slice(0, Math.max(2, recs.length - trim)) : recs;
  return {
    generated_at: new Date(`${date}T13:05:00Z`).toISOString(), provider: 'gemini', model: 'demo-canned', playbook_version: PLAYBOOK_VERSION, skill_version: SKILL_VERSION,
    status: 'ok', served_by: 'demo-canned', input_hash: inputHash(facts, 'demo-canned'), windows: facts.windows,
    summary: 'Resumen de demostración con datos ficticios: un anuncio muestra fatiga, otro rinde por encima de la meta y uno todavía no tiene muestra suficiente.',
    recommendations: kept, objectives: objectiveSummary(facts), rejected: [], data_gaps: facts.data_gaps, usage: {},
  };
}

async function seedAgentRuns({ env, store, D }) {
  const facts = await buildFacts({ store, D, env });
  if (!facts) throw new Error('demo seed: no facts to build the agent run from');
  let written = 0;
  for (const [offset, trim] of [[0, 0], [1, 1], [2, 2], [3, 1]]) {
    const date = shift(D, -offset);
    await writeSnap({ store, module: 'agent', date, value: buildRun({ facts, D, date, trim }), ref: D, key: K.agentRun(date) });
    written++;
  }
  return written;
}

async function seedInspiration({ env, store, fetch, now, agentClient, D }) {
  const P = 'dtc:inspiration:';
  const service = createInspiration({ env, store, fetch, now, agentClient });
  const brands = [];
  for (const b of COMPETITORS) {
    const brand = await service.upsert({ name: b.name, website: b.website, page_id: b.page_id, auto: false });
    await service.sync(brand.id, false, 'ALL');
    brands.push(brand);
  }
  // Saved library (favourites with notes) and two boards.
  const saved = [[0, 0, 'Hooks de apertura', 'Repite la misma pregunta en varios anuncios.'], [0, 1, 'Hooks de apertura', 'Versión en video del mismo gancho.'], [1, 0, 'Producto en uso', 'Muestra la pieza antes de hablar de precio.'],
    [1, 3, 'Ofertas', 'Condiciones de envío visibles en el copy.'], [2, 0, 'Producto en uso', 'Demostración corta con un solo beneficio.'], [3, 0, 'Regalos', 'Caja de regalo con nota a mano.']];
  for (const [brand, index, collection, notes] of saved) await service.annotate({ id: adId(brand, index), favorite: true, collection, notes, tags: ['demo', brand % 2 ? 'imagen' : 'video'] });
  const hooks = await service.createBoard({ name: 'Hooks de apertura' });
  const launches = await service.createBoard({ name: 'Ideas para lanzamientos' });
  for (const [brand, index] of [[0, 0], [0, 1]]) await service.organize({ id: adId(brand, index), board_ids: [hooks.id] });
  for (const [brand, index] of [[1, 0], [3, 0], [2, 0]]) await service.organize({ id: adId(brand, index), board_ids: [launches.id] });
  // Stored copy analyses for a few ads (written directly: the daily AI quota stays untouched for the visitor).
  for (const [brand, index] of [[0, 0], [1, 0], [3, 0]]) {
    const id = adId(brand, index);
    const ad = JSON.parse(await store(['GET', `${P}ad:${id}`]));
    const result = { ...(await analyzeCopy(ad, env, agentClient)), created_at: new Date(now()).toISOString() };
    await store(['SET', `${P}analysis:${id}`, JSON.stringify(result)]);
  }
  const intelligence = createIntelligence({ env, store, now, service, agentClient });
  await intelligence.profile({ product: 'Tazas de cerámica y accesorios de café hechos a mano', audience: 'Personas de 25 a 54 años que disfrutan el café en casa', offer: 'Envío gratis en pedidos seleccionados [confirmar condiciones]', proof: 'Reseñas de clientes de Example Co.', constraints: 'Sin promesas de salud; mostrar producto real', goal: 'Crear anuncios originales para Example Co. y mejorar adquisición con evidencia.' });
  await intelligence.generate();
  // Seeding must not spend the visitor's daily quotas.
  await store(['DEL', `${P}plan-calls:${D}`]);
  await store(['SET', `${P}calls`, '0']);
  return { brands: brands.length };
}

async function seedUserRecords({ env, store, now, D }) {
  const user = userHash(env.DASH_SESSION_SECRET, DEMO_EMAIL);
  for (const text of [`El CPA objetivo es de ${money(scaled(250))} y el ROAS objetivo es 3.`, 'No pausar el retargeting durante la temporada alta.', 'Priorizar video corto para lanzamientos de producto.']) await addNote({ store, now, text });
  await addProposals({ store, now, texts: [`El envío gratis aplica en pedidos de más de ${money(scaled(800))}.`] });
  await appendExchange({
    store, user, now, id: null, question: '¿Cómo van las ventas esta semana?', imageCount: 0, ads: [], model: 'demo-canned', grounded: true, factsDate: D,
    answer: '[Demo] Respuesta de ejemplo escrita por reglas, no por un modelo de IA.\n\nEn el periodo cerrado más reciente las ventas se mantienen estables. Abre Resumen para ver el detalle por día y por campaña.\n\nEste panel usa datos ficticios de Example Co.',
  });
  // Analytics: brand goal, a few tagged ads and one saved view.
  await store(['SET', 'dtc:analytics:settings', JSON.stringify({ metric: 'roas', target: '3', min_spend: String(minSpendFor(env)), min_conversions: '3' })]);
  const tags = [['persona', 'Hogares que disfrutan el café'], ['desire', 'Rituales de la mañana'], ['usp', 'Hecho a mano'], ['narrative', 'Producto en uso'], ['message', 'Calidad que dura'], ['emotion', 'Calma'], ['visual_hook', 'Producto en primer plano'], ['offer', 'Sin oferta explícita'], ['format', 'Video corto'], ['production', 'Taller']];
  return { user, tags };
}

export async function seedDemo({ env, store, fetch, now = Date.now, world, agentClient }) {
  const D = today(now());
  const accountId = env.META_ACCESS_TOKEN && env.META_AD_ACCOUNT_ID;
  const version = env.META_API_VERSION;
  const client = createMetaClient({ token: env.META_ACCESS_TOKEN, version, accountId: String(accountId), fetch, now, store, deadlineMs: 600000, enabled: true });
  const from = shift(D, -HISTORY_DAYS), to = shift(D, -1);

  // Sixty days of history through the portal's own backfills.
  await snapshotSales({ client, accountId: String(accountId), store, now, D, version, from, to });
  await snapshotPixel({ client, env, store, now, D, accountId: String(accountId), from, to: shift(D, -7) });
  await backfillInstagram({ env, store, fetch, now, D, dates: datesBetween(from, to), budget: 600000 });
  for (const date of datesBetween(from, D)) await writeSnap({ store, module: 'ig-followers', date, value: world.followersOn(date), ref: D });

  // Today's snapshot job (pixel, sales, fatigue, Instagram, creatives, weekly journal, status), exactly as the cron runs it.
  const snapshot = await runSnapshotJob({ env, store, fetch, now });
  const runs = await seedAgentRuns({ env, store, D });
  await computeJournal({ store, D });
  // Notes first: they are part of the plan's input, so the seeded plan is the one the "generate" button reuses.
  const { user, tags } = await seedUserRecords({ env, store, now, D });
  const inspiration = await seedInspiration({ env, store, fetch, now, agentClient, D });

  // Tags and a saved view need ad ids from the world.
  const tagged = world.ads.filter(a => a.kind === 'sales').slice(0, 6);
  for (const ad of tagged) {
    const value = Object.fromEntries(tags.map(([k, v], i) => [k, i === 8 ? (ad.type === 'VIDEO' ? 'Video corto' : ad.type === 'CAROUSEL' ? 'Carrusel' : 'Imagen única') : v]));
    await store(['SET', `dtc:analytics:tags:${ad.id}`, JSON.stringify(value)]);
  }
  await store(['SET', `dtc:analytics:report:${user}:demo-semanal`, JSON.stringify({ name: 'Campañas, últimos 30 días', from: shift(D, -30), to: shift(D, -1), level: 'campaign', dimension: 'none', granularity: 'day', metric: 'roas' })]);
  await store(['SADD', `dtc:analytics:reports:${user}`, 'demo-semanal']);

  return { D, snapshot: snapshot.modules, agentRuns: runs, inspiration };
}
