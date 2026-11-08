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

// Read-only verification of the already authorized channel. No new consent or video writes.
const fromBase64url=input=>{
 if(typeof input!=='string'||!/^[A-Za-z0-9_-]{8,10000}$/.test(input))throw Error('invalid_stored_ciphertext');
 const base=input.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-input.length%4)%4);
 return Uint8Array.from(atob(base),ch=>ch.charCodeAt(0));
};
async function decryptStoredRefresh(env,connected){
 const keyBytes=Uint8Array.from(atob(env.OAUTH_TOKEN_KEY_B64),c=>c.charCodeAt(0));
 if(keyBytes.length!==32)throw Error('invalid_storage_key');
 const k=await crypto.subtle.importKey('raw',keyBytes,'AES-GCM',false,['decrypt']);
 const payload=await crypto.subtle.decrypt({name:'AES-GCM',iv:fromBase64url(connected.token_iv),
  additionalData:encoder.encode(connected.channel_id)},k,fromBase64url(connected.token_ct));
 return new TextDecoder().decode(payload);
}
async function verifyChannelReadOnly(env){
 const connected=await env.YTDB.prepare("SELECT channel_id,channel_title,status,token_iv,token_ct FROM oauth_channel WHERE singleton=1 AND status='active'").first();
 if(!connected)return {ok:false,kind:'not_connected'};
 // Safety: never use an OAuth credential for a different channel.
 if(!/^UC[A-Za-z0-9_-]{10,}$/.test(connected.channel_id))return {ok:false,kind:'invalid_channel_id'};
 const refresh=await decryptStoredRefresh(env,connected);
 const payload=new URLSearchParams({
  client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,
  refresh_token:refresh,grant_type:'refresh_token'
 });
 const response=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:payload,redirect:'manual'
 });
 if(response.status>=300&&response.status<400)return {ok:false,kind:'unexpected_google_redirect'};
 if(!response.ok)return {ok:false,kind:'google_token_rejected'};
 const token=await response.json();
 if(!token||typeof token.access_token!=='string'||!token.access_token)return {ok:false,kind:'token_missing'};
 const result=await fetch('https://www.googleapis.com/youtube/v3/channels?part=id%2Csnippet%2Cstatistics&mine=true',{
  method:'GET',headers:{authorization:'Bearer '+token.access_token},redirect:'manual'
 });
 if(result.status>=300&&result.status<400)return {ok:false,kind:'unexpected_youtube_redirect'};
 if(!result.ok)return {ok:false,kind:'youtube_api_rejected'};
 const payloadData=await result.json();
 const items=Array.isArray(payloadData.items)?payloadData.items:[];
 const channel=items.find(c=>c.id===connected.channel_id);
 if(!channel)return {ok:false,kind:'channel_mismatch'};
 return {ok:true,channel:{
  id:connected.channel_id,name:String(channel.snippet?.title||connected.channel_title).slice(0,100),
  video_count:Number(channel.statistics?.videoCount)||0
 },write_enabled:false,privacy_changes_enabled:false};
}

// Only the signed-in administrator can inspect recent uploads. This route never writes to YouTube.
function safeDuration(raw){
 const match=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(String(raw||''));
 if(!match||!match.slice(1).some(v=>v!==undefined))return 0;
 const [d,h,m,s]=match.slice(1).map(v=>Number(v||0));
 const total=d*86400+h*3600+m*60+s;
 return Number.isSafeInteger(total)&&total>=0?total:0;
}
async function listOwnerUploads(env){
 const saved=await env.YTDB.prepare("SELECT channel_id,token_iv,token_ct FROM oauth_channel WHERE singleton=1 AND status='active'").first();
 if(!saved||!/^UC[A-Za-z0-9_-]{10,}$/.test(saved.channel_id))return {ok:false,kind:'channel_not_connected'};
 const refresh=await decryptStoredRefresh(env,saved);
 const tokenRes=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({client_id:env.GOOGLE_OAUTH_CLIENT_ID,client_secret:env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:refresh,grant_type:'refresh_token'}),
  redirect:'manual'
 });
 if(tokenRes.status>=300&&tokenRes.status<400)return {ok:false,kind:'unexpected_token_redirect'};
 if(!tokenRes.ok)return {ok:false,kind:'google_token_rejected'};
 const access=(await tokenRes.json()).access_token;
 if(typeof access!=='string'||!access)return {ok:false,kind:'missing_access_token'};
 const get=async (url)=>{
  const r=await fetch(url,{method:'GET',headers:{authorization:'Bearer '+access},redirect:'manual'});
  if(r.status>=300&&r.status<400)throw Error('redirect_blocked');
  if(!r.ok)throw Error('youtube_api_failed');
  return await r.json();
 };
 const channel=await get('https://www.googleapis.com/youtube/v3/channels?part=id%2CcontentDetails&mine=true');
 const own=(Array.isArray(channel.items)?channel.items:[]).find(c=>c.id===saved.channel_id);
 const uploads=own?.contentDetails?.relatedPlaylists?.uploads;
 if(!uploads||typeof uploads!=='string')return {ok:false,kind:'owner_playlist_not_found'};
 const playlist=await get('https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&maxResults=50&playlistId='+encodeURIComponent(uploads));
 const ids=[...new Set((Array.isArray(playlist.items)?playlist.items:[])
  .map(i=>i?.contentDetails?.videoId).filter(id=>typeof id==='string'&&/^[A-Za-z0-9_-]{11}$/.test(id)))];
 if(!ids.length)return {ok:true,channel_id:saved.channel_id,checked:0,long_videos:[],excluded_short:0,total_seen:0,read_only:true};
 const details=await get('https://www.googleapis.com/youtube/v3/videos?part=id%2Csnippet%2CcontentDetails%2Cstatus&id='+encodeURIComponent(ids.join(',')));
 const valid=new Map();
 for(const item of Array.isArray(details.items)?details.items:[]){
  if(item.snippet?.channelId!==saved.channel_id||!ids.includes(item.id))continue;
  const seconds=safeDuration(item.contentDetails?.duration);
  if(!seconds||['live','upcoming'].includes(item.snippet?.liveBroadcastContent))continue;
  valid.set(item.id,{id:item.id,title:String(item.snippet?.title||'Sin título').slice(0,150),
    seconds,privacy:String(item.status?.privacyStatus||'unknown').slice(0,20),
    published:String(item.snippet?.publishedAt||''),video_url:'https://www.youtube.com/watch?v='+item.id});
 }
 const list=ids.map(id=>valid.get(id)).filter(Boolean);
 const long=list.filter(v=>v.seconds>=240);
 return {ok:true,channel_id:saved.channel_id,checked:list.length,long_videos:long.slice(0,50),
  excluded_short:list.length-long.length,total_seen:ids.length,has_more:!!playlist.nextPageToken,read_only:true};
}
async function uploadsDashboard(request,env){
 if(!ready(env))return html('<p>El conector no está disponible.</p>',503);
 if(!await adminSession(request,env))return html(nav('<p>Sesión caducada. Entra de nuevo con tu contraseña de administración.</p>'),401);
 let result;
 try{result=await listOwnerUploads(env);}catch(e){result={ok:false,kind:'youtube_read_unavailable'};}
 if(!result.ok)return html(nav('<p>No se pudo leer la lista de vídeos ('+escapeHtml(result.kind)+'). No se ha modificado nada.</p>'),503);
 const items=result.long_videos.map(v=>'<li><strong>'+escapeHtml(v.title)+'</strong> ('+
  Math.floor(v.seconds/60)+' min '+v.seconds%60+' s, '+escapeHtml(v.privacy)+') '+
  '<a href="'+v.video_url+'" rel="noopener noreferrer">Abrir vídeo</a></li>').join('');
 return html('<h2>Vídeos largos del canal</h2><p>Cuenta conectada: <code>'+escapeHtml(result.channel_id)+'</code></p>'+
  '<p>Inspeccionados: '+result.checked+' · Vídeos de 4 minutos o más: '+result.long_videos.length+
  ' · Vídeos cortos excluidos: '+result.excluded_short+'</p>'+
  '<ul>'+(items||'<li>No se encontraron vídeos largos entre las subidas recientes.</li>')+'</ul>'+
  (result.has_more?'<p>Hay más vídeos antiguos que aún no se han examinado.</p>':'')+
  '<p>Solo lectura. No se han cambiado títulos, descripciones, miniaturas ni privacidad.</p>'+
  '<p><a href="/channel/videos">Ver mis vídeos largos</a></p>'+
  '<p><a href="/connect">Volver al panel</a></p>');
}

async function channelVerification(request,env){
 if(!ready(env))return html('<p>Conexión no disponible.</p>',503);
 if(!await adminSession(request,env))return html(nav('<p>Sesión caducada. Vuelve a entrar con tu contraseña de administración.</p>'),401);
 let report;
 try{report=await verifyChannelReadOnly(env);}
 catch(e){report={ok:false,kind:'read_check_failed'};}
 if(!report.ok)return html('<h2>Comprobación pendiente</h2><p>No se pudo verificar el canal mediante YouTube en este intento (código: '+
  escapeHtml(report.kind)+'). Ningún vídeo ha cambiado.</p>'+nav(''),503);
 return html('<h2>Conexión verificada con YouTube</h2>'+
  '<p>Canal: <strong>'+escapeHtml(report.channel.name)+'</strong></p>'+
  '<p>ID: <code>'+escapeHtml(report.channel.id)+'</code></p>'+
  '<p>Vídeos indicados por YouTube: '+Number(report.channel.video_count)+'</p>'+
  '<p>Esta prueba es solo de lectura. Los cambios de título, miniatura y privacidad siguen desactivados.</p>'+
  '<p><a href="/connect">Volver al panel</a></p>');
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
 // Display the already-connected channel directly, without another Google consent request.
 const csrf=rnd(32);
 let linked;
 try{linked=await env.YTDB.prepare('SELECT channel_id,channel_title,status FROM oauth_channel WHERE singleton=1').first();}
 catch(e){return html('<h2>Sesión iniciada</h2><p>No se pudo consultar el canal en este momento. <a href="/connect">Abrir el panel</a>.</p>',503,{'set-cookie':adminCookie(session)});}
 const validLink=linked?.status==='active'&&/^UC[A-Za-z0-9_-]{10,}$/.test(linked.channel_id||'');
 const body=validLink?'<h2>Sesión iniciada</h2><p>Canal conectado: <strong>'+escapeHtml(linked.channel_title)+'</strong></p>'+
  '<p><a href="/channel/videos">Ver mis vídeos largos (solo lectura)</a></p>'+
  '<p><a href="/channel/verify">Comprobar conexión con YouTube</a></p>'+
  '<p><a href="/connect">Volver al panel</a></p>':
  '<h2>Sesión iniciada</h2><p>Primera parte completada. Ahora conecta el canal de YouTube donde ya publicas Shorts.</p>'+
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
 // Cloudflare Workers does not support redirect:'error'; a Request throws a TypeError.
 // 'manual' prevents a 3xx from forwarding OAuth credentials to any redirected endpoint.
 const result=await fetch('https://oauth2.googleapis.com/token',{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},body:payload,redirect:'manual'});
 if(result.status>=300&&result.status<400)return html('<p>Google devolvió una redirección inesperada durante la autorización. Se bloqueó para proteger tus credenciales.</p>',502);
 if(!result.ok)return html('<p>Google rechazó el intercambio de autorización. No se ha guardado ningún canal. Comprueba el cliente OAuth y sus permisos.</p>',502);
 const token=await result.json();
 if(typeof token.access_token!=='string'||typeof token.refresh_token!=='string')return html('<p>Google no devolvió autorización duradera. Inténtalo de nuevo.</p>',422);
 phase='YOUTUBE_CHANNEL_CHECK';
 // Redirect responses are rejected: a bearer token must never follow a redirect.
 const ch=await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true',{
  headers:{authorization:'Bearer '+token.access_token},redirect:'manual'});
 if(ch.status>=300&&ch.status<400)return html('<p>YouTube devolvió una redirección inesperada. Se bloqueó para proteger la autorización.</p>',502);
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
 return html('<p>Conexión confirmada para <strong>'+escapeHtml(r.channel_title)+'</strong> (<code>'+escapeHtml(r.channel_id)+'</code>).</p>'+
  '<p>El agente sigue sin publicar ni modificar vídeos.</p><p><a href="/channel/verify">Comprobar conexión con YouTube (solo lectura)</a></p>');
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
    const existing=logged?await env.YTDB.prepare("SELECT channel_id,channel_title,status FROM oauth_channel WHERE singleton=1").first():null;
    const currentChannel=existing?.status==='active'?'<p><strong>Canal conectado: '+escapeHtml(existing.channel_title)+'</strong></p><p>ID: <code>'+escapeHtml(existing.channel_id)+'</code></p>':'';
    const connectForm=existing?.status==='active'?'':'<form method="post" action="/oauth/start">'+csrfInput(csrf)+'<button type="submit">2. Conectar mi YouTube</button></form>';
    const content=logged?
     '<h2>Sesión iniciada</h2>'+currentChannel+
     '<p>Ya puedes consultar vídeos largos del canal. Los Shorts y las publicaciones existentes no se modificarán.</p>'+
     '<p><a href="/channel/verify">Verificar el canal (solo lectura)</a></p>'+
     '<p><a href="/channel/videos">Ver mis vídeos largos (solo lectura)</a></p>'+
     connectForm+
     '<form method="post" action="/session/logout">'+csrfInput(csrf)+'<button type="submit">Cerrar sesión</button></form>':
     '<p>Primero entra con tu contraseña de administración. Después aparecerá el panel de YouTube.</p>'+
     '<form method="post" action="/session/login">'+csrfInput(csrf)+'<label for="admin-code">Contraseña de administración</label>'+
     '<input id="admin-code" name="code" type="password" required minlength="24" autocomplete="current-password" placeholder="Tu contraseña segura">'+
     '<button type="submit">1. Entrar</button></form>';
    return html(content,200,{'set-cookie':csrfHeader(csrf)});
   }
   if(u.pathname==='/channel/verify'&&request.method==='GET')return await channelVerification(request,env);
   if(u.pathname==='/channel/videos'&&request.method==='GET')return await uploadsDashboard(request,env);
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
export const TEST={REDIRECT,SCOPE,escapeHtml,ready,consumeAttempt,activateChannel,verifyChannelReadOnly,listOwnerUploads,safeDuration};
