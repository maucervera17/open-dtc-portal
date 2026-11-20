const DAY=86400000;
const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const themes=[['Estrés y calma',/estres|ansiedad|relaja|calma/],['Sueño y descanso',/sueno|dormir|duerme|descanso/],['Energía y enfoque',/energia|enfoque|concentracion|productividad/],['Digestión',/digesti|intestin|microbiota|probiot/],['Descuentos',/descuento|\d+\s*%|\boff\b|oferta|hot sale/]];
// `timeZone` decides which calendar day a launch falls on (the account's time zone in the app).
export function marketActivity(ads,now=Date.now(),timeZone='UTC'){
 const unique=[...new Map(ads.map(a=>[a.id,a])).values()];
 const age=a=>(now-Date.parse(a.started_at))/DAY;
 const weeks=Array.from({length:4},(_,i)=>{const offset=3-i;return {label:offset===0?'Últimos 7 días':`${offset*7+1}–${(offset+1)*7} días atrás`,count:unique.filter(a=>age(a)>=offset*7&&age(a)<(offset+1)*7).length};});
 const recent=unique.filter(a=>age(a)>=0&&age(a)<28),previous=unique.filter(a=>age(a)>=28&&age(a)<56);
 const topics=themes.map(([label,re])=>{const current=recent.filter(a=>re.test(normalize(a.body+' '+a.title))),past=previous.filter(a=>re.test(normalize(a.body+' '+a.title)));return {label,count:current.length,previous:past.length,brands:new Set(current.map(a=>a.brand_id)).size,share:recent.length?Math.round(current.length/recent.length*100):null,delta:recent.length&&previous.length?Math.round(100*(current.length/recent.length-past.length/previous.length)):null,id:current[0]?.id};}).filter(t=>t.count||t.previous).sort((a,b)=>b.count-a.count);
 const brands=[...new Set(unique.map(a=>a.brand_id))].map(id=>{const rows=unique.filter(a=>a.brand_id===id),dates=[...new Set(rows.filter(a=>age(a)>=0&&age(a)<90).map(a=>new Date(a.started_at).toLocaleDateString('en-CA',{timeZone})))].sort();const gaps=dates.slice(1).map((d,i)=>(Date.parse(d)-Date.parse(dates[i]))/DAY).sort((a,b)=>a-b),mid=Math.floor(gaps.length/2);return {id,name:rows[0].page_name,launchDays:dates.length,gap:gaps.length?(gaps.length%2?gaps[mid]:(gaps[mid-1]+gaps[mid])/2):null,new28:rows.filter(a=>age(a)>=0&&age(a)<28).length,last:rows.map(a=>a.started_at).filter(d=>Number.isFinite(Date.parse(d))&&Date.parse(d)<=now).sort().at(-1)};}).sort((a,b)=>b.new28-a.new28);
 return {weeks,topics,brands,recent:recent.length,previous:previous.length};
}
