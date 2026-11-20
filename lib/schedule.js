import {shift,localDate} from './dates.js';
import {manualWindow} from './model.js';
export function scheduledWindow(firstDelivery,lastDelivery,today=localDate(),days=3) {
 // Validate configuration even before the first run. Each boundary represents three complete days.
 manualWindow(shift(firstDelivery,-days),shift(firstDelivery,-1));
 if(!/^\d{4}-\d{2}-\d{2}$/.test(firstDelivery)||shift(firstDelivery,0)!==firstDelivery)throw Error('Invalid first delivery');
 if(lastDelivery && (!/^\d{4}-\d{2}-\d{2}$/.test(lastDelivery)||shift(lastDelivery,0)!==lastDelivery))throw Error('Invalid cursor');
 if(lastDelivery && (lastDelivery<firstDelivery || (Date.parse(lastDelivery)-Date.parse(firstDelivery))%(days*86400000)!==0))throw Error('Cursor outside cadence');
 let delivery=lastDelivery?shift(lastDelivery,days):firstDelivery;
 if(delivery>today)return null;
 // Skip stale backlog: report the most recent complete scheduled interval only.
 delivery=shift(delivery,Math.floor((Date.parse(today)-Date.parse(delivery))/(days*86400000))*days);
 return {delivery,window:manualWindow(shift(delivery,-days),shift(delivery,-1))};
}
export function storage(env,fetcher=fetch){
 return async command=>{
  const response=await fetcher(env.UPSTASH_REDIS_REST_URL,{method:'POST',headers:{Authorization:`Bearer ${env.UPSTASH_REDIS_REST_TOKEN}`,'Content-Type':'application/json'},body:JSON.stringify(command),signal:AbortSignal.timeout(8000)});
  if(!response.ok)throw Error('Storage unavailable');
  const body=await response.json();if(body.error)throw Error('Storage command failed');return body.result;
 };
}
