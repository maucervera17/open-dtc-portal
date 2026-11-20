// Shared extractor in the extension isolated world. No requests or credentials.
(() => {
 function scan(){
 const pattern=/(?:Identificador de la biblioteca|Library ID|ID de la biblioteca)\s*:\s*(\d{1,25})/i;
 const nodes=[...document.querySelectorAll('div,span')].filter(e=>!e.closest('[data-adsaver-save]')&&pattern.test(e.textContent||'')).sort((a,b)=>a.innerText.length-b.innerText.length),found=new Map();
 const safeMedia=v=>{try{const u=new URL(v);return u.protocol==='https:'&&/\.(fbcdn\.net|cdninstagram\.com)$/.test(u.hostname)?u.href:null;}catch{return null;}};
 const month={ene:0,jan:0,feb:1,mar:2,abr:3,apr:3,may:4,jun:5,jul:6,ago:7,aug:7,sep:8,oct:9,nov:10,dic:11,dec:11};
 function dates(t){return [...t.matchAll(/(\d{1,2})\s+(?:de\s+)?([a-záé]+)\.?\s+(?:de\s+)?(20\d{2})/gi)].map(m=>month[m[2].toLowerCase().slice(0,3)]===undefined?null:new Date(Date.UTC(+m[3],month[m[2].toLowerCase().slice(0,3)],+m[1])).toISOString()).filter(Boolean);}
 for(const node of nodes){const id=node.innerText.match(pattern)?.[1];if(!id||found.has(id))continue;let card=null;
 for(let el=node,i=0;el&&i<9;el=el.parentElement,i++){const ids=[...el.innerText.matchAll(/(?:Identificador de la biblioteca|Library ID|ID de la biblioteca)\s*:\s*(\d+)/gi)].map(m=>m[1]);if(new Set(ids).size>1)break;if(el.querySelector('a[href*="facebook.com"]')&&el.querySelector('img,video'))card=el;}
 if(!card)continue;const links=[...card.querySelectorAll('a[href]')];const brand=links.find(a=>{try{const u=new URL(a.href);return /(^|\.)facebook.com$/.test(u.hostname)&&!u.pathname.includes('/ads/')&&!u.pathname.includes('/l.php')&&a.innerText.trim();}catch{return false;}});if(!brand)continue;
 const text=card.innerText,ds=dates(text),inactive=/(?:^|\n)(?:Inactivo|Inactive)(?:\n|$)/i.test(text),active=/(?:^|\n)(?:Activo|Active)(?:\n|$)/i.test(text);
 const video=card.querySelector('video');const images=[...card.querySelectorAll('img')].filter(i=>i.width>=100&&safeMedia(i.currentSrc||i.src)).sort((a,b)=>b.width*b.height-a.width*a.height);
 const copy=[...card.querySelectorAll('[role="button"]')].map(e=>e.innerText.trim()).filter(t=>t.length>40&&!/Identificador de la biblioteca|Library ID/i.test(t)).sort((a,b)=>b.length-a.length)[0]||'';
 let landing=null;for(const a of links){try{const u=new URL(a.href);if(u.pathname==='/l.php'&&u.searchParams.has('u')){const dest=new URL(u.searchParams.get('u'));if(dest.protocol==='https:')landing=dest.href;}}catch{}}
 let page_id=null;try{const u=new URL(brand.href);const candidate=u.searchParams.get('id')||u.pathname.match(/^\/(\d+)\/?$/)?.[1];if(/^\d+$/.test(candidate||''))page_id=candidate;}catch{}
 // A page-scoped feed identifies this advertiser; keyword search does not.
 const url=new URL(location.href);if(!page_id&&url.searchParams.get('search_type')==='page')page_id=url.searchParams.get('view_all_page_id');
 found.set(id,{card,ad:{id,page_name:brand.innerText.trim().slice(0,120),page_id,page_url:brand.href,body:copy.slice(0,8000),image_url:images[0]?.currentSrc||images[0]?.src||safeMedia(video?.poster),video_url:safeMedia(video?.currentSrc||video?.src),landing_url:landing,is_active:inactive?false:active?true:null,started_at:ds[0]||null,ended_at:inactive?ds[1]||null:null}});
 }
 return [...found.values()];
 }
 globalThis.AdSaverCapture={scan};
})();
