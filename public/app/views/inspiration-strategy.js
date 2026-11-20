import {h,replace} from '/app/dom.js';
import {getLocale} from '/app/format.js';
const button=(label,fn)=>h('button',{type:'button',class:'btn',onclick:fn},label);
const format=n=>typeof n==='number'?new Intl.NumberFormat('es-MX',{maximumFractionDigits:2}).format(n):'—';
const concise=(value,max=180)=>{const text=String(value||'').replace(/\b\d{12,25}\b/g,'').replace(/\([\s,]*\)/g,'').replace(/\s+/g,' ').trim();if(text.length<=max)return text;return text.slice(0,max).replace(/\s+\S*$/,'')+'…';};
function dailyRecipe(a){
 if(a.daily?.did&&a.daily?.why&&Array.isArray(a.daily.steps)&&a.daily.steps.length===3)return a.daily;
 const sentence=t=>String(t||'').replace(/\b\d{12,25}\b/g,'').replace(/\([\s,]*\)/g,'').split(/(?<=[.!?])\s/)[0];
 return {did:sentence(a.why),why:sentence(a.hypothesis),steps:[a.hooks[0]||a.cta,sentence(a.visuals),sentence(a.test)]};
}
const labels={product:'Producto a impulsar',audience:'Audiencia',offer:'Oferta y precio vigentes',proof:'Beneficios y pruebas aprobados',constraints:'Restricciones de marca y producción',goal:'Objetivo'};
const states={pendiente:'Pendiente',produccion:'En producción',prueba:'En prueba',ganador:'Aprendizaje positivo',descartado:'Descartado'};
const errors={busy:'Hay una generación en curso. Espera un momento.',plan_limit:'Llegaste a dos planes nuevos hoy. Los guardados siguen disponibles.',ai_disabled:'Gemini no está habilitado.',analysis_incomplete:'Gemini no terminó el plan. No guardamos contenido incompleto.',no_ads:'Importa anuncios antes de generar el plan.'};
export function strategyPanel({api,openAd,getAd=()=>null,onCleanup}){
 const root=h('section',{class:'insp-strategy'}),status=h('p',{role:'status','aria-live':'polite'}),content=h('div');let data,working=false,active=true,progressTimer,elapsedTimer;onCleanup?.(()=>{active=false;clearInterval(progressTimer);clearInterval(elapsedTimer);});

 const progressBox=h('div',{class:'plan-progress',hidden:true});
 async function generatePlan(){
  const began=Date.now();let stage='sending',reused=false;
  const steps=[['collecting','Reunir referencias'],['generating','Crear propuestas'],['validating','Validar referencias'],['saving','Guardar plan']];
  const elapsed=h('span',{class:'muted small','aria-hidden':'true'});
  const draw=()=>{if(!active)return;const index=steps.findIndex(([key])=>key===stage);replace(progressBox,h('div',{class:'plan-progress-heading'},h('strong',{},stage==='complete'?(reused?'Plan recuperado':'Plan listo'):stage==='failed'?'No se pudo completar':'Preparando tu plan'),elapsed),reused?null:h('ol',{},steps.map(([key,label],i)=>h('li',{class:stage==='complete'||i<index?'done':i===index?'current':'pending'},h('span',{},stage==='complete'||i<index?'✓':String(i+1)),label))),h('p',{class:'muted small'},stage==='sending'?'Enviando solicitud…':stage==='generating'?'Gemini está preparando las acciones. Esta etapa puede tardar unos minutos.':stage==='complete'?(reused?'Los datos no cambiaron. Recuperamos tu plan guardado sin otra llamada a Gemini.':'Referencias verificadas y plan guardado.'):'El plan anterior sigue disponible debajo.'));
  };
  progressBox.hidden=false;status.textContent='';draw();
  const tick=()=>{elapsed.textContent=Math.floor((Date.now()-began)/1000)+' s transcurridos';};tick();
  elapsedTimer=setInterval(tick,1000);
  let polling=false;
  const poll=async()=>{if(polling||!active)return;polling=true;try{const r=await api.get('inspiration/progress');if(r.ok&&r.data&&Date.parse(r.data.started_at)>=began-2000&&steps.some(([k])=>k===r.data.stage)){stage=r.data.stage;draw();tick();}}finally{polling=false;}};
  progressTimer=setInterval(()=>poll().catch(()=>{}),2500);
  try{const r=await api.post('inspiration/plan',{}, {timeoutMs:170000});if(!active)return;if(!r.ok){stage='failed';draw();status.textContent=errors[r.data?.error]||'No se pudo confirmar el resultado. Puedes revisar los planes guardados.';return;}reused=r.data?.reused===true;stage='complete';draw();tick();await load();}
  catch(e){stage='failed';draw();throw e;}finally{clearInterval(progressTimer);clearInterval(elapsedTimer);}
 }
 async function run(fn){if(working)return;working=true;status.textContent='Procesando…';root.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch{status.textContent='No se pudo conectar. Tus planes guardados siguen disponibles.';}finally{working=false;root.querySelectorAll('button').forEach(b=>b.disabled=false);}}
 async function load(){const r=await api.get('inspiration/intelligence');if(!active)return;if(!r.ok){status.textContent='No se pudo cargar la inteligencia creativa.';return;}data=r.data;paint();}
 const block=(title,value)=>h('section',{class:'insp-plan-block'},h('h4',{},title),h('p',{class:'insp-full-copy'},value));
 function planView(plan){
  const date=new Date(plan.created_at).toLocaleString('es-MX');
  return h('article',{class:'card insp-plan ibex-daily-plan'},h('div',{class:'ibex-section-title'},h('h3',{},'Tus próximas 3 acciones'),h('span',{class:'muted small'},date)),h('p',{class:'muted small'},'Propuestas para probar. Confirma oferta y beneficios antes de producir.'),
   h('div',{class:'ibex-daily-actions'},...plan.actions.map((a,index)=>{const state=h('select',{'aria-label':`Estado: ${a.title}`},Object.entries(states).map(([value,label])=>h('option',{value},label)));state.value=a.status;
    const result=h('textarea',{rows:2,maxlength:2000,'aria-label':`Resultado: ${a.title}`,placeholder:'Qué probamos y qué pasó…'},a.result||'');
    const daily=dailyRecipe(a);
    const reference=plan.evidence.find(e=>e.id===a.source_ids[0]),ad=getAd(reference?.id);
    const visual=reference?h('button',{type:'button',class:'ibex-reference-preview',onclick:()=>openAd(reference.id),'aria-label':`Ver anuncio de ${reference.brand}`},h('img',{src:`/api/inspiration-media?id=${encodeURIComponent(reference.id)}&kind=image`,alt:`Referencia de ${reference.brand}`,loading:'lazy'}),h('span',{},`Referencia · ${reference.brand}${ad?.video_url?' · ▶ Video':''}`)):null;
    visual?.querySelector('img').addEventListener('error',e=>{e.target.hidden=true;});
    return h('section',{class:'insp-plan-action'},h('div',{class:'ibex-action-heading'},h('span',{class:'ibex-action-number'},String(index+1).padStart(2,'0')),h('div',{class:'ibex-action-badges'},h('span',{},`Prioridad ${String(a.priority).toLowerCase()}`),h('span',{},`Esfuerzo ${String(a.effort).toLowerCase()}`))),h('h3',{},daily.title||concise(a.title,95)),visual,
     h('div',{class:'ibex-action-insight'},block('Qué hicieron',daily.did),block('Qué aporta',daily.why)),h('h4',{class:'ibex-how-title'},'Cómo implementarlo'),h('ol',{class:'ibex-steps'},h('li',{},h('strong',{},'Define la idea'),h('p',{},daily.steps[0])),h('li',{},h('strong',{},'Prepara el creativo'),h('p',{},daily.steps[1])),h('li',{},h('strong',{},'Haz una prueba'),h('p',{},daily.steps[2]))),

     h('details',{class:'ibex-action-detail ibex-action-references'},h('summary',{},`Comparar referencias · ${new Set(a.source_ids).size}`),h('div',{class:'insp-actions'},[...new Set(a.source_ids)].map((id,i)=>button(`${i+1}. ${plan.evidence.find(e=>e.id===id)?.brand||'Referencia'} ↗`,()=>openAd(id))))),
     h('details',{class:'ibex-action-detail'},h('summary',{},'Guion, visuales y cómo medir'),block('Contexto completo',a.why),block('Hipótesis completa',a.hypothesis),block('Prueba completa',a.test),h('h4',{},'Más hooks'),h('ol',{},a.hooks.map(t=>h('li',{},t))),block('Guion',a.script),block('Visuales',a.visuals),block('CTA',a.cta),block('Cómo decidir',a.success),a.risks.length?h('p',{class:'muted small'},a.risks.join(' · ')):null),
     h('details',{class:'ibex-action-detail'},h('summary',{},a.result?'Notas de revisión y resultado':'Anotar resultado'),result),
     h('div',{class:'ibex-action-footer'},state,button('Guardar estado',()=>run(async()=>{const r=await api.post('inspiration/action',{id:plan.id,action_id:a.id,status:state.value,result:result.value});if(!r.ok){status.textContent=errors[r.data?.error]||'No se pudo guardar.';return;}status.textContent='Guardado. El próximo plan tendrá en cuenta tu resultado.';await load();}))));})),
   h('details',{class:'ibex-action-detail'},h('summary',{},'Contexto y datos pendientes'),h('p',{},plan.summary),h('p',{class:'muted small'},`Base: ${plan.basis}. Métricas propias al ${plan.own_as_of||'no disponibles'}.`),h('ul',{},(plan.gaps||[]).map(g=>h('li',{},g)))),button('Descargar brief completo',()=>download(plan)));

 }
 function download(plan){const text=[plan.summary,...plan.actions.flatMap(a=>[a.title,a.why,'Hipótesis: '+a.hypothesis,'Hooks:',...a.hooks,'Guion:',a.script,'Visuales:',a.visuals,'CTA: '+a.cta,'Prueba:',a.test,'Decisión:',a.success,'Referencias:',...a.source_ids.map(id=>plan.evidence.find(e=>e.id===id)?.source_url||id)])].join('\n\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));const a=h('a',{href:url,download:`brief-${plan.date}.txt`});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function paint(){const i=data.insights,fields=Object.fromEntries(Object.entries(labels).map(([k,label])=>[k,h('textarea',{rows:2,maxlength:2000,'aria-label':label},data.profile[k]||'')]));
  const hints={product:'Qué producto quieres anunciar ahora.',audience:'A quién le hablas y qué necesita.',offer:'Precio, promoción y condiciones actuales.',proof:'Qué puedes afirmar y con qué respaldo.',constraints:'Tono, recursos disponibles y límites.',goal:'Qué quieres conseguir con la próxima prueba.'};
  const group=(title,keys)=>h('fieldset',{class:'ibex-profile-group'},h('legend',{},title),h('div',{class:'ibex-profile-fields'},keys.map(k=>h('label',{},h('strong',{},labels[k]),h('span',{class:'muted small'},hints[k]),fields[k]))));
  const form=h('form',{class:'insp-form ibex-profile-form'},group('01 · Enfoque de la campaña',['product','audience']),group('02 · Propuesta y respaldo',['offer','proof']),group('03 · Producción y objetivo',['constraints','goal']),h('div',{class:'ibex-profile-footer'},h('span',{class:'muted small'},'Los cambios se usarán en tu próximo plan.'),h('button',{class:'btn primary',type:'submit'},'Guardar cambios')));form.addEventListener('submit',e=>{e.preventDefault();run(async()=>{const r=await api.post('inspiration/profile',Object.fromEntries(Object.entries(fields).map(([k,el])=>[k,el.value])));status.textContent=r.ok?'Contexto guardado para los próximos briefs.':'No se pudo guardar el contexto.';});});
  const own=data.own;
  replace(content,h('div',{class:'insp-strategy-head'},h('div',{},h('p',{class:'eyebrow'},'DE LA EVIDENCIA A LA PRODUCCIÓN'),h('h2',{},'Qué implementar mañana'),h('p',{class:'muted'},'Qué hicieron. Por qué probarlo. Qué hacer hoy.')),
   button('Generar plan con Gemini',()=>run(generatePlan))),
   ...(data.plans.length?data.plans.slice(0,1).map(planView):[h('div',{class:'card insp-empty'},h('h3',{},'Genera tu primer plan'),h('p',{},'Recibirás prioridades, hooks, guiones, referencias y pruebas medibles.'))]),
   h('details',{class:'card insp-context'},h('summary',{},'Tu marca · personaliza el próximo plan'),h('p',{class:'muted'},'Define el producto, la oferta y el objetivo. Puedes editar cada campo cuando cambie tu campaña.'),form),
   h('details',{class:'card insp-own'},h('summary',{},'Ver resultados propios que respaldan el plan'),own?h('div',{},h('p',{class:'muted'},`${own.windows.C.from} — ${own.windows.C.to} · comparación ${own.windows.B.from} — ${own.windows.B.to}`),h('div',{class:'insp-stats'},...['spend','purchases','cpa','roas'].map(k=>h('div',{},h('strong',{},format(own.account.C[k])),{spend:` ${getLocale().currency} invertidos`,purchases:' compras',cpa:` ${getLocale().currency} CPA`,roas:' ROAS'}[k]))),h('p',{class:'muted small'},`Inversión total, todos los objetivos: ${format(own.account_all?.C?.spend)} ${getLocale().currency}. ${own.ads.length} anuncios propios considerados. ${(own.data_gaps||[]).join(' · ')}`),h('a',{href:'#/creativos'},'Abrir analítica de tus creativos →')):h('p',{},'No hay una instantánea reciente utilizable. El plan lo indicará y evitará recomendaciones de inversión sin evidencia.')),
   h('details',{class:'card insp-context'},h('summary',{},`Historial de planes (${Math.max(0,data.plans.length-1)})`),...data.plans.slice(1).map(planView)),
   h('details',{class:'card insp-context'},h('summary',{},'Datos de respaldo de la competencia'),h('p',{class:'muted'},i.caveat),h('div',{class:'insp-brands'},i.brands.map(b=>h('article',{class:'card insp-radar'},h('h3',{},b.name),h('p',{},`${b.total} anuncios importados · ${b.new7} iniciados en 7 días · ${b.unique_hooks} aperturas distintas`),h('p',{class:'muted small'},b.formats.map(f=>`${f.label}: ${f.count}`).join(' · ')),h('p',{class:'muted small'},`${b.partial?'Cobertura parcial: hay más páginas por importar.':'Página importada completa en la última consulta.'} Última importación: ${b.last_import_at?new Date(b.last_import_at).toLocaleDateString('es-MX'):'pendiente'}`)))),
   h('details',{class:'card insp-context'},h('summary',{},'Hooks repetidos · señales de exploración'),h('ol',{},i.hooks.map(g=>h('li',{},h('strong',{},`${g.count} anuncios · `),g.label,' ',button('Ver referencia',()=>openAd(g.ids[0])))))),
   h('details',{class:'card insp-context'},h('summary',{},'Landing pages más utilizadas'),h('ol',{},i.landings.map(g=>h('li',{},h('a',{href:g.label,target:'_blank',rel:'noopener noreferrer'},g.label),` · ${g.count} anuncios`)))),
   h('details',{class:'card insp-context'},h('summary',{},'Mayor antigüedad observada'),h('ol',{},i.longest.map(a=>h('li',{},`${a.brand} · ${a.days} días hasta ${a.observed_at.slice(0,10)} `,button('Revisar',()=>openAd(a.id)))))),
   h('details',{class:'card insp-context'},h('summary',{},'Calendario de lanzamientos observados'),h('ul',{},i.timeline.map(t=>h('li',{},`${t.label} · ${t.count} anuncios`))))));
 }
 root.append(status,progressBox,content);return {element:root,load};
}
