import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const bridge=fileURLToPath(new URL('./portal-mcp-bridge.mjs',import.meta.url));
for(const [cli,args] of [
 ['codex',['mcp','add','dtc-portal','--',process.execPath,bridge]],
 ['claude',['mcp','add','--scope','user','--transport','stdio','dtc-portal','--',process.execPath,bridge]],
]) {
 const existing=spawnSync(cli,['mcp','get','dtc-portal'],{encoding:'utf8'});
 if(existing.status===0 && existing.stdout.includes(bridge)){console.log(`${cli}: conexión del portal ya registrada.`);continue;}
 const result=spawnSync(cli,args,{stdio:'inherit'});
 if(result.error||result.status!==0){console.error(`No se pudo registrar en ${cli}.`);process.exitCode=1;}
}
