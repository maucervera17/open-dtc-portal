(() => {
 if(globalThis.AdSaverInline){globalThis.AdSaverInline.refresh();return;}
 let timer=null;
 function refresh(){
  clearTimeout(timer);timer=null;
  if(!location.pathname.startsWith('/ads/library'))return;
  const entries=globalThis.AdSaverCapture?.scan()||[];
  for(const {card,ad} of entries){
   // React can reuse a card for a different result; update its link every scan.
   let bar=card.querySelector('[data-adsaver-save]');
   if(!bar){
    bar=document.createElement('div');bar.setAttribute('data-adsaver-save','');bar.className='adsaver-save-bar';
    const link=document.createElement('a');link.className='adsaver-save-ad';link.target='_blank';link.rel='noopener noreferrer';
    const star=document.createElement('span');star.textContent='☆';star.setAttribute('aria-hidden','true');
    const label=document.createElement('span');label.textContent='Guardar en el portal';link.append(star,label);
    link.addEventListener('pointerdown',()=>refresh());
    link.addEventListener('focus',()=>refresh());
    link.addEventListener('click',event=>event.stopPropagation());
    bar.append(link);card.prepend(bar);
   }
   const link=bar.querySelector('a');
   link.href=String(globalThis.AD_SAVER_PORTAL_URL||'').replace(/\/+$/,'')+'/app/#/inspiracion?capture='+encodeURIComponent(JSON.stringify(ad));
   link.setAttribute('aria-label',`Guardar anuncio ${ad.id} de ${ad.page_name} en el portal`);
   link.title='Abre el dashboard para confirmar y elegir un board';
  }
 }
 const own=node=>node.nodeType===1&&(node.matches?.('[data-adsaver-save]')||node.closest?.('[data-adsaver-save]'));
 const observer=new MutationObserver(records=>{
  const relevant=records.some(r=>!own(r.target)&&(r.type==='characterData'||r.type==='attributes'||[...r.addedNodes,...r.removedNodes].some(node=>!own(node))));
  if(relevant&&!timer)timer=setTimeout(refresh,800);
 });
 observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['src','poster']});
 globalThis.AdSaverInline={refresh};
 refresh();
})();
