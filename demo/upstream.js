// Every outbound call the portal can make in demo mode, answered locally. Anything not listed here is refused:
// the demo never reaches the network.
import { placeholderPng } from './images.js';
import { COMPETITORS, rawAdsFor, allRawAds } from './competitors.js';
import { BRAND, SITE } from './world.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export class DemoNetworkBlocked extends Error {
  constructor(host) { super(`demo mode: network access to ${host} is blocked`); this.name = 'DemoNetworkBlocked'; this.host = host; }
}

export function createUpstream({ world, graph, outbox = [], now = Date.now }) {
  const D = world.D;
  const credits = { remaining: 4800 };

  function scrape(url, init) {
    const path = url.pathname.replace('/v1/facebook/adLibrary/', '');
    credits.remaining -= 1;
    const base = { success: true, credits_remaining: credits.remaining };
    const body = (() => { try { return init?.body ? JSON.parse(init.body) : {}; } catch { return {}; } })();
    const query = String(body.query ?? url.searchParams.get('query') ?? '').toLowerCase();
    if (path === 'search/companies') {
      const found = COMPETITORS.filter(b => !query || b.name.toLowerCase().includes(query) || b.category.toLowerCase().includes(query));
      return json({ ...base, searchResults: (found.length ? found : COMPETITORS).map(b => ({ page_id: b.page_id, name: b.name, ig_username: b.ig, category: b.category })) });
    }
    if (path === 'company/ads') {
      const brand = COMPETITORS.find(b => b.page_id === String(body.pageId));
      if (!brand) return json({ ...base, results: [], cursor: null });
      const active = body.status === 'INACTIVE' ? false : body.status === 'ALL' ? null : true;
      return json({ ...base, results: rawAdsFor(brand, D).filter(a => active === null || a.is_active === active), cursor: null });
    }
    if (path === 'search/ads') {
      const all = allRawAds(D);
      const matches = all.filter(a => !query || `${a.page_name} ${a.snapshot.body.text} ${a.snapshot.title}`.toLowerCase().includes(query));
      const status = body.status;
      const wanted = (matches.length ? matches : all.slice(0, 12)).filter(a => status === 'ALL' || !status || (status === 'ACTIVE') === a.is_active)
        .filter(a => !body.media_type || body.media_type === 'ALL' || (body.media_type === 'VIDEO') === (a.snapshot.display_format === 'VIDEO'));
      return json({ ...base, searchResults: wanted, searchResultsCount: wanted.length, cursor: null });
    }
    if (path === 'ad') {
      const ad = allRawAds(D).find(a => a.ad_archive_id === url.searchParams.get('id'));
      return ad ? json({ ...base, ...ad, pageID: ad.page_id, pageName: ad.page_name, adArchiveID: ad.ad_archive_id, isActive: ad.is_active, startDate: ad.start_date }) : json({ success: false }, 404);
    }
    return json({ success: false }, 404);
  }

  function whisper(init) {
    const id = (() => { try { return JSON.parse(init.body).id; } catch { return 'ad'; } })();
    const lines = ['[Demo] Transcripción de ejemplo.', 'Este audio es ficticio y no corresponde a un anuncio real.', `Referencia ${String(id).slice(-4)}.`];
    return json({ provider: 'faster-whisper', transcript: lines.join('\n'), segments: lines.map((text, i) => ({ start: i * 4, end: i * 4 + 3.5, text })) });
  }

  const landing = url => new Response(`<!doctype html><html lang="es"><head><title>${BRAND}: cerámica y café</title></head><body>
<h1>Terra, la taza hecha a mano</h1><p>Piezas de cerámica hechas a mano. Envíos a todo el país. Elige entre cuatro colores y arma tu set de café.</p>
<p>Compra segura, cambios sin costo en los primeros días y atención por mensaje. Este sitio es ficticio y existe solo para la demostración.</p>
<a href="${SITE}/products/terra">Comprar Terra</a></body></html>`, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });

  return async function demoFetch(input, init = {}) {
    const url = input instanceof URL ? input : new URL(typeof input === 'string' ? input : input.url);
    const host = url.hostname;
    if (host === 'graph.facebook.com') return graph(url, init);
    if (host === 'api.scrapecreators.com') return scrape(url, init);
    if (host === 'api.resend.com') {
      let message = {};
      try { message = JSON.parse(init.body); } catch { /* keep empty */ }
      outbox.push({ at: new Date(now()).toISOString(), to: message.to, subject: message.subject, text: message.text });
      return json({ id: `demo-email-${outbox.length}` });
    }
    if (LOOPBACK.has(host) && url.pathname === '/api/whisper') return whisper(init);
    if (host.endsWith('.fbcdn.net') || host.endsWith('.cdninstagram.com')) {
      const png = placeholderPng(`insp-${url.pathname}`);
      return new Response(png, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(png.length) } });
    }
    if (host === 'www.example.com' || host.endsWith('.example.com')) return landing(url);
    throw new DemoNetworkBlocked(host);
  };
}

export const isLoopbackHost = host => LOOPBACK.has(host);
