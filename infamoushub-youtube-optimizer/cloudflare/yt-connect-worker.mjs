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
const CSRF_COOKIE='__Host-ihyt_csrf';
const csrfHeader=value=>CSRF_COOKIE+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=600';
const csrfInput=value=>'<input type="hidden" name="csrf" value="'+escapeHtml(value)+'">';
const ADMIN_COOKIE='__Host-ihyt_admin';
const adminCookie=value=>ADMIN_COOKIE+'='+value+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=1200';
const adminClear=()=>ADMIN_COOKIE+'=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
const redirect=(location,cookieHeader)=>new Response(null,{status:303,headers:{...headers,location,'set-cookie':cookieHeader}});
const nav=(s)=>'<p><a href="/connect">Volver al inicio</a></p>'+s;
const form=async r=>{
 const origin=r.headers.get('origin');
 if(origin&&origin!=='null'&&origin!==new URL(REDIRECT).origin)throw Error('Invalid origin');
 if(r.headers.get('sec-fetch-site')==='cross-site')throw Error('Cross-site submission rejected');
 if(!(r.headers.get('content-type')||'').startsWith('application/x-www-form-urlencoded'))throw Error('Invalid content type');
 if(Number(r.headers.get('content-length')||0)>4096)throw Error('Payload too large');
 const t=await r.text();if(t.length>4096)throw Error('Payload too large');
 const f=new URLSearchParams(t),supplied=f.get('csrf')||'',bound=cookie(r,CSRF_COOKIE);
 if(!/^[A-Za-z0-9_-]{30,90}$/.test(supplied)||!await eq(supplied,bound))
    throw Error('Invalid CSRF token');
 return f;
};
const cookie=(r,name)=>{
 for(const c of (r.headers.get('cookie')||'').split(';')){
  const v=c.trim();if(v.startsWith(name+'='))return v.slice(name.length+1);
 }
 return '';
};
async function adminSession(request,env){
 const token=cookie(request,ADMIN_COOKIE);
 if(!/^[A-Za-z0-9_-]{35,110}$/.test(token))return false;
 const row=await env.YTDB.prepare('SELECT expires_at FROM oauth_admin_sessions WHERE session_hash=? AND expires_at>=?')
 .bind(await sha(token),Math.floor(Date.now()/1000)).first();
 return !!row;
}
async function login(request,env){
 if(!ready(env))return html('<p>La autorización aún no está configurada.</p>',503);
 const input=await form(request);
 if(!await eq(input.get('code'),env.OAUTH_ADMIN_CODE))return html(nav('<p>Contraseña incorrecta. Vuelve a intentar entrar.</p>'),403);
 const session=rnd(48),expires=Math.floor(Date.now()/1000)+1200;
 try{
  await env.YTDB.prepare('INSERT INTO oauth_admin_sessions(session_hash,expires_at) VALUES (?,?)')
   .bind(await sha(session),expires).run();
 }catch(e){
  return html(nav('<p>No fue posible guardar la sesión. No se conectó Google. Intenta acceder de nuevo.</p>'),503);
 }
 // Display step 2 DIRECTLY: no automatic navigation through embedded mobile browsers.
 const csrf=rnd(32);
 const body='<h2>Sesión iniciada</h2><p>Primera parte completada. Ahora conecta el canal de YouTube donde ya publicas Shorts.</p>'+
  '<form action="/oauth/start" method="post">'+csrfInput(csrf)+'<button type="submit">2. Conectar mi YouTube</button></form>'+
  '<p><a href="/connect">Ver mi sesión</a></p>';
 const response=html(body,200);
 response.headers.append('set-cookie',adminCookie(session));
 response.headers.append('set-cookie',csrfHeader(csrf));
 return response;
}
async function logout(request,env){
 if(!ready(env))return html('<p>Configuración no disponible.</p>',503);
 await form(request);
 const token=cookie(request,ADMIN_COOKIE);
 if(/^[A-Za-z0-9_-]{35,110}$/.test(token))
  await env.YTDB.prepare('DELETE FROM oauth_admin_sessions WHERE session_hash=?').bind(await sha(token)).run();
 return redirect('/connect',adminClear());
}
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
 await form(request);
 if(!await adminSession(request,env))return html(nav('<p>Tu sesión ha caducado. Entra con la contraseña otra vez.</p>'),401);
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
 const google='https://accounts.google.com/o/oauth2/v2/auth?'+q.toString();
 return html('<h2>Sesión iniciada</h2><p>Ahora pulsa el siguiente enlace para continuar con Google. Si tu navegador integrado bloquea Google, abre esta página en Chrome y repite el proceso.</p>'+
  '<p><a href="'+escapeHtml(google)+'" rel="noreferrer">Continuar con Google y seleccionar mi canal</a></p><p>No se ha cambiado ningún vídeo.</p>',200,
  {'set-cookie':'ihyt_bind='+bind+'; Secure; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=600'});
}
async function consumeAttempt(db,state,browserBinding,nowUnix){
 // D1 write statements must use run(): first() is used only for SELECT.
 // A conditional DELETE with changes=1 makes the Google state strictly one-use.
 const st=await sha(state), bh=await sha(browserBinding);
 const row=await db.prepare('SELECT code_verifier FROM oauth_attempts WHERE state_hash=? AND browser_hash=? AND expires_at>=?')
  .bind(st,bh,nowUnix).first();
 if(!row?.code_verifier)return null;
 const removed=await db.prepare('DELETE FROM oauth_attempts WHERE state_hash=? AND browser_hash=? AND expires_at>=?')
  .bind(st,bh,nowUnix).run();
 if(removed?.meta?.changes!==1)return null;
 return row.code_verifier;
}
async function activateChannel(db,channel,nowUnix){
 // Use one conditional update and SELECT, not UPDATE RETURNING .first().
 const result=await db.prepare("UPDATE oauth_channel SET status='active' WHERE singleton=1 AND status='pending' AND channel_id=? AND created_at>=?")
  .bind(channel,nowUnix-1800).run();
 if(result?.meta?.changes!==1)return null;
 return db.prepare("SELECT channel_id,channel_title FROM oauth_channel WHERE singleton=1 AND status='active' AND channel_id=?")
  .bind(channel).first();
}
async function callback(request,env){
 let phase='SESSION_CHECK';
 try{
 if(!ready(env))return html('<p>Google OAuth todavía no está configurado.</p>',503);
 if(!await adminSession(request,env))return html(nav('<p>La sesión de administración ha caducado; no se ha guardado el canal.</p>'),401);
 const params=new URL(request.url).searchParams;
 if(params.get('error'))return html('<p>Google no autorizó la conexión.</p>',403);
 const state=params.get('state'),code=params.get('code'),bind=cookie(request,'ihyt_bind');
 if(!state||state.length>128||!code||code.length>4096||!bind)return html('<p>Sesión incompleta.</p>',400);
 phase='GOOGLE_STATE_CHECK';
 const verifier=await consumeAttempt(env.YTDB,state,bind,Math.floor(Date.now()/1000));
 if(!verifier)return html(nav('<p>El enlace de Google ha caducado o ya se ha utilizado. Regresa al inicio, entra y genera una autorización nueva. No se ha conectado ningún canal.</p>'),403);
 const payload=new URLSearchParams({
  client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,
  code:code,redirect_uri:REDIRECT,grant_type:'authorization_code',code_verifier:verifier
 });
 phase='GOOGLE_TOKEN_EXCHANGE';
 const result=await fetch('https://oauth2.googleapis.com/token',{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},body:payload,redirect:'error'});
 if(!result.ok)return html('<p>Google no completó la autorización. No se guardó ningún canal.</p>',502);
 const token=await result.json();
 if(typeof token.access_token!=='string'||typeof token.refresh_token!=='string')return html('<p>Google no devolvió autorización duradera. Inténtalo de nuevo.</p>',422);
 phase='YOUTUBE_CHANNEL_CHECK';
 const ch=await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',{
  headers:{authorization:'Bearer '+token.access_token},redirect:'error'});
 if(!ch.ok)return html('<p>YouTube no pudo verificar el canal.</p>',502);
 const channels=(await ch.json()).items||[];
 const valid=channels.filter(x=>/^UC[A-Za-z0-9_-]{10,}$/.test(x.id||''));
 if(valid.length!==1)return html('<p>Debes seleccionar un único canal de YouTube propio.</p>',422);
 const selected=valid[0];
 const prev=await env.YTDB.prepare('SELECT status FROM oauth_channel WHERE singleton=1').first();
 if(prev?.status==='active')return html('<p>Ya existe un canal autorizado. Se bloqueó el reemplazo.</p>',409);
 phase='ENCRYPT_AND_STORE';
 const encrypted=await crypt(env,selected.id,token.refresh_token);
 const name=String(selected.snippet?.title||'Canal sin título').slice(0,120);
 await env.YTDB.prepare("INSERT OR REPLACE INTO oauth_channel(singleton,channel_id,channel_title,token_iv,token_ct,status,created_at) VALUES(1,?,?,?,?, 'pending',?)")
  .bind(selected.id,name,encrypted.iv,encrypted.ct,Math.floor(Date.now()/1000)).run();
 const csrf=rnd(32);
 const inside='<p>Google identificó este canal. <strong>Comprueba que es el mismo donde publicas los Shorts.</strong></p><p><strong>'+escapeHtml(name)+'</strong><br><code>'+escapeHtml(selected.id)+'</code></p><p>Por ahora ningún vídeo ha cambiado.</p>'+
 '<form action="/oauth/confirm" method="post">'+csrfInput(csrf)+'<input type="hidden" name="channel" value="'+escapeHtml(selected.id)+'"><button type="submit">Sí, conectar este canal</button></form>';
 const response=html(inside,200,{'set-cookie':csrfHeader(csrf)});
 response.headers.append('set-cookie','ihyt_bind=; Secure; HttpOnly; SameSite=Lax; Path=/oauth; Max-Age=0');
 return response;
 }catch(e){
  // No URL query strings, access/refresh tokens, browser cookies or passwords ever exposed.
  return html(nav('<p>No se pudo completar el retorno de Google (fase '+phase+'). No se ha autorizado ningún canal. Puedes iniciar una autorización nueva desde la página de conexión.</p>'),503);
 }
}
async function confirm(request,env){
 if(!ready(env))return html('<p>Configuración pendiente.</p>',503);
 const f=await form(request);
 if(!await adminSession(request,env))return html(nav('<p>Sesión caducada. Entra de nuevo; no se ha conectado ningún canal.</p>'),401);
 const channel=f.get('channel')||'';
 const r=await activateChannel(env.YTDB,channel,Math.floor(Date.now()/1000));
 if(!r)return html('<p>No coincide el canal o ha caducado la confirmación.</p>',409);
 return html('<p>Conexión confirmada para <strong>'+escapeHtml(r.channel_title)+'</strong> (<code>'+escapeHtml(r.channel_id)+'</code>).</p><p>El agente sigue sin publicar ni modificar vídeos. La prueba real de lectura será el siguiente paso.</p>');
}
export default {
 async fetch(request,env){
  try{
   const u=new URL(request.url);
   if(u.origin!==new URL(REDIRECT).origin)return json({error:'wrong_origin'},421);
   if(u.pathname==='/health'&&request.method==='GET')return json({service:'infamoushub-youtube-connect',oauth_configured:!!ready(env),edits_enabled:false,uploads_enabled:false,publication_enabled:false});
   if(u.pathname==='/health/storage'&&request.method==='GET'){
    // Safe read-only internal storage availability check; never report identities, counts or tokens.
    if(!env.YTDB)return json({available:false},503);
    try{
     await env.YTDB.prepare('SELECT expires_at FROM oauth_admin_sessions WHERE session_hash=? AND expires_at>=?').bind('health-probe-does-not-match',Math.floor(Date.now()/1000)).first();
     return json({available:true,kind:'session_lookup_only'});
    }catch(e){return json({available:false},503);}
   }
   if((u.pathname==='/'||u.pathname==='/connect')&&request.method==='GET'){
    if(!ready(env))return html('<p>La conexión está preparada, pero faltan las credenciales o su activación en Cloudflare.</p><p>URI de retorno:<br><code>'+escapeHtml(REDIRECT)+'</code></p>',503);
    const csrf=rnd(32);
    const logged=await adminSession(request,env);
    const content=logged?
     '<h2>Sesión iniciada</h2><p>Ahora puedes conectar el mismo canal donde ya publicas Shorts. Google te mostrará sus permisos.</p>'+
     '<form method="post" action="/oauth/start">'+csrfInput(csrf)+'<button type="submit">2. Conectar mi YouTube</button></form>'+
     '<form method="post" action="/session/logout">'+csrfInput(csrf)+'<button type="submit">Cerrar sesión</button></form>':
     '<p>Primero entra con tu contraseña de administración. Después aparecerá el botón para conectar YouTube.</p>'+
     '<form method="post" action="/session/login">'+csrfInput(csrf)+'<label for="admin-code">Contraseña de administración</label>'+
     '<input id="admin-code" name="code" type="password" required minlength="24" autocomplete="current-password" placeholder="Tu contraseña segura">'+
     '<button type="submit">1. Entrar</button></form>';
    return html(content,200,{'set-cookie':csrfHeader(csrf)});
   }
   if(u.pathname==='/session/login'&&request.method==='POST')return await login(request,env);
   if(u.pathname==='/session/logout'&&request.method==='POST')return await logout(request,env);
   if(u.pathname==='/oauth/start'&&request.method==='POST')return await start(request,env);
   if(u.pathname==='/oauth/callback'&&request.method==='GET')return await callback(request,env);
   if(u.pathname==='/oauth/confirm'&&request.method==='POST')return await confirm(request,env);
   return json({error:'not_found'},404);
  }catch(e){
   // Safe error categories only: never expose OAuth codes, tokens, headers or submitted passwords.
   const known={'Invalid origin':'form_origin_rejected','Cross-site submission rejected':'cross_site_rejected','Invalid CSRF token':'session_token_mismatch','Invalid content type':'form_content_type_rejected','Payload too large':'body_limit_exceeded'};
   const error=known[e?.message]||'internal_error';
   if(error==='internal_error'){
    // Fail closed with a non-sensitive step ID, never with exception details or OAuth values.
    const pathname=new URL(request.url).pathname;
    const phase=pathname==='/session/login'?'LOGIN':pathname==='/connect'?'SESSION':
      pathname==='/oauth/start'?'GOOGLE_START':pathname==='/oauth/callback'?'GOOGLE_CALLBACK':
      pathname==='/oauth/confirm'?'CHANNEL_CONFIRM':'OTHER';
    return html('<p>No se completó el paso ('+phase+'). No se ha cambiado ningún vídeo.</p>'+
     '<p><a href="/connect">Volver a la conexión</a></p>',503);
   }
   return json({error},403);
  }
 }
};
export const TEST={REDIRECT,SCOPE,escapeHtml,ready,consumeAttempt,activateChannel};
