export const TAGS={persona:'Persona',desire:'Deseo central',usp:'USP',narrative:'Tema narrativo',message:'Mensaje clave',emotion:'Emoción',visual_hook:'Hook visual',offer:'Tipo de oferta',format:'Formato',production:'Calidad de producción'};
const number=v=>typeof v==='number'&&Number.isFinite(v);
// Money thresholds scale with `unit`: about USD 10 expressed in the account currency (the API sends it as profile.spend_unit). Below one
// unit of spend the evidence is only directional; from 2.5 units, with enough peers and days, it is high. The default keeps the original
// absolute cut-offs (200 and 500) for callers that do not pass a unit.
export function evidence({peers,spend,days,contradiction=false,unit=200}){if(contradiction||peers<5||!number(spend)||spend<unit||days<3)return 'Direccional';if(peers>=10&&spend>=2.5*unit&&days>=7)return 'Alta';return 'Moderada';}
export function combined(rows){const keys=['spend','impressions','clicks','purchases','revenue','leads'];const m=Object.fromEntries(keys.map(k=>[k,rows.some(r=>number(r[k]))?rows.reduce((s,r)=>s+(r[k]??0),0):null]));return {...m,cpl:m.leads>0?m.spend/m.leads:null,roas:m.spend>0&&m.revenue!==null?m.revenue/m.spend:null,cpa:m.purchases>0?m.spend/m.purchases:null,ctr:m.impressions>0?m.clicks/m.impressions:null};}
export function audit(data,goal={metric:'roas',target:'2'},{unit=200,today=new Date().toISOString().slice(0,10)}={}){
 const days=Math.round((Date.parse(data.range.to)-Date.parse(data.range.from))/86400000)+1,ads=data.ads||[],total=combined(ads.map(a=>a.metrics)),target=Number(goal.target)||2,metric=goal.metric||'roas',peers=ads.filter(a=>{const objective=data.campaigns?.find(c=>c.id===a.campaign_id)?.objective;return a.metrics.spend>0&&(objective&&(metric==='cpl'?['OUTCOME_LEADS','LEAD_GENERATION']:['OUTCOME_SALES','CONVERSIONS','PRODUCT_CATALOG_SALES']).includes(objective));}).length;
 const eligible=ads.filter(a=>{const o=data.campaigns?.find(c=>c.id===a.campaign_id)?.objective;return (metric==='cpl'?['OUTCOME_LEADS','LEAD_GENERATION']:['OUTCOME_SALES','CONVERSIONS','PRODUCT_CATALOG_SALES']).includes(o);}),baseline=combined(eligible.map(a=>a.metrics));
 const split=Date.parse(data.range.to)-6*86400000;
 const calls=ads.map(a=>{const m=a.metrics,history=(data.daily||[]).filter(r=>r.id===a.id),current=combined(history.filter(r=>Date.parse(r.date)>=split)),prior=combined(history.filter(r=>Date.parse(r.date)<split)),value=m[metric],passes=number(value)&&(metric==='roas'?value>=target:value<=target),account=baseline[metric],better=number(value)&&number(account)&&(metric==='roas'?value>account:value<account),stability=number(current[metric])&&number(prior[metric])?(metric==='roas'?current[metric]>=target&&prior[metric]>=target:current[metric]<=target&&prior[metric]<=target):null,engagement=number(m.ctr)&&number(baseline.ctr)?m.ctr>=baseline.ctr:null;
 const shareSpend=total.spend>0?m.spend/total.spend:null,shareRevenue=total.revenue>0?m.revenue/total.revenue:null,shareConversions=total.purchases>0?m.purchases/total.purchases:null,shareLeads=total.leads>0?m.leads/total.leads:null,shareOutcome=metric==='cpl'?shareLeads:metric==='cpa'?shareConversions:shareRevenue,contribution=shareSpend!==null&&shareOutcome!==null?shareOutcome>=shareSpend:null;
 const dailySpend=history.reduce((sum,r)=>sum+(r.spend||0),0),concentrated=dailySpend>0&&Math.max(...history.map(r=>r.spend||0))/dailySpend>.5;const contradiction=concentrated||passes&&(engagement===false||stability===false||contribution===false),sampleConfidence=evidence({peers,spend:m.spend,days,contradiction,unit});
 const campaign=data.campaigns?.find(c=>c.id===a.campaign_id),adset=data.adsets?.find(s=>s.id===a.adset_id),blocked=[a.status,campaign?.effective_status,adset?.effective_status].some(s=>s&&s!=='ACTIVE'),learning=adset?.learning_stage_info?.status||null,wrongObjective=!!campaign?.objective&&!(metric==='cpl'?['OUTCOME_LEADS','LEAD_GENERATION']:['OUTCOME_SALES','CONVERSIONS','PRODUCT_CATALOG_SALES']).includes(campaign.objective),reasons=[];
 reasons.push(number(value)?`${metric.toUpperCase()} ${value.toFixed(2)} frente a meta ${target}`:'Sin conversiones suficientes para medir eficiencia');
 reasons.push(`${peers} anuncios comparables · ${days} días · gasto ${m.spend??'N/D'}`);
 reasons.push(number(account)?`Referencia de campañas comparables: ${metric.toUpperCase()} ${account.toFixed(2)}`:'Sin referencia comparable de eficiencia');
 if(engagement!==null)reasons.push(`CTR ${(m.ctr*100).toFixed(2)}% frente a ${(baseline.ctr*100).toFixed(2)}% del grupo comparable`);
 if(stability===null)reasons.push('Falta una segunda semana con resultados comparables');else reasons.push(stability?'Cumple la meta en las dos semanas recientes':'No sostiene la meta en las dos semanas recientes');
 if(concentrated)reasons.push('Más de la mitad del gasto reciente se concentró en un solo día');if(contradiction)reasons.push('Hay señales contradictorias: confianza direccional');
 if(blocked)reasons.push('Entrega no activa en anuncio, conjunto o campaña');if(wrongObjective)reasons.push('Objetivo de campaña distinto de ventas: no se emite decisión por ROAS/CPA de compra');if(learning)reasons.push('Aprendizaje: '+learning);
 // Attribution and learning cannot be inferred from a high ROAS: require explicit review before a confirmed winner.
 const provisional=Date.parse(data.range.to)>=Date.parse(today)-2*86400000;
 const sparseConversions=(metric==='cpl'?m.leads:m.purchases)<2,confidence=wrongObjective||!campaign?.objective||learning!=='SUCCESS'||stability===null||engagement===null||contribution===null||provisional||(passes&&sparseConversions)?'Direccional':sampleConfidence;
 if(!learning)reasons.push('Meta no reporta el estado de aprendizaje');
 if(passes&&sparseConversions)reasons.push('Menos de dos conversiones: un resultado aislado no confirma eficiencia');
 let verdict='Hold',label=passes?'Prometedor · faltan validaciones':'Reunir evidencia';
 if(confidence==='Alta'&&!blocked&&!wrongObjective&&learning==='SUCCESS'&&!provisional&&passes&&better&&stability===true&&engagement===true&&contribution===true){verdict='Scale';label='Candidato a escalar · validar aprendizaje y audiencia';}
 else if(confidence==='Alta'&&!blocked&&!wrongObjective&&learning==='SUCCESS'&&!passes&&stability===false&&!provisional){verdict='Kill';label='Candidato a pausar · revisar causa antes de actuar';}
 if(provisional)reasons.push('Periodo reciente: la atribución puede seguir cambiando');
 return {...a,learning,verdict,label,confidence,sampleConfidence,shareLeads,reasons,shareSpend,shareRevenue,shareConversions,stability,engagement,provisional};
 }).sort((a,b)=>(b.metrics.spend||0)-(a.metrics.spend||0));
 return {calls,total,peers,days,goal:{metric,target}};
}
export function diversity(ads){return Object.entries(TAGS).map(([key,label])=>{const known=ads.filter(a=>a.tags?.[key]?.trim()),groups=new Map();for(const a of known){const tag=a.tags[key].trim().toLowerCase(),g=groups.get(tag)||{tag,count:0,spend:0,ids:[]};g.count++;g.spend+=a.metrics.spend||0;g.ids.push(a.id);groups.set(tag,g);}const all=[...groups.values()].sort((a,b)=>b.spend-a.spend),total=all.reduce((s,g)=>s+g.spend,0),score=total>0?Math.round(100*(1-all.reduce((s,g)=>s+(g.spend/total)**2,0))):null;return {key,label,coverage:ads.length?Math.round(known.length/ads.length*100):0,score,groups:all,action:known.length<ads.length?'Completa las etiquetas para comparar el mix.':all.length<2?'Explora una hipótesis distinta al mensaje actual.':'Contrasta las categorías con los resultados antes de ampliar inversión.'};});}
export function anomalies(series,key){return series.flatMap((r,i)=>{const prev=series[i-1]?.[key],v=r[key];if(!number(prev)||!number(v)||prev<=0)return [];const change=(v-prev)/prev;return Math.abs(change)>=.5?[{date:r.date,change,value:v}]:[];});}
export function suggestTags(ad){const body=String(ad.body||''),s=body.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();return {message:body.split(/[\n.!?]/)[0]?.slice(0,150)||'',format:ad.format==='VIDEO'?'Video':ad.format==='PHOTO'?'Imagen':'',offer:body.match(/\d+\s*%[^.\n]{0,35}|\d+x\d+|envío gratis/iu)?.[0]||'',narrative:/testimonio|me ayudo|mi experiencia/.test(s)?'Testimonio explícito':/como usar|como tomar|paso a paso/.test(s)?'Demostración / uso':/descuento|oferta|\d+%/.test(s)?'Oferta':'',desire:/dormir|sueno|descanso/.test(s)?'Descansar':/energia|cansancio/.test(s)?'Energía':/enfoque|concentracion/.test(s)?'Enfoque':'',persona:/mama|papa|padres/.test(s)?'Madres / padres mencionados':'',usp:'',emotion:'',visual_hook:'',production:''};}

// Repeated associations among qualified candidates, never causal proof or confirmed winners.
export function creativePatterns(calls){
 const winners=calls.filter(a=>a.verdict==='Scale'&&a.confidence==='Alta'),others=calls.filter(a=>a.verdict==='Kill'&&a.confidence==='Alta');
 if(winners.length<2||others.length<2)return [];
 const keys=Object.keys(TAGS),patterns=[];
 for(let i=0;i<keys.length;i++)for(let j=i+1;j<keys.length;j++){
  const key=a=>[a.tags?.[keys[i]],a.tags?.[keys[j]]].every(v=>v?.trim())?[a.tags[keys[i]].trim().toLowerCase(),a.tags[keys[j]].trim().toLowerCase()].join(' + '):null;
  const w=winners.filter(a=>key(a)),o=others.filter(a=>key(a));if(w.length<2||o.length<2)continue;
  for(const label of new Set(w.map(key))){const matches=w.filter(a=>key(a)===label),control=o.filter(a=>key(a)===label);if(matches.length<2||matches.length/w.length<=control.length/o.length)continue;
   patterns.push({label,dimensions:[TAGS[keys[i]],TAGS[keys[j]]].join(' + '),ids:matches.map(a=>a.id),winnerShare:matches.length/w.length,otherShare:control.length/o.length});
  }
 }
 return patterns.sort((a,b)=>(b.winnerShare-b.otherShare)-(a.winnerShare-a.otherShare)).slice(0,5);
}
