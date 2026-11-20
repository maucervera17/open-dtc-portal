import {isSales,readMetrics,money,number} from './model.js';
import {brandName} from './brand.js';
export function selectCampaigns(data,kind){
 return data.filter(c=>c.effective_status==='ACTIVE' && (Number(c.current?.impressions)>0||Number(c.current?.spend)>0)).filter(c=>kind==='sales'?isSales(c):c.adsets?.some(a=>a.destination_type==='INSTAGRAM_PROFILE'||a.optimization_goal==='PROFILE_VISIT'));
}
export function shortEmail(window,data,kind,instagram=null){
 const metrics=data.map(c=>readMetrics(c.current));
 const sum=k=>metrics.length&&metrics.every(m=>m?.[k]!=null)?metrics.reduce((s,m)=>s+m[k],0):null;
 const lines=kind==='sales'?[`Ventas: ${data.length} campañas activas con entrega entre ${window.since} y ${window.until}.`,`Inversión: ${money(sum('spend'))}. Compras registradas: ${number(sum('purchases'))}. Carritos: ${number(sum('carts'))}.`,sum('purchases')===0?'Prioridad: revisar el recorrido de compra y la medición antes de aumentar presupuesto.':'Prioridad: comparar el costo por compra con el margen antes de aumentar presupuesto.']:[`Redes: ${data.length} campañas activas de tráfico al perfil entre ${window.since} y ${window.until}.`,`Inversión: ${money(sum('spend'))}. El PDF separa el rendimiento pagado del crecimiento total del perfil.`,`Revisar las publicaciones destacadas y las propuestas de contenido en el PDF.`];
 if(kind==='social'&&instagram)lines.splice(2,0,`Instagram: ${number(instagram.current.follows)} nuevos seguidores, ${number(instagram.current.unfollows)} bajas y ${number(instagram.current.net)} de crecimiento neto. Visitas al perfil: ${number(instagram.current.profile_views)} frente a ${number(instagram.previous.profile_views)} del periodo anterior. Estas cifras incluyen la actividad total del perfil y no se atribuyen solo a los anuncios.`);
 const previous=data.map(c=>readMetrics(c.previous));
 if(kind==='sales'&&previous.every(m=>m?.purchases!=null))lines.push(`Periodo anterior, mismas campañas: ${number(previous.reduce((n,m)=>n+m.purchases,0))} compras. Periodo actual: ${number(sum('purchases'))}.`);
 lines.push('Adjuntamos el detalle y la comparación con el periodo anterior. Solo se incluyen campañas activas con entrega en el periodo.');
 return {subject:`${brandName()} | ${kind==='sales'?'Ventas':'Redes'} | ${window.since} - ${window.until}`,text:lines.join('\n\n'),html:`<main style="font-family:Arial,sans-serif;color:#203e6b;max-width:640px">${lines.map(l=>`<p>${l}</p>`).join('')}</main>`};
}
