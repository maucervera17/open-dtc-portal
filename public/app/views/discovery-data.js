import {copyKey,observedDays,signalsFor} from './creative-signals.js';
export const metricValue=v=>typeof v==='number'&&Number.isFinite(v)?v:v&&typeof v==='object'?(v.upper??v.lower??null):null;
export const metricLabel=v=>{if(typeof v==='number')return v.toLocaleString('es-MX');if(!v)return null;const f=n=>n?.toLocaleString('es-MX');return v.lower!=null&&v.upper!=null?`${f(v.lower)}–${f(v.upper)}`:v.lower!=null?`${f(v.lower)}+`:v.upper!=null?`Hasta ${f(v.upper)}`:null;};
export function estimatedSpend(ad,cpm){const v=ad.impressions;if(!Number.isFinite(cpm)||cpm<=0||metricValue(v)===null)return null;return typeof v==='number'?v*cpm/1000:{lower:v.lower===null?null:v.lower*cpm/1000,upper:v.upper===null?null:v.upper*cpm/1000};}
export function discoverySignals(ad,ads,now=Date.now()){
 const s=signalsFor(ad,ads,now),repetitions=Math.max(s.variants,ad.collation_count||0);
 return {...s,repetitions,trending:ad.is_active===true&&!s.stale&&s.days!==null&&s.days<=90&&repetitions>=2};
}
export function sortDiscovery(rows,sort,universe=rows,now=Date.now()){
 const metricSort=field=>(a,b)=>{const av=metricValue(a[field]),bv=metricValue(b[field]);return av===null?bv===null?0:1:bv===null?-1:bv-av;};
 const order=sort==='reach'?metricSort('reach'):sort==='impressions'?metricSort('impressions'):sort==='saved'?(a,b)=>Number(!!b.favorite)-Number(!!a.favorite):sort==='long'?(a,b)=>(observedDays(b)??-1)-(observedDays(a)??-1):sort==='repeated'?(a,b)=>discoverySignals(b,universe,now).repetitions-discoverySignals(a,universe,now).repetitions:sort==='recent'?(a,b)=>String(b.started_at||'').localeCompare(String(a.started_at||'')):()=>0;
 return [...rows].sort(order);
}

export function groupTrending(rows){const seen=new Set();return rows.filter(ad=>{const key=ad.brand_id+'|'+(ad.collation_id||copyKey(ad)||ad.id);if(seen.has(key))return false;seen.add(key);return true;});}

export function sameDiscoveryQuery(a,b){return !!b&&["query","country","media","status","language","matching","sort"].every(k=>a[k]===b[k]);}

export function matchesDiscoveryFormat(ad,format){const video=ad.format==='VIDEO'||!!ad.video_url||ad.cards?.some(c=>c.video_url);return format==='ALL'||(format==='VIDEO'?!!video:!video&&(ad.format==='IMAGE'||!!ad.image_url||ad.cards?.some(c=>c.image_url)));}
