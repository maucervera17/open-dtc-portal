import seed from './seed.json' with {type:'json'};
// Atomic, one-time import of public ads already fetched during setup. Does not spend credits.
const SCRIPT = `
if redis.call('EXISTS',KEYS[1])==1 then return 0 end
local data=cjson.decode(ARGV[2])
for _,a in ipairs(data.ads) do
 if redis.call('SET',ARGV[1]..'ad:'..a.id,cjson.encode(a),'NX') then
  redis.call('ZADD',ARGV[1]..'ads',a.seed_score,a.id)
 end
end
for _,b in ipairs(data.brands) do redis.call('HSETNX',ARGV[1]..'brands',b.id,cjson.encode(b)) end
redis.call('SET',ARGV[1]..'provider',cjson.encode({remaining=data.remaining}),'NX')
redis.call('SET',KEYS[1],'done')
return #data.ads
`;
export async function seedLibrary(store) {
  const prefix='dtc:inspiration:',key=prefix+'seed:v1';
  if(await store(['GET',key]))return;
  const data={...seed,ads:seed.ads.map(a=>({...a,seed_score:Date.parse(a.started_at||a.observed_at)}))};
  await store(['EVAL',SCRIPT,1,key,prefix,JSON.stringify(data)]);
}
