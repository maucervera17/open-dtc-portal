import { shift } from './dates.js';
// Optional map of Meta asset id -> friendly label (e.g. {'1234567890':'Hero video'}). Empty by default.
export const assetNames = {};
export const money = n => n == null ? 'N/D' : new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:2}).format(n);
export const number = n => n == null ? 'N/D' : new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(n);
export const percent = n => n == null ? 'N/D' : `${number(n)}%`;
export const ratio = (a,b) => a == null || !b ? null : a/b;
export function manualWindow(since,until) {
 for (const d of [since,until]) if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '') || shift(d,0)!==d) throw Error('Invalid date');
 const days=Math.round((Date.parse(until)-Date.parse(since))/86400000)+1;
 if(days<1||days>31) throw Error('Choose 1 to 31 days');
 return {since,until,previousSince:shift(since,-days),previousUntil:shift(since,-1)};
}
export function readMetrics(row) {
 if(!row) return null;
 const numeric=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
 const n=k=>numeric(row[k]);
 const action=k=>!Array.isArray(row.actions)?null:numeric(row.actions.find(a=>a.action_type===k)?.value??0);
 const m={spend:n('spend'),impressions:n('impressions'),reach:n('reach'),clicks:n('inline_link_clicks'),visits:action('landing_page_view'),content:action('offsite_conversion.fb_pixel_view_content'),carts:action('offsite_conversion.fb_pixel_add_to_cart'),checkout:action('offsite_conversion.fb_pixel_initiate_checkout'),purchases:action('offsite_conversion.fb_pixel_purchase'),comments:action('comment'),shares:action('post'),reactions:action('post_reaction'),saves:action('onsite_conversion.post_save'),engagement:action('post_engagement'),leads:action('lead')};
 m.cpl=ratio(m.spend,m.leads);
 m.cpc=ratio(m.spend,m.clicks);m.cpv=ratio(m.spend,m.visits);m.cpa=ratio(m.spend,m.purchases);m.ctr=m.impressions&&m.clicks!=null?100*m.clicks/m.impressions:null;
 return m;
}
export const kpis=[['Inversión','spend',money],['Impresiones','impressions',number],['Personas alcanzadas','reach',number],['Clics al enlace','clicks',number],['Costo por clic','cpc',money],['Tasa de clics (CTR)','ctr',percent],['Visitas a la página','visits',number],['Costo por visita','cpv',money],['Añadidos al carrito','carts',number],['Inicios de pago','checkout',number],['Compras registradas','purchases',number],['Costo por compra','cpa',money],['Comentarios','comments',number],['Compartidos','shares',number],['Reacciones','reactions',number],['Guardados','saves',number],['Interacciones totales','engagement',number]];
export function campaignNotes(item) {
 const m=readMetrics(item.current),p=readMetrics(item.previous),notes=[];
 if(!m) return ['Meta no devolvió métricas del periodo. No podemos evaluar esta campaña.'];
 if(!p) notes.push('No tenemos el periodo anterior en esta fuente. La evolución queda pendiente; no inferimos subidas ni bajadas.');
 else {
  for(const [label,key,format] of [kpis[0],kpis[3],kpis[6],kpis[8],kpis[10]]) {
   if(m[key]==null||p[key]==null) continue;
   const diff=m[key]-p[key];
   notes.push(`${label}: ${format(p[key])} antes y ${format(m[key])} ahora (${diff>0?'+':''}${format(diff)}${p[key]>0?`; ${diff>0?'+':''}${percent(diff/p[key]*100)}`:''}).`);
  }
 }
 if(isSales(item) && m.purchases===0) notes.push('No vemos compras atribuidas. Revisaremos visitas, carritos y medición antes de decidir por costo por clic.');
 else if(isSales(item) && m.purchases>0) notes.push(`Registramos ${number(m.purchases)} compras a ${money(m.cpa)} cada una. Falta el margen para evaluar rentabilidad.`);
 return notes;
}
export function assetRows(item) {
 return (item.assets||[]).map(r=>({id:r.video_asset?.id||r.image_asset?.hash||r.image_asset?.id||r.ad_id,label:(assetNames[r.video_asset?.id]||r.video_asset?.name||r.image_asset?.name||(r.comparisonLevel!=='ad'&&(r.video_asset?.id||r.image_asset?.hash||r.image_asset?.id)?'Arte '+String(r.video_asset?.id||r.image_asset?.hash||r.image_asset?.id).slice(-6):r.ad_name)||'Arte sin identificar')+(r.comparisonLevel==='ad'?' (anuncio completo)':''),group:r.comparisonLevel==='ad'?'ad':r.video_asset?'video':r.image_asset?'image':'unknown',metrics:readMetrics(r)})).sort((a,b)=>a.label.localeCompare(b.label,'es'));
}
export function comparableAssets(item) {
 const rows=assetRows(item);
 if(new Set(rows.map(r=>r.group)).size!==1)return [];
 if(rows.some((r,i)=>rows.some((other,j)=>i!==j&&r.id&&r.id===other.id)))return [];
 return rows.filter(a=>a.metrics?.cpc!=null).sort((a,b)=>a.metrics.cpc-b.metrics.cpc);
}
export const objectiveOf=item=>item.objective||item.current?.objective||'';
export const isSales=item=>['OUTCOME_SALES','CONVERSIONS','PRODUCT_CATALOG_SALES'].includes(objectiveOf(item));
export function kpisFor(items){return items.some(i=>['OUTCOME_LEADS','LEAD_GENERATION'].includes(objectiveOf(i)))?[...kpis,['Leads registrados','leads',number],['Costo por lead','cpl',money]]:kpis;}
export function assetNotes(item) {
 const rows=comparableAssets(item);
 if(rows.length<2)return ['No hay dos medios distintos con un desglose comparable. No se asigna ganador entre medios y anuncios completos.'];
 const [a,b]=rows;
 const notes=[`${a.label} tiene el menor costo por clic observado: ${money(a.metrics.cpc)}, frente a ${money(b.metrics.cpc)} de ${b.label}${b.metrics.cpc?` (${percent((1-a.metrics.cpc/b.metrics.cpc)*100)} menos)`:''}.`];
 const visits=rows.filter(a=>a.metrics.cpv!=null).sort((a,b)=>a.metrics.cpv-b.metrics.cpv);
 if(visits.length>1) notes.push(`En visitas registradas, ${visits[0].label} cuesta ${money(visits[0].metrics.cpv)} por visita, frente a ${money(visits[1].metrics.cpv)}. Los eventos por arte pueden no sumar el total.`);
 notes.push('Esta es una comparación descriptiva. El gasto y la exposición son distintos; un clic más barato no demuestra mejores ventas.');
 return notes;
}

export function nextSteps(item) {
 const m=readMetrics(item.current),p=readMetrics(item.previous);
 const objective=item.objective||item.current?.objective||'';
 if(!m) return [{action:'Comprobar entrega y estado antes de invertir más',reason:`No hay resultados para este periodo. Estado reportado: ${item.effective_status||'no disponible'}.`,review:'Antes de activar o cambiar presupuesto.'}];
 if(['PAUSED','ARCHIVED','DELETED'].includes(item.effective_status))return [{action:'Mantener el estado actual hasta revisar el motivo de la pausa',reason:'El periodo puede contener resultados históricos, pero la campaña no está activa. No recomendamos reactivarla solo por esos resultados.',review:'Antes de cualquier reactivación.'}];
 if(['OUTCOME_LEADS','LEAD_GENERATION'].includes(objective))return [{action:'Validar leads y costo por lead antes de cambiar presupuesto',reason:`El objetivo es captar contactos: ${number(m.leads)} leads registrados a ${money(m.cpl)} cada uno. Validar su calidad antes de aumentar inversión.`,review:'En la próxima revisión, junto con la calidad de los contactos.'}];
 if(['OUTCOME_AWARENESS','BRAND_AWARENESS','REACH','OUTCOME_ENGAGEMENT','POST_ENGAGEMENT','VIDEO_VIEWS'].includes(objective))return [{action:'Evaluar el resultado propio del objetivo antes de reemplazar artes',reason:`Objetivo: ${objective}. Revisar alcance, interacción o reproducciones según la optimización; no exigir compras como criterio de éxito.`,review:'En 3 días, comparando periodos equivalentes.'}];
 const actions=[];
 if(m.clicks>0 && m.visits===0)actions.push({action:'Probar el enlace y validar el evento de visita',reason:`Hay ${number(m.clicks)} clics y ninguna visita registrada. No aumentar presupuesto hasta aclarar esa diferencia.`,review:'Hoy, antes de la próxima inversión adicional.'});
 else if(m.purchases===0 && isSales(item)) actions.push({action:'Mantener presupuesto y comprobar el recorrido de compra',reason:`Con ${number(m.visits)} visitas, ${number(m.carts)} carritos y ${number(m.checkout)} inicios de pago, todavía no hay compras registradas. Probar el checkout y revisar eventos antes de escalar.`,review:'Validar el recorrido hoy; volver a evaluar resultados en 3 días.'});
 else if(m.purchases>0 && isSales(item))actions.push({action:'Fijar el costo máximo por compra antes de escalar',reason:`El costo observado es ${money(m.cpa)}. Compararlo con el margen disponible; sin ese límite no hay base para recomendar más inversión.`,review:'Antes de cambiar el presupuesto.'});
 else if(['OUTCOME_TRAFFIC','LINK_CLICKS'].includes(objective)) actions.push({action:'Mantener presupuesto y revisar costo por visita',reason:`El objetivo es tráfico. Costo por visita observado: ${money(m.cpv)}; comparar con el periodo anterior antes de reemplazar artes.`,review:'En 3 días.'});
 if(!actions.length)actions.push({action:'Confirmar el objetivo y completar los datos antes de decidir',reason:'No hay datos suficientes del resultado principal para recomendar un cambio de presupuesto.',review:'Antes del siguiente cambio de presupuesto.'});
 const candidates=comparableAssets(item);
 if(candidates.length>1 && candidates.every(a=>a.metrics.clicks>=20)){
  const best=candidates[0],worst=candidates.at(-1);
  actions.push({action:`Preparar una alternativa a ${worst.label}; mantener los actuales durante la prueba`,reason:`${worst.label} cuesta ${money(worst.metrics.cpc)} por clic, frente a ${money(best.metrics.cpc)} de ${best.label}. Usar el nuevo arte como siguiente prueba, no como motivo para pausar hoy por CPC.`,review:'Comparar visitas y el resultado principal dentro de esta campaña en la próxima revisión.'});
 }
 if(!p)actions.push({action:'Obtener el periodo anterior para medir la evolución',reason:'La fuente actual no permite saber si mejoramos o empeoramos.',review:'Antes de la siguiente decisión de presupuesto.'});
 return actions;
}
