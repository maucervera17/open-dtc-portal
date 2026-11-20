import { readMetrics, money, number, assetRows, assetNotes, campaignNotes, nextSteps, kpisFor } from './model.js';
import { brandName } from './brand.js';
import { activeProfile } from './locale.js';
export { shift, localDate, dayMs, windowFor } from './dates.js';
const emails = value => String(value || '').split(',').map(e => e.trim()).filter(Boolean);
// REPORT_RECIPIENTS: comma-separated emails that receive every report.
// REPORT_SOCIAL_RECIPIENTS: optional extra emails that also receive the social report.
export const recipientsFor = (kind, env = process.env) => kind === 'social'
  ? [...new Set([...emails(env.REPORT_RECIPIENTS), ...emails(env.REPORT_SOCIAL_RECIPIENTS)])]
  : emails(env.REPORT_RECIPIENTS);
export const metrics = readMetrics;
const escape = value => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderReport(window,data,warnings=[]){
 const lines=[`${brandName().toUpperCase()} | REPORTE DE META`,`${window.since} al ${window.until} | ${activeProfile().currency} | ${activeProfile().timezone}`,`Comparación: ${window.previousSince} al ${window.previousUntil}. Periodos de igual duración.`,`${data.length} campañas incluidas. Los resultados se evalúan según el objetivo de cada campaña.`,''];
 for(const item of data){
  lines.push(item.name.toUpperCase());
  const m=readMetrics(item.current);
  if(m)for(const [label,key,format] of kpisFor([item]))lines.push(`${label}: ${format(m[key])}`);
  else lines.push('Sin métricas devueltas en este periodo; no equivale a cero resultados.');
  for(const a of assetRows(item))lines.push(`${a.label}: ${number(a.metrics?.clicks)} clics; ${money(a.metrics?.cpc)} por clic.`);
  lines.push(...assetNotes(item),...campaignNotes(item));
  for(const step of nextSteps(item))lines.push(`Acción: ${step.action}. ${step.reason} Cuándo: ${step.review}`);
  lines.push('');
 }
 lines.push('N/D: dato no disponible o costo sin resultados para calcularlo. Las métricas de medios pueden no sumar los totales y no se mezclan con las del anuncio completo.');
 if(warnings.length)lines.push('DATOS QUE FALTAN',...warnings);
 lines.push('El PDF adjunto contiene las tablas. Este reporte no modifica campañas ni presupuestos.');
 return {subject:`${brandName()} | Meta ${window.since} - ${window.until}`,text:lines.join('\n'),html:`<!doctype html><html lang="es"><meta charset="utf-8"><body style="font-family:Arial,sans-serif;color:#203e6b"><main style="max-width:680px;margin:auto">${lines.map((l,i)=>i===0?`<h1>${escape(l)}</h1>`:`<p style="line-height:1.6">${escape(l)}</p>`).join('')}</main></body></html>`};
}
