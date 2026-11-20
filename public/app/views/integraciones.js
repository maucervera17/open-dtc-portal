import {h,replace} from '/app/dom.js';
import {icon} from '/app/icons.js';
export default {route:'integraciones',label:'Conectores',render({api}) {
 const root=h('div',{class:'connections-page'}),message=h('p',{class:'connections-message',role:'status','aria-live':'polite'}),list=h('div',{class:'connection-list'}),secret=h('div',{});
 const count=h('span',{class:'connection-count'},'Cargando…');
 const name=h('input',{class:'input',placeholder:'Ej. Mi Mac · Codex y Claude',maxlength:'60',required:true,id:'connection-name'});
 const button=h('button',{class:'btn connections-primary',type:'submit'},icon('plus'),'Crear clave personal');
 const form=h('form',{class:'connection-form'},h('label',{for:'connection-name'},'Nombre de la conexión',name),h('p',{class:'connection-help'},'Las claves son de solo lectura: consultan el portal y no modifican campañas.'),button);
 const createPanel=h('details',{class:'connection-create'},h('summary',{},icon('plus'),'Nueva conexión',h('span',{},'Crear una clave para otro equipo o asistente')),form,secret);
 async function copy(text,success){try{await navigator.clipboard.writeText(text);message.textContent=success;}catch{message.textContent='No se pudo copiar. Selecciona el texto y cópialo manualmente.';}}
 function command(text){return h('div',{class:'connection-command'},h('code',{},text),h('button',{class:'btn btn-ghost',type:'button','aria-label':`Copiar ${text}`,onclick:()=>copy(text,'Comando copiado.')},'Copiar'));}
 async function refresh(){try{const r=await api.get('mcp/tokens');if(!r.ok)throw Error();count.textContent=`${r.data.tokens.length} ${r.data.tokens.length===1?'clave activa':'claves activas'}`;
 replace(list,...(r.data.tokens.length?r.data.tokens.map(t=>{
 const revoke=h('button',{class:'btn btn-ghost connection-revoke',type:'button'},'Revocar');
 let confirm=false;revoke.addEventListener('click',async()=>{if(!confirm){confirm=true;revoke.textContent='Confirmar revocación';return;}revoke.disabled=true;try{const r=await api.post('mcp/revoke',{id:t.id});message.textContent=r.ok?'Clave revocada. Ese acceso ya no funciona.':'No se pudo revocar la clave.';await refresh();}catch{revoke.disabled=false;message.textContent='No se pudo revocar. Intenta de nuevo.';}});
 return h('article',{class:'connection-key'},h('div',{class:'connection-key-icon'},icon('check-circle',{size:22})),h('div',{class:'connection-key-info'},h('strong',{},t.name),h('p',{},'Consulta del portal y biblioteca'),h('small',{},`Vence el ${new Date(t.expiresAt).toLocaleDateString('es-MX',{day:'numeric',month:'short',year:'numeric'})}`)),h('span',{class:'connection-badge'},'Clave activa'),revoke);
 }):[h('div',{class:'connection-empty'},icon('users',{size:26}),h('strong',{},'Tu primera conexión empieza aquí'),h('p',{},'Crea una clave y configura el asistente con el que quieres trabajar.'))]));
 }catch{count.textContent='Sin actualizar';message.textContent='No se pudieron cargar las claves. Pulsa actualizar para reintentar.';}}
 form.addEventListener('submit',async e=>{e.preventDefault();button.disabled=true;replace(secret);message.textContent='Creando clave…';try{const r=await api.post('mcp/create',{name:name.value,scope:'portal:read'});if(!r.ok){message.textContent=r.data?.error==='token_limit'?'Revoca una clave antes de crear otra (máximo 10).':'No se pudo crear la clave. Revisa el nombre.';return;}
 const value=h('input',{class:'input',type:'password',value:r.data.token,readonly:true,'aria-label':'Clave personal MCP'});
 const copyKey=h('button',{class:'btn connections-primary',type:'button',onclick:()=>copy(value.value,'Clave copiada.')},'Copiar clave');
 const hide=h('button',{class:'btn btn-ghost',type:'button',onclick:()=>{value.value='';replace(secret);createPanel.open=false;}},'Ya la guardé');
 replace(secret,h('div',{class:'connection-secret'},h('h3',{},'Guarda tu clave'),h('p',{},'Solo se muestra una vez. Guárdala en tu equipo; no la pegues en un chat.'),value,h('div',{class:'connection-actions'},copyKey,hide)));name.value='';message.textContent='Clave creada por 90 días. El siguiente paso es configurar tu asistente.';await refresh();
 }catch{message.textContent='No se pudo crear la clave.';}finally{button.disabled=false;}});
 const guide=h('details',{class:'connection-guide'},h('summary',{},'Configurar o comprobar en mi Mac',h('span',{},'Guía de conexión')),
 h('div',{class:'connection-steps'},
 h('section',{},h('b',{},'01'),h('div',{},h('h3',{},'Guarda la clave en tu equipo'),h('p',{},'Desde la carpeta local del portal, ejecuta este comando. Introduce la clave solo cuando la terminal la solicite.'),command('npm run mcp:configure'))),
 h('section',{},h('b',{},'02'),h('div',{},h('h3',{},'Registra Codex y Claude Code'),h('p',{},'El instalador configura ambos asistentes en este Mac. Si ya están registrados, conserva la conexión.'),command('npm run mcp:install'))),
 h('section',{},h('b',{},'03'),h('div',{},h('h3',{},'Comprueba la conexión'),h('p',{},'Esta prueba consulta el estado del portal. No modifica nada.'),command('npm run mcp:check'),h('p',{},'Si una sesión abierta no muestra dtc-portal, inicia una nueva sesión del asistente para cargar la configuración.')))));
 function assistant(title,initial,description,prompt){return h('article',{class:'connection-assistant'},h('div',{class:'connection-assistant-top'},h('span',{class:'connection-app-icon'},initial),h('div',{},h('h3',{},title),h('span',{},'Conexión MCP · dtc-portal'))),h('p',{},description),h('div',{class:'connection-prompt'},h('small',{},'PRUEBA CON ESTE MENSAJE'),h('p',{},prompt)),h('button',{class:'btn',type:'button',onclick:()=>copy(prompt,'Mensaje copiado. Pégalo en tu asistente.')},'Copiar mensaje de prueba'));}
 const endpoint=`${location.origin}/api/mcp`;
 root.append(h('header',{class:'connections-heading'},h('div',{},h('span',{class:'connection-eyebrow'},'TU ESPACIO CONECTADO'),h('h1',{},'Tu portal, desde tu asistente'),h('p',{},'Consulta tus campañas, creativos y biblioteca sin salir de Codex o Claude Code. Una conexión para todo el portal.')),h('span',{class:'connection-service'},icon('image',{size:18}),'Portal MCP')),
 h('div',{class:'connection-assistants'},assistant('Codex','C','Consulta resultados y explora tu biblioteca de referencias.','Usa dtc-portal para mostrar el estado del portal y mis campañas activas.'),assistant('Claude Code','✳','Trabaja con las mismas campañas, referencias y permisos del equipo.','Usa dtc-portal para consultar las alertas y las referencias guardadas del portal.')),
 h('section',{class:'connection-access'},h('div',{class:'connection-section-heading'},h('div',{},h('h2',{},'Tus accesos'),h('p',{},'Una clave activa autoriza el acceso. El asistente debe tenerla configurada para conectarse.')),h('div',{class:'connection-actions'},count,h('button',{class:'btn btn-ghost',type:'button',onclick:refresh,'aria-label':'Actualizar accesos'},icon('refresh-cw',{size:16})))),list,createPanel),message,guide,
 h('footer',{class:'connection-footer'},h('p',{},'Cada persona usa su propia clave. Puedes revocarla aquí en cualquier momento.'),h('details',{},h('summary',{},'Detalles técnicos'),h('p',{},'Endpoint remoto'),command(endpoint),h('p',{},'Transporte HTTP con clave Bearer. La instalación local usa un puente stdio. Esta página no puede comprobar qué aplicaciones están abiertas en tu Mac.'))));
 refresh();return root;
}};
