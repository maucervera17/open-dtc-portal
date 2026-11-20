import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createTokens } from './tokens.js';
import { storage } from '../schedule.js';
import { dataRoutes } from '../dash/routes.js';
import { params, route } from '../dash/validate.js';
import { today } from '../dash/range.js';
import { key } from '../dash/store.js';
const date=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const range={from:date.describe('Inicio YYYY-MM-DD'),to:date.describe('Fin YYYY-MM-DD')};
export const TOOLS = [
 ['get_sales','sales','Ventas, gasto, ROAS y conversiones del período.',range],
 ['list_campaigns','campaigns','Rendimiento de campañas sin modificarlas.',range],
 ['list_creatives','creatives','Creativos publicitarios y métricas del período.',range],
 ['get_pixel','pixel','Estado y señales del píxel.',{}],
 ['get_social','social','Métricas sociales de los últimos días.',{days:z.number().int().min(7).max(90).default(30)}],
 ['get_alerts','alerts','Alertas del portal para la fecha indicada.',{date:date.optional()}],
 ['get_status','status','Estado de las conexiones del portal.',{}],
 ['get_journal','journal','Diario de optimización ya generado.',{}],
 ['get_memory','memory','Notas compartidas de marca aprobadas.',{}],
 ['list_inspiration','inspiration','Biblioteca de referencias y marcas guardadas.',{}],
 ['get_inspiration_analysis','inspiration/analysis','Análisis guardado de una referencia; no genera análisis nuevos.',{id:z.string().min(1).max(200)}],
];
export function createPortalMcpHandler({env=process.env,store,now=Date.now,routes=dataRoutes,fetch:fetcher=fetch}={}) {
 return async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');
  const error=(status,message)=>res.status(status).json({error:message});
  if(env.DASH_ENABLED!=='true')return error(404,'disabled');
  if(req.method!=='POST') {res.setHeader('Allow','POST');return error(405,'method_not_allowed');}
  if(req.headers.origin && req.headers.origin!==new URL(env.DASH_BASE_URL).origin)return error(403,'forbidden');
  let server,transport;
  try {
    const db=store||storage(env),tokens=createTokens({env,store:db,now});
    const auth=/^Bearer (.+)$/.exec(req.headers.authorization||'');
    const actor=auth?await tokens.check(auth[1]):null;
    if(!actor)return error(401,'unauthorized');
    const bucket=key('mcp','rate',actor.tokenId,Math.floor(now()/60000));
    const count=Number(await db(['INCR',bucket]));
    if(count===1)await db(['EXPIRE',bucket,120]);
    if(count>120){res.setHeader('Retry-After','60');return error(429,'rate_limited');}
    if(Number(req.headers['content-length']||0)>4400000)return error(413,'body_too_large');
    server=new Server({name:'dtc-portal',version:'2.0.0'},{capabilities:{tools:{}}});
    const portalTools=TOOLS.map(([name,,description,schema])=>({name,description,inputSchema:z.toJSONSchema(z.object(schema).strict()),annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true}}));
    server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:portalTools}));
    server.setRequestHandler(CallToolRequestSchema,async request=>{
      if(!await tokens.check(auth[1]))return {isError:true,content:[{type:'text',text:'Acceso revocado o vencido.'}]};
      const name=request.params.name;
      const tool=TOOLS.find(t=>t[0]===name);
      if(!tool)return {isError:true,content:[{type:'text',text:'Herramienta desconocida.'}]};
      const [,path,,schema]=tool;
      try{
        const input=z.object(schema).strict().parse(request.params.arguments||{});
        const D=today(now()),raw=Object.fromEntries(Object.entries(input).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)]));
        const validated=params(route(path),raw,D);
        const out=await routes[path]({req,env,store:db,now,fetch:fetcher,D,email:actor.email,params:validated});
        if(out.status!==200)return {isError:true,content:[{type:'text',text:`No se pudo consultar ${path} (${out.status}).`}]};
        const text=JSON.stringify(out.body);
        if(text.length>350000)return {isError:true,content:[{type:'text',text:'Resultado demasiado grande. Reduce el período.'}]};
        return {content:[{type:'text',text}]};
      }catch{return {isError:true,content:[{type:'text',text:'Consulta inválida o servicio temporalmente no disponible.'}]};}
    });
    transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  } catch {if(!res.headersSent)error(503,'mcp_unavailable');}
  finally {if(transport)await transport.close();if(server)await server.close();}
 };
}
