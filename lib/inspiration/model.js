// Ads are public observations, never evidence of competitor sales or profitability.
// Brands tracked from the first run. Empty by default: add competitors from the Radar view.
// Entries have the shape { id, name, website, query, page_id }.
export const SEED_BRANDS = [];
export const text = (v, max = 8000) => typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, max) : '';
export function safeUrl(v, media = false) {
  try { const u = new URL(v); if (u.protocol !== 'https:' || u.username || u.password) return null;
    if (media && !['fbcdn.net', 'cdninstagram.com'].some(d => u.hostname.endsWith('.' + d))) return null;
    return u.href;
  } catch { return null; }
}
const iso = v => { const n = typeof v === 'number' ? v * 1000 : Date.parse(v); return Number.isFinite(n) ? new Date(n).toISOString() : null; };
export function reportedMetric(value){
 const number=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))&&Number(v)>=0?Number(v):null;
 if(typeof value==='number'||typeof value==='string')return number(value);
 if(!value||typeof value!=='object')return null;
 const lower=number(value.lower_bound),upper=number(value.upper_bound);
 return lower!==null||upper!==null?{lower,upper}:null;
}
export function normalizeAd(raw, brand, observedAt) {
  const id = String(raw.ad_archive_id ?? ''); if (!/^\d{1,25}$/.test(id)) return null;
  if (String(raw.page_id ?? raw.snapshot?.page_id) !== brand.page_id) return null;
  const s = raw.snapshot || {}, cards = Array.isArray(s.cards) ? s.cards : [];
  const image = (s.images || []).map(x => safeUrl(x.original_image_url || x.resized_image_url, true)).find(Boolean);
  const videos = Array.isArray(s.videos) ? s.videos : [];
  const video = videos[0] || cards.find(x => x.video_sd_url || x.video_hd_url) || {};
  return { id, brand_id: brand.id, page_id: brand.page_id, page_name: text(raw.page_name || s.page_name, 120),
    body: text(s.body?.text || cards.map(c => c.body).filter(Boolean).join('\n')), title: text(s.title || cards[0]?.title, 500),
    cta: text(s.cta_text || cards[0]?.cta_text, 100), format: text(s.display_format, 40),
    landing_url: safeUrl(s.link_url || cards[0]?.link_url),
    image_url: image || safeUrl(video.video_preview_image_url, true) || safeUrl(cards[0]?.original_image_url, true),
    video_url: safeUrl(video.video_sd_url || video.video_hd_url, true),
    cards: cards.slice(0, 20).map(c => ({body:text(c.body),title:text(c.title,500),image_url:safeUrl(c.original_image_url || c.resized_image_url,true),video_url:safeUrl(c.video_sd_url || c.video_hd_url,true),landing_url:safeUrl(c.link_url)})),
    collation_count:Number.isInteger(Number(raw.collation_count))&&Number(raw.collation_count)>0?Number(raw.collation_count):null,
    collation_id:text(String(raw.collation_id||''),80),
    impressions_text:text(raw.impressions_with_index?.impressions_text,100)||null,
    impressions:reportedMetric(raw.impressions),reach:reportedMetric(raw.reach_estimate??raw.eu_total_reach),spend:reportedMetric(raw.spend),currency:text(raw.currency,10)||null,
    ended_at:iso(raw.end_date_string||raw.end_date),
    is_active: typeof raw.is_active === 'boolean' ? raw.is_active : null,
    started_at: iso(raw.start_date_string || raw.start_date),
    platforms: Array.isArray(raw.publisher_platform) ? raw.publisher_platform.map(x => text(x, 40)).slice(0, 10) : [],
    source_url: `https://www.facebook.com/ads/library/?id=${id}`, observed_at: observedAt };
}
