// Signals from public observations only. Never estimates competitor sales or spend.
const DAY=86400000;
export const copyKey=a=>(a.body||a.title||'').toLowerCase().replace(/\s+/g,' ').trim();
export function observedDays(a){const end=Date.parse(a.observed_at),start=Date.parse(a.started_at);return Number.isFinite(end)&&Number.isFinite(start)&&end>=start?Math.floor((end-start)/DAY):null;}
export function relatedAds(a,ads,now=Date.now()){
 const key=copyKey(a);if(!key)return [];
 const unique=new Map();for(const b of ads){const observed=Date.parse(b.observed_at);if(b.brand_id===a.brand_id&&copyKey(b)===key&&b.is_active===true&&Number.isFinite(observed)&&now-observed<=7*DAY&&observed<=now)unique.set(b.id,b);}
 return [...unique.values()].sort((a,b)=>String(a.started_at||'').localeCompare(String(b.started_at||''))||String(a.id).localeCompare(String(b.id)));
}
export function signalsFor(a,ads,now=Date.now()){
 const variants=relatedAds(a,ads,now).length;
 const age=observedDays(a),observed=Date.parse(a.observed_at),stale=!Number.isFinite(observed)||observed>now||now-observed>7*DAY;
 return {candidate:!stale&&a.is_active===true&&age>=30&&variants>=2,days:age,variants,stale,recent:Date.parse(a.started_at)>=now-7*DAY&&Date.parse(a.started_at)<=now,
 reason:stale?'Falta actualizar su estado':a.is_active!==true?'No tiene actividad confirmada':variants>1?`${variants} anuncios activos comparten este copy`:age>=30?`Activo en la consulta · ${age} días desde su lanzamiento`:'Creativo reciente para explorar',
 suggestion:variants>1?'Compara las ejecuciones visuales de este mensaje. Prueba un hook original conservando una sola variable.':age>=30?'Estudia la apertura, la oferta y el CTA de esta referencia. Prueba esa estructura con el producto y la evidencia de tu marca.':'Observa cómo presenta el producto y qué objeción aborda. Guárdalo para comparar si la marca lo mantiene en próximas revisiones.'};
}
export function marketSnapshot(ads,now=Date.now()){
 const active=ads.filter(a=>a.is_active===true),formats=new Map();for(const a of active){const f=a.format||'Sin clasificar';formats.set(f,(formats.get(f)||0)+1);}
 const groups=new Map();for(const a of active){const key=copyKey(a);if(!key)continue;const id=a.brand_id+'|'+key;const g=groups.get(id)||{brand:a.page_name,label:a.body||a.title,ids:[]};g.ids.push(a.id);groups.set(id,g);}
 const dates=ads.map(a=>a.observed_at).filter(Boolean).sort();
 return {total:ads.length,active:active.length,long:active.filter(a=>(observedDays(a)??0)>=30).length,new7:active.filter(a=>signalsFor(a,[],now).recent).length,stale:active.filter(a=>signalsFor(a,[],now).stale).length,
 formats:[...formats].sort((a,b)=>b[1]-a[1]),repeated:[...groups.values()].filter(g=>g.ids.length>1).sort((a,b)=>b.ids.length-a.ids.length),oldestObservation:dates[0],latestObservation:dates.at(-1)};
}

// Deterministic copy observations, not visual analysis or performance claims.
export function creativeReading(ad){
 const body=String(ad.body||ad.title||'').trim(),lines=body.split(/\n/).map(x=>x.trim()).filter(Boolean);
 const short=text=>text.length>100?text.slice(0,97).trimEnd()+'…':text;
 const opening=short(lines[0]||body),offer=body.match(/(?:hasta\s+)?\d+\s*%\s*(?:OFF|de descuento)/i)?.[0];
 if(!body)return {did:'Este anuncio no incluye texto en la importación.',why:'Abre el creativo para revisar su apertura y su llamada a la acción.',action:'Revisa el video o la imagen antes de elegir qué adaptar.'};
 if(/quiz|cuestionario/i.test(body))return {did:`Invita a elegir el producto con un cuestionario: «${opening}».`,why:'Da un siguiente paso concreto a quien todavía no sabe qué producto elegir.',action:'Prueba una pregunta sobre la necesidad del cliente antes de presentar el producto.'};
 if(/mamá|papá|hijos/i.test(body))return {did:`Llama directamente a madres y padres: «${opening}».`,why:'Nombra al comprador desde la apertura, antes de explicar la oferta.',action:'Prueba una apertura que nombre a un público específico y su situación.'};
 if(/[✔✅✨⚡💊]/u.test(body)&&lines.length>=4)return {did:`Abre con «${opening}» y enumera sus argumentos en líneas separadas.${offer?` Cierra con ${offer}.`:''}`,why:offer?'Combina motivos de compra con un incentivo de precio al final.':'Cada línea presenta un motivo de compra que se puede leer por separado.',action:offer?'Prueba tres argumentos comprobables de tu producto y una oferta al cierre.':'Prueba tres argumentos comprobables, uno por línea, y termina con una sola acción.'};
 if(offer)return {did:`Presenta ${offer} junto a su propuesta: «${opening}».`,why:'Hace visible el incentivo de precio sin obligar a abrir la página de venta.',action:'Prueba mostrar una oferta real junto al producto desde el primer cuadro.'};
 if(/^\s*[¿?]/.test(body))return {did:`Abre con la pregunta «${opening}».`,why:'Presenta una situación del cliente antes de introducir el producto.',action:'Prueba una pregunta sobre una situación cotidiana y muestra el producto después.'};
 return {did:`Abre con «${opening}».`,why:'Esta es la primera idea que recibe el usuario; compárala con la apertura de las otras versiones.',action:'Prueba una apertura alternativa manteniendo el mismo producto, oferta y cierre.'};
}

// Classify evidence independently of presentation limits. A carousel is a selection,
// not a verdict on the ads omitted from it. Variants retain their family's signals.
export function prioritizeAds(ads,now=Date.now()){
 return new Map(ads.map(ad=>{
 const s=signalsFor(ad,ads,now);
 const usable=!s.stale&&ad.is_active===true;
 const tier=usable&&s.candidate?'priority':usable&&s.days!==null&&s.days>=7&&(s.variants>=2||s.days>=30)?'test':'insufficient';
 const evidence=[s.days===null?'Fecha de inicio no disponible':`${s.days} días desde su inicio`,s.variants>1?`${s.variants} anuncios activos con este texto`:'Una versión observada de este mensaje'].join(' · ')+'.';
 const reason=s.stale?'Referencia guardada pendiente de actualizar. Puedes estudiar su creativo; actualiza la marca antes de interpretar su actividad actual.':
 ad.is_active!==true?'Referencia histórica: no figura activa en la última consulta. Úsala para estudiar el mensaje y compararlo con los anuncios actuales.':
 tier==='priority'?`${evidence} Combina dos señales: 30+ días desde el lanzamiento y varias versiones activas. Prioriza adaptar este mensaje; compara sus ejecuciones antes de producir.`:
 s.days===null?`${evidence} Falta la fecha para valorar su persistencia. Revisa el creativo antes de convertirlo en una prueba.`:
 s.days<7?`${evidence} Es reciente: todavía no hay suficiente trayectoria. Guárdalo y revisa si la marca lo mantiene.`:
 s.variants>1?`${evidence} Ya tiene repetición y al menos una semana de trayectoria, pero todavía no alcanza 30 días. Prueba su apertura con una ejecución pequeña.`:
 tier==='test'?`${evidence} Tiene persistencia, pero no repetición suficiente para liderar. Prueba una variante pequeña de su enfoque.`:
 `${evidence} Aún no combina persistencia ni repetición. Revisa su propuesta y espera más observaciones antes de priorizar producción.`;
 return [ad.id,{...s,tier,label:tier==='priority'?'Priorizar':tier==='test'?'Para probar':'Por revisar',reason}];
 }));
}

// Exact-copy families only, not an AI claim that different messages are the same idea.
export function referenceFamilies(ads,priorities){
 const order={priority:0,test:1,insufficient:2};
 const sorted=[...ads].sort((a,b)=>order[priorities.get(a.id).tier]-order[priorities.get(b.id).tier]||Number(b.is_active===true)-Number(a.is_active===true)||(observedDays(b)??0)-(observedDays(a)??0));
 const seen=new Set();return sorted.filter(a=>{const key=a.brand_id+'|'+(copyKey(a)||a.id);if(seen.has(key))return false;seen.add(key);return true;});
}
