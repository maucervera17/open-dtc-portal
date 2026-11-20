import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const codex=spawnSync('codex',['mcp','get','dtc-portal','--json'],{encoding:'utf8'});
if(codex.status!==0)throw Error('El portal no está registrado en Codex. Ejecuta npm run mcp:install.');
const codexConfig=JSON.parse(codex.stdout);
if(!codexConfig.enabled||codexConfig.transport.type!=='stdio')throw Error('Revisa la conexión de Codex.');
const claudeConfig=JSON.parse(await readFile(join(homedir(),'.claude.json'),'utf8')).mcpServers?.['dtc-portal'];
if(!claudeConfig||claudeConfig.type!=='stdio')throw Error('El portal no está registrado en Claude Code. Ejecuta npm run mcp:install.');
for(const [name,config] of [['Codex',codexConfig.transport],['Claude Code',claudeConfig]]){
 const client=new Client({name:'portal-connection-check',version:'1.1.0'});
 try{
  await client.connect(new StdioClientTransport({command:config.command,args:config.args||[],cwd:config.cwd||undefined,env:{...process.env,...config.env},stderr:'pipe'}));
  const {tools}=await client.listTools();
  for(const required of ['get_status','list_campaigns','list_inspiration'])if(!tools.some(t=>t.name===required))throw Error('Falta herramienta: '+required);
  const portal=await client.callTool({name:'get_status',arguments:{}});
  if(portal.isError)throw Error('Falló la consulta del portal');
  console.log(`${name}: conexión real verificada desde su configuración instalada · ${tools.length} herramientas · el portal responde.`);
 }finally{await client.close();}
}
