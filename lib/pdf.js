import {profileKpis,contentSuggestions} from './instagram.js';
import {socialMetrics,socialKpis,socialNotes,socialSteps,socialAssetNotes} from './social.js';
import {PDFDocument,StandardFonts,rgb,PDFName,PDFString} from 'pdf-lib';
import {readMetrics,kpisFor,money,number,assetRows,assetNotes,campaignNotes,nextSteps} from './model.js';
import {brandName} from './brand.js';
const BLUE=rgb(.12,.25,.43),INK=rgb(.16,.20,.26),GRAY=rgb(.43,.48,.54),PALE=rgb(.95,.97,.99),LINE=rgb(.85,.89,.93);
export async function makePdf(window,data,warnings=[],meta={}) {
 const social=meta.kind==='social';
 const metric=social?socialMetrics:readMetrics;
 const selectedKpis=items=>social?socialKpis:kpisFor(items);
 const pdf=await PDFDocument.create();
 pdf.setTitle(brandName()+' | Reporte de campañas Meta');pdf.setAuthor(brandName());
 const regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 let page,y,pageCount=0;
 const clean=s=>String(s).replace(/[–—‑]/g,'-').replace(/[^\u0020-\u00ff\n]/g,'');
 const text=(s,x,yy,size=10,font=regular,color=INK)=>page.drawText(clean(s),{x,y:yy,size,font,color});
 const wrap=(s,width,size=10,font=regular)=>{const lines=[];let line='';for(const token of clean(s).split(/\s+/)){const chunks=[];let part='';for(const ch of token){if(font.widthOfTextAtSize(part+ch,size)>width&&part){chunks.push(part);part=ch;}else part+=ch;}if(part)chunks.push(part);for(const word of chunks){const next=line?line+' '+word:word;if(font.widthOfTextAtSize(next,size)>width&&line){lines.push(line);line=word;}else line=next;}}if(line)lines.push(line);return lines;};
 const newPage=(title,subtitle='')=>{page=pdf.addPage([595.28,841.89]);pageCount++;y=750;text(brandName().toUpperCase(),42,799,12,bold,BLUE);text('META / REPORTE DE CAMPAÑAS',320,800,9,regular,GRAY);for(const line of wrap(title,511,22,bold)){text(line,42,y,22,bold,BLUE);y-=26;}if(subtitle){text(subtitle,42,y,10,regular,GRAY);y-=26;}page.drawLine({start:{x:42,y:44},end:{x:553,y:44},color:LINE,thickness:1});text(meta.synthetic?'DATOS SINTÉTICOS / No son resultados de Meta':meta.sample?'Muestra de formato con datos históricos exportados':'Reporte de campañas | Datos atribuidos por Meta',42,28,8,regular,GRAY);text(String(pageCount),542,28,8,regular,GRAY);};
 const ensure=h=>{if(y-h<70)newPage('Continuación',`${window.since} al ${window.until}`);};
 const paragraph=(s,size=10,color=INK)=>{for(const line of wrap(s,511,size)){ensure(size+7);text(line,42,y,size,regular,color);y-=size+5;}y-=7;};
 const heading=s=>{const lines=wrap(s,511,14,bold);ensure(lines.length*19+30);y-=7;for(const line of lines){text(line,42,y,14,bold,BLUE);y-=19;}y-=5;};
 const table=(headers,rows,widths)=>{const header=()=>{const cells=headers.map((h,i)=>wrap(h,widths[i]-18,9,bold));const h=Math.max(...cells.map(c=>c.length))*12+17;page.drawRectangle({x:42,y:y-h,width:511,height:h,color:BLUE});let x=51;cells.forEach((lines,i)=>{lines.forEach((line,j)=>text(line,x,y-17-j*12,9,bold,rgb(1,1,1)));x+=widths[i];});y-=h;};header();for(let r=0;r<rows.length;r++){const cells=rows[r].map((s,i)=>wrap(s,widths[i]-18,9));const height=Math.max(...cells.map(c=>c.length))*12+13;if(y-height<75){newPage('Continuación');header();}if(r%2===0)page.drawRectangle({x:42,y:y-height,width:511,height,color:PALE});let x=51;cells.forEach((lines,i)=>{lines.forEach((line,j)=>text(line,x,y-16-j*12,9,i===0?regular:bold));x+=widths[i];});y-=height;}y-=16;};
 const link=(label,url)=>{try{const u=new URL(url);if(u.protocol!=='https:'||!['www.instagram.com','instagram.com','www.facebook.com','facebook.com'].includes(u.hostname))return;}catch{return;}ensure(28);text(label,42,y,10,bold,BLUE);const annotation=pdf.context.obj({Type:'Annot',Subtype:'Link',Rect:[42,y-3,553,y+12],Border:[0,0,0],A:{Type:'Action',S:'URI',URI:PDFString.of(url)}});page.node.addAnnot(pdf.context.register(annotation));y-=24;};
 const current=data.map(d=>metric(d.current));
 newPage(social?'Crecimiento de redes':'Resultados de ventas',`${window.since} al ${window.until} | MXN`);
 paragraph(meta.synthetic?'Muestra de pruebas con datos inventados, sin relación con resultados reales de Meta.':meta.sample?'Muestra con el export de Meta del 1 al 28 de septiembre de 2026. No es una consulta nueva ni un reporte de los últimos tres días.':`Comparación con ${window.previousSince} al ${window.previousUntil}. Se comparan periodos de la misma duración.`,10,GRAY);
 const measured=current.filter(m=>m?.spend!=null);
 const totalSpend=measured.length?measured.reduce((s,m)=>s+m.spend,0):null;
 const totalPurchases=measured.length&&measured.every(m=>m.purchases!=null)?measured.reduce((s,m)=>s+m.purchases,0):null;
 paragraph(social?`Inversión en tráfico al perfil: ${money(totalSpend)}.`:`Inversión: ${money(totalSpend)}. Compras registradas: ${number(totalPurchases)}.`,13,BLUE);
 if(measured.length<data.length)paragraph(`${data.length-measured.length} campañas sin métricas de inversión en el periodo; no se cuentan como cero.`,9,GRAY);
 paragraph(social?'Rendimiento pagado: visitas al perfil, seguimientos e interacción. No equivale al crecimiento total de Instagram.':'Prioridad: compras, costo por compra y recorrido desde la visita hasta el pago.');
 if(social){
  const ig=meta.instagram;if(!ig)throw Error('Instagram data required for social PDF');
  heading('@'+ig.profile.username);
  paragraph(`Seguidores al momento de la consulta: ${number(ig.profile.followers_count)}. Crecimiento neto en el periodo: ${number(ig.current.net)}.`,12,BLUE);
  paragraph('Actividad total del perfil, que puede incluir contenido promocionado. No sumar estas cifras a las de campañas ni atribuir todo el crecimiento a publicidad.',9,GRAY);
  table(['Indicador','Periodo anterior','Periodo actual'],profileKpis.map(([label,key])=>[label,number(ig.previous[key]),number(ig.current[key])]),[237,137,137]);
  paragraph('Bajas: cuentas que dejaron de seguir o abandonaron Instagram. Periodos delimitados a medianoche de Ciudad de México. Seguidores totales y métricas por post: consulta del '+ig.collectedAt.slice(0,10)+'.',9,GRAY);
  newPage('Contenido reciente',`${window.since} al ${window.until}`);
  paragraph('Publicaciones creadas durante el periodo, ordenadas por visualizaciones acumuladas hasta la consulta. No son visualizaciones ganadas exclusivamente esta semana.',10,GRAY);
  if(!ig.posts.length)paragraph('No se publicaron posts nuevos durante este periodo. No se recuperan publicaciones antiguas para llenar el reporte.');
  for(const [i,p] of ig.posts.slice(0,8).entries()){
   ensure(150);heading(`${i+1}. ${(p.caption||'Publicación').split('\n')[0].slice(0,120)}`);
   paragraph(`${p.media_type} | Publicado: ${p.timestamp.slice(0,10)}. Vistas: ${number(p.metrics.views)}. Alcance: ${number(p.metrics.reach)}. Me gusta: ${number(p.metrics.likes)}. Comentarios: ${number(p.metrics.comments)}. Compartidos: ${number(p.metrics.shares)}. Guardados: ${number(p.metrics.saved)}.`,10);
   link('Abrir publicación en Instagram',p.permalink);
  }
  if(ig.posts.length>8)paragraph(`Se muestran las 8 publicaciones con más visualizaciones de ${ig.posts.length} publicadas en el periodo.`,9,GRAY);
  heading('Contenido que conviene probar');for(const suggestion of contentSuggestions(ig))paragraph(suggestion);
  for(const warning of ig.warnings||[])paragraph(warning,9,GRAY);
  newPage('Campañas de tráfico al perfil',`${window.since} al ${window.until} | MXN`);
 }
 for(let offset=0;offset<data.length;offset+=2){
  if(offset)newPage('KPI por campaña',`${window.since} al ${window.until} | MXN`);
  heading('KPI por campaña');const pair=data.slice(offset,offset+2);
  table(['Indicador',...pair.map(d=>d.name)],selectedKpis(pair).map(([label,key,format])=>[label,...pair.map(d=>format(metric(d.current)?.[key]??null))]),pair.length===2?[237,137,137]:[274,237]);
 }
 paragraph(social?'N/D: Meta no devolvió esa métrica. Las visitas al perfil son distintas de los clics al enlace.':'Clic no equivale a visita. N/D: dato no disponible o costo sin resultados para calcularlo.',9,GRAY);
 for(const item of data){
  newPage(item.name,`Artes dentro de la misma campaña | ${window.since} al ${window.until}`);
  const assets=social?(item.assets||[]).map(a=>({label:a.ad_name||'Anuncio',metrics:socialMetrics(a)})):assetRows(item);
  if(assets.length){
   // Paginate wide comparisons in pairs so every column stays legible.
   for(let offset=0;offset<assets.length;offset+=2){
    const pair=assets.slice(offset,offset+2);
    if(offset)newPage(item.name+' / más artes');
    heading('Rendimiento de los artes');
    table(['Indicador',...pair.map(a=>a.label)],selectedKpis([item]).filter(([,key])=>key!=='reach'&&key!=='cpa').map(([label,key,format])=>[label,...pair.map(a=>format(a.metrics?.[key]??null))]),pair.length===2?[237,137,137]:[274,237]);
   }
  }else paragraph('Meta no devolvió un desglose por arte para esta campaña.');
  if(item.assets?.some(a=>a.comparisonLevel==='ad'))paragraph('Las filas sin desglose representan anuncios completos; no permiten separar los medios de un anuncio dinámico.',9,GRAY);
  const linked=new Set();for(const a of item.assets||[])if(a.postUrl&&!linked.has(a.postUrl)){link('Ver publicación del anuncio: '+(a.ad_name||'Anuncio'),a.postUrl);linked.add(a.postUrl);}
  heading('Qué nos dice la comparación');for(const note of (social?socialAssetNotes(item):assetNotes(item)))paragraph(note);
 }
 for(const item of data){
  newPage('Decisiones / '+item.name,`Comparación: ${window.previousSince} al ${window.previousUntil}`);
  heading('Qué cambió');for(const note of (social?socialNotes(item):campaignNotes(item)))paragraph(note);
  heading('Qué hacer ahora');
  for(const [i,step] of (social?socialSteps(item):nextSteps(item)).entries()){
   const height=wrap(step.action,511,12,bold).length*17+wrap(step.reason,511,10).length*15+wrap('Cuándo: '+step.review,511,10).length*15+45;ensure(height);
   heading(`${i+1}. ${step.action}`);paragraph(step.reason);paragraph('Cuándo: '+step.review,10,BLUE);
  }
 }
 if(warnings.length){heading('Notas de la fuente');for(const warning of warnings)paragraph(warning,9,GRAY);}
 paragraph('Fuente: Meta Ads Manager / Marketing API e Instagram Insights. Los resultados pueden actualizarse por atribución. Los ceros representan acciones no registradas en la fuente; no demuestran ausencia real. Los eventos por arte pueden no sumar los totales. No se han modificado campañas ni presupuestos.',9,GRAY);
 return Buffer.from(await pdf.save());
}
