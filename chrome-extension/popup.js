const status=document.querySelector('#status');
(async()=>{try{
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});const u=new URL(tab.url);
 if(!/(^|\.)facebook.com$/.test(u.hostname)||!u.pathname.startsWith('/ads/library'))throw new Error('Abre Meta Ad Library para guardar anuncios.');
 await chrome.scripting.insertCSS({target:{tabId:tab.id},files:['inline.css']});
 await chrome.scripting.executeScript({target:{tabId:tab.id},files:['config.js','extract.js','inline.js']});
 status.textContent='Los botones «Guardar en el portal» aparecen dentro de cada anuncio. También se añaden al cargar más resultados.';
}catch(e){status.textContent=e.message||'Recarga Meta Ad Library e inténtalo nuevamente.';}})();
