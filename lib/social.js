import {readMetrics,money,number,ratio} from './model.js';
export function socialMetrics(row){
 const base=readMetrics(row);if(!base)return null;
 const actions=row.actions||[];
 // Missing profile-specific actions are unavailable, never replaced by website visits.
 const exact=keys=>{const a=keys.map(k=>actions.find(a=>a.action_type===k)).find(Boolean);return a&&Number.isFinite(Number(a.value))?Number(a.value):null;};
 const profileVisits=row.instagram_profile_visits!=null?Number(row.instagram_profile_visits):exact(['instagram_profile_visit','onsite_conversion.instagram_profile_visit']);
 const follows=exact(['instagram_follow','onsite_conversion.instagram_follow']);
 return {...base,profileVisits,follows,costProfileVisit:ratio(base.spend,profileVisits),costFollow:ratio(base.spend,follows)};
}
export const socialKpis=[['Inversión','spend',money],['Impresiones','impressions',number],['Alcance','reach',number],['Visitas al perfil atribuidas','profileVisits',number],['Costo por visita al perfil','costProfileVisit',money],['Seguimientos atribuidos','follows',number],['Costo por seguimiento','costFollow',money],['Interacciones del anuncio','engagement',number],['Comentarios','comments',number],['Compartidos','shares',number],['Guardados','saves',number]];
export function socialNotes(item){
 const a=socialMetrics(item.current),b=socialMetrics(item.previous);if(!a)return ['Sin entrega en el periodo.'];
 const notes=[];
 for(const [label,key,format] of socialKpis.slice(0,7))if(a[key]!=null&&b?.[key]!=null)notes.push(`${label}: ${format(b[key])} antes; ${format(a[key])} ahora.`);
 if(!notes.length)notes.push('No hay datos comparables del periodo anterior.');
 return notes;
}
export function socialSteps(item){
 const m=socialMetrics(item.current);
 const best=(item.assets||[]).map(a=>({...a,m:socialMetrics(a)})).filter(a=>a.m?.shares!=null&&a.m?.saves!=null).sort((a,b)=>(b.m.shares+b.m.saves)-(a.m.shares+a.m.saves))[0];
 return [{action:'Priorizar visitas al perfil y seguimientos para decidir el presupuesto',reason:`${number(m?.profileVisits)} visitas al perfil y ${number(m?.follows)} seguimientos atribuidos. Los clics al enlace no sustituyen estas métricas.`,review:'En el próximo reporte semanal.'},{action:best?`Crear una variante de ${best.ad_name}`:'Probar una variante con llamada a seguir el perfil',reason:best?`${best.ad_name} acumuló ${number(best.m.shares)} compartidos y ${number(best.m.saves)} guardados. Abrir su enlace, conservar el tema y probar un inicio nuevo. Es una hipótesis para probar: tuvo una exposición distinta a los otros anuncios.`:'Cambiar el inicio y la llamada a seguir el perfil. Evaluar visitas y seguimientos; falta un ranking de contenido.',review:'Publicar una variante durante la próxima semana.'}];
}

export function socialAssetNotes(item){
 const rows=(item.assets||[]).map(a=>({...a,m:socialMetrics(a)})).filter(a=>a.m?.profileVisits!=null).sort((a,b)=>b.m.profileVisits-a.m.profileVisits);
 if(!rows.length)return ['Meta no devolvió visitas al perfil por anuncio. No se asigna ganador.'];
 const lead=rows[0],total=rows.reduce((n,a)=>n+(a.m.spend||0),0);
 const notes=[`${lead.ad_name}: ${number(lead.m.profileVisits)} visitas al perfil a ${money(lead.m.costProfileVisit)}. Es el anuncio con más visitas del periodo.`];
 if(rows.length>1&&rows.some(a=>a.m.profileVisits<20))notes.push('El otro anuncio tiene menos de 20 visitas: mantenerlo en prueba antes de comparar ganadores por costo. La entrega no fue equilibrada.');
 if(total>0)notes.push(`El anuncio principal recibió ${number(100*lead.m.spend/total)}% del gasto observado. El volumen no demuestra que su contenido sea mejor.`);
 return notes;
}
