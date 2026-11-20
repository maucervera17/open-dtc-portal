// Only library-backed IDs can become cards. Model-supplied media URLs are never rendered.
export function adCatalog(ads, question='') {
 const q=question.toLowerCase();
 const matched=ads.filter(a=>String(a.page_name||'').toLowerCase().split(/\W+/).filter(w=>w.length>3).some(w=>q.includes(w)));
 const rows=matched.length?matched:ads;
 const counts=new Map();for(const a of ads){const k=a.brand_id+':'+a.body;counts.set(k,(counts.get(k)||0)+1);}
 const age=a=>Math.max(0,Math.floor((Date.parse(a.observed_at)-Date.parse(a.started_at))/86400000))||0;
 const ranked=rows.map(a=>({id:a.id,brand:a.page_name,copy:String(a.body||a.title||'').slice(0,800),active:a.is_active===true,days:age(a),repetitions:counts.get(a.brand_id+':'+a.body)||1,started_at:a.started_at,observed_at:a.observed_at,video:!!a.video_url}))
 .sort((a,b)=>Number(b.active)-Number(a.active)||b.repetitions-a.repetitions||b.days-a.days);
 const seen=new Map();return ranked.filter(a=>{const n=seen.get(a.brand)||0;seen.set(a.brand,n+1);return n<8;}).slice(0,48);
}
export function extractAdReferences(answer,catalog=[]){
 const ids=[];const text=String(answer).replace(/\[\[ad:([^\]]*)\]\]/g,(_,id)=>{if(catalog.some(a=>a.id===id)&&!ids.includes(id))ids.push(id);return '';}).trim();
 return {answer:text,ads:ids.slice(0,3).map(id=>catalog.find(a=>a.id===id))};
}
export function storedCards(cards){
 return (Array.isArray(cards)?cards:[]).filter(a=>a&&/^[\w-]{1,80}$/.test(a.id)).slice(0,3).map(a=>({id:a.id,brand:String(a.brand||'').slice(0,120),copy:String(a.copy||'').slice(0,800),video:a.video===true}));
}
