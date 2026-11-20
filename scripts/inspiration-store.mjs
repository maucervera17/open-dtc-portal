// Local-only Redis command adapter for tests/preview. Not included in deployments.
export function memoryStore(seed={}) {
 const values=new Map(Object.entries(seed));const expiry=new Map();
 const store=async([command,key,...args])=>{
  if(expiry.has(key)&&expiry.get(key)<Date.now()){values.delete(key);expiry.delete(key);}
  const v=values.get(key);
  switch(command){
   case 'GET':return v??null;
   case 'SET':if(args.includes('NX')&&v!==undefined)return null;values.set(key,args[0]);expiry.delete(key);if(args.includes('EX'))expiry.set(key,Date.now()+Number(args[args.indexOf('EX')+1])*1000);return 'OK';
   case 'DEL':return Number(values.delete(key));
   case 'INCR':values.set(key,String(Number(v||0)+1));return Number(values.get(key));
   case 'MGET':return [key,...args].map(k=>values.get(k)??null);
   case 'HSET':{const map=v||{};map[args[0]]=args[1];values.set(key,map);return 1;}
   case 'HGETALL':return Object.entries(v||{}).flat();
   case 'ZADD':{const z=v||{};z[args[1]]=Number(args[0]);values.set(key,z);return 1;}
   case 'ZCARD':return Object.keys(v||{}).length;
   case 'ZREVRANGE':return Object.entries(v||{}).sort((a,b)=>b[1]-a[1]).map(([k])=>k).slice(Number(args[0]),Number(args[1])+1);
   case 'SADD':values.set(key,[...new Set([...(v||[]),...args])]);return 1;
   case 'EXPIRE':expiry.set(key,Date.now()+Number(args[0])*1000);return 1;
   case 'EVAL':{const script=key,actualKey=args[1],argument=args[2],current=values.get(actualKey);
    if(script.includes('INCR')){const n=Number(current||0);if(n>=Number(argument))return -1;values.set(actualKey,String(n+1));return n+1;}
    if(current===argument){values.delete(actualKey);return 1;}return 0;
   }
   default:throw Error('Unsupported local command '+command);
  }
 };
 store.dump=()=>Object.fromEntries(values);return store;
}
