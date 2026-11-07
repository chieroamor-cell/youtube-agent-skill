// InfamousHub YouTube OAuth staging. No video edits, upload, deletion or publication.
const REDIRECT='https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/oauth/callback';
const SCOPE='https://www.googleapis.com/auth/youtube.force-ssl';
const encoder=new TextEncoder();
const headers={
 'cache-control':'no-store',
 'referrer-policy':'no-referrer',
 'x-frame-options':'DENY',
 'x-content-type-options':'nosniff',
 'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"
};
const page=s=>'<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Conexión YouTube · InfamousHub</title><style>body{max-width:640px;margin:3em auto;padding:1em;font:16px system-ui;line-height:1.5}input{padding:12px;margin:10px 0;width:90%}button{padding:12px}</style><h1>InfamousHub · YouTube</h1>'+s+'</html>';
const escapeHtml=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const html=(s,status=200,extras={})=>new Response(page(s),{status,headers:{...headers,'content-type':'text/html; charset=utf-8',...extras}});
const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{...headers,'content-type':'application/json; charset=utf-8'}});
const b64=b=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const rnd=n=>b64(crypto.getRandomValues(new Uint8Array(n)));
const sha=async s=>b64(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s))));
const eq=async(a,b)=>{
 if(!a||!b||typeof a!=='string'||typeof b!=='string')return false;
 const ab=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(a)));
 const bb=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(b)));
 let diff=0;for(let i=0;i<ab.length;i++)diff|=ab[i]^bb[i];return diff===0;
};
const ready=e=>e.OAUTH_ENABLED==='YES'&&!!e.YTDB&&
 typeof e.GOOGLE_OAUTH_CLIENT_ID==='string'&&e.GOOGLE_OAUTH_CLIENT_ID.endsWith('.apps.googleusercontent.com')&&
 typeof e.GOOGLE_OAUTH_CLIENT_SECRET==='string'&&e.GOOGLE_OAUTH_CLIENT_SECRET.length>8&&
 typeof e.OAUTH_ADMIN_CODE==='string'&&e.OAUTH_ADMIN_CODE.length>=24&&
 typeof e.OAUTH_TOKEN_KEY_B64==='string';
const form=async r=>{
 if((r.headers.get('origin')||new URL(REDIRECT).origin)!==new URL(REDIRECT).origin)throw Error('Invalid origin');
 if(!(r.headers.get('content-type')||'').startsWith('application/x-www-form-urlencoded'))throw Error('Invalid content type');
 if(Number(r.headers.get('content-length')||0)>4096)throw Error('Payload too large');
 const t=await r.text();if(t.length>4096)throw Error('Payload too large');return new URLSearchParams(t);
};
const cookie=(r,name)=>{
 for(const c of (r.headers.get('cookie')||'').split(';')){
  const v=c.trim();if(v.startsWith(name+'='))return v.slice(name.length+1);
 }
 return '';
};
const crypt=async(e,channel,token)=>{
 const raw=Uint8Array.from(atob(e.OAUTH_TOKEN_KEY_B64),x=>x.charCodeAt(0));
 if(raw.length!==32)throw Error('Invalid encryption key');
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(channel)},key,encoder.encode(token));
 return {iv:b64(iv),ct:b64(new Uint8Array(ct))};
};
async function start(request,env){
 if(!ready(env))return html('<p>Faltan credenciales de Google. No hay conexión activa.</p>',503);
 const body=await form(request);
 if(!await eq(body.get('code'),env.OAUTH_ADMIN_CODE))return html('<p>Código incorrecto.</p>',403);
 const existing=await env.YTDB.prepare('SELECT status FROM oauth_channel WHERE singleton=1').first();
 if(existing?.status==='active')return html('<p>Ya existe un canal activo. No se sustituyó.</p>',409);
 const state=rnd(32),bind=rnd(32),verifier=rnd(48);
 const exp=Math.floor(Date.now()/1000)+600;
 await env.YTDB.prepare('INSERT INTO oauth_attempts(state_hash,browser_hash,code_verifier,expires_at) VALUES(?,?,?,?)')
  .bind(await sha(state),await sha(bind),verifier,exp).run();
 const q=new URLSearchParams({
  client_id:env.GOOGLE_OAUTH_CLIENT_ID,redirect_uri:REDIRECT,response_type:'code',scope:SCOPE,
  access_type:'offline',prompt:'consent select_account',state:state,
  code_challenge:await sha(verifier),code_challenge_method:'S256'
 });
 return new Response(null,{status:303,headers:{...headers,'location':'https://accounts.google.com/o/oauth2/v2/auth?'+q.toString(),
  'set-cookie':'ihyt_bind='+bind+'; Secure; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=600'}});
}
async function callback(request,env){
 if(!ready(env))return html('<p>Google OAuth todavía no está configurado.</p>',503);
 const params=new URL(request.url).searchParams;
 if(params.get('error'))return html('<p>Google no autorizó la conexión.</p>',403);
 const state=params.get('state'),code=params.get('code'),bind=cookie(request,'ihyt_bind');
 if(!state||state.length>128||!code||code.length>4096||!bind)return html('<p>Sesión incompleta.</p>',400);
 const attempt=await env.YTDB.prepare('DELETE FROM oauth_attempts WHERE state_hash=? AND browser_hash=? AND expires_at>=? RETURNING code_verifier')
  .bind(await sha(state),await sha(bind),Math.floor(Date.now()/1000)).first();
 if(!attempt?.code_verifier)return html('<p>Esta autorización ha caducado o ya fue usada.</p>',403);
 const payload=new URLSearchParams({
  client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,
  code:code,redirect_uri:REDIRECT,grant_type:'authorization_code',code_verifier:attempt.code_verifier
 });
 const result=await fetch('https://oauth2.googleapis.com/token',{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},body:payload,redirect:'error'});
 if(!result.ok)return html('<p>Google no completó la autorización. No se guardó ningún canal.</p>',502);
 const token=await result.json();
 if(typeof token.access_token!=='string'||typeof token.refresh_token!=='string')return html('<p>Google no devolvió autorización duradera. Inténtalo de nuevo.</p>',422);
 const ch=await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',{
  headers:{authorization:'Bearer '+token.access_token},redirect:'error'});
 if(!ch.ok)return html('<p>YouTube no pudo verificar el canal.</p>',502);
 const channels=(await ch.json()).items||[];
 const valid=channels.filter(x=>/^UC[A-Za-z0-9_-]{10,}$/.test(x.id||''));
 if(valid.length!==1)return html('<p>Debes seleccionar un único canal de YouTube propio.</p>',422);
 const selected=valid[0];
 const prev=await env.YTDB.prepare('SELECT status FROM oauth_channel WHERE singleton=1').first();
 if(prev?.status==='active')return html('<p>Ya existe un canal autorizado. Se bloqueó el reemplazo.</p>',409);
 const encrypted=await crypt(env,selected.id,token.refresh_token);
 const name=String(selected.snippet?.title||'Canal sin título').slice(0,120);
 await env.YTDB.prepare("INSERT OR REPLACE INTO oauth_channel(singleton,channel_id,channel_title,token_iv,token_ct,status,created_at) VALUES(1,?,?,?,?, 'pending',?)")
  .bind(selected.id,name,encrypted.iv,encrypted.ct,Math.floor(Date.now()/1000)).run();
 const inside='<p>Google identificó este canal. <strong>Comprueba que es el mismo donde publicas los Shorts.</strong></p><p><strong>'+escapeHtml(name)+'</strong><br><code>'+escapeHtml(selected.id)+'</code></p><p>Por ahora ningún vídeo ha cambiado.</p>'+
 '<form action="/oauth/confirm" method="post"><input type="hidden" name="channel" value="'+escapeHtml(selected.id)+'"><label>Código de administración</label><input type="password" name="code" minlength="24" required autocomplete="off"><button>Confirmar este canal</button></form>';
 return html(inside,200,{'set-cookie':'ihyt_bind=; Secure; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=0'});
}
async function confirm(request,env){
 if(!ready(env))return html('<p>Configuración pendiente.</p>',503);
 const f=await form(request);
 if(!await eq(f.get('code'),env.OAUTH_ADMIN_CODE))return html('<p>Código incorrecto. No se vinculó el canal.</p>',403);
 const channel=f.get('channel')||'';
 const r=await env.YTDB.prepare("UPDATE oauth_channel SET status='active' WHERE singleton=1 AND status='pending' AND channel_id=? AND created_at>=? RETURNING channel_id,channel_title")
  .bind(channel,Math.floor(Date.now()/1000)-1800).first();
 if(!r)return html('<p>No coincide el canal o ha caducado la confirmación.</p>',409);
 return html('<p>Conexión confirmada para <strong>'+escapeHtml(r.channel_title)+'</strong> (<code>'+escapeHtml(r.channel_id)+'</code>).</p><p>El agente sigue sin publicar ni modificar vídeos. La prueba real de lectura será el siguiente paso.</p>');
}
export default {
 async fetch(request,env){
  try{
   const u=new URL(request.url);
   if(u.origin!==new URL(REDIRECT).origin)return json({error:'wrong_origin'},421);
   if(u.pathname==='/health'&&request.method==='GET')return json({service:'infamoushub-youtube-connect',oauth_configured:!!ready(env),edits_enabled:false,uploads_enabled:false,publication_enabled:false});
   if((u.pathname==='/'||u.pathname==='/connect')&&request.method==='GET'){
    if(!ready(env))return html('<p>El conector está preparado en modo seguro. Falta configurar y autorizar Google OAuth.</p><p>URI de retorno en Google Cloud:<br><code>'+escapeHtml(REDIRECT)+'</code></p>');
    return html('<p>Autoriza exactamente el canal donde tienes los Shorts. Google pedirá un permiso amplio para gestionar YouTube, aunque este conector solo verifica el canal.</p>'+
     '<form action="/oauth/start" method="post"><label>Código de administración</label><input type="password" name="code" minlength="24" required autocomplete="off"><button>Conectar con Google</button></form>');
   }
   if(u.pathname==='/oauth/start'&&request.method==='POST')return await start(request,env);
   if(u.pathname==='/oauth/callback'&&request.method==='GET')return await callback(request,env);
   if(u.pathname==='/oauth/confirm'&&request.method==='POST')return await confirm(request,env);
   return json({error:'not_found'},404);
  }catch(e){return json({error:'authorization_blocked_safely'},500);}
 }
};
export const TEST={REDIRECT,SCOPE,escapeHtml,ready};
