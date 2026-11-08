import assert from 'node:assert/strict';
import {test} from 'node:test';
import worker,{TEST} from './yt-connect-worker.mjs';
const origin=new URL(TEST.REDIRECT).origin;
function request(path,opts={}){return new Request(origin+path,opts);}
test('OAuth endpoint is correct and scope is documented',()=>{
 assert.equal(TEST.REDIRECT,'https://infamoushub-youtube-connect.infamoushub-yt-29bea3.workers.dev/oauth/callback');
 assert.equal(TEST.SCOPE,'https://www.googleapis.com/auth/youtube.force-ssl');
});
test('HTML must escape channel titles',()=>{
 assert.equal(TEST.escapeHtml('<img src=x onerror=1>'),'&lt;img src=x onerror=1&gt;');
});
test('inactive without secrets, never edits',()=>{
 assert.equal(TEST.ready({OAUTH_ENABLED:'NO',YTDB:{}}),false);
});
test('health has no sensitive information or edit feature',async()=>{
 const response=await worker.fetch(request('/health'),{OAUTH_ENABLED:'NO'});
 const data=await response.json();
 assert.equal(response.status,200);
 assert.equal(data.oauth_configured,false);
 assert.equal(data.edits_enabled,false);
 assert.equal(data.uploads_enabled,false);
 assert.equal(data.publication_enabled,false);
 assert.equal(response.headers.get('cache-control'),'no-store');
});
test('setup page is safe without Google credentials',async()=>{
 const response=await worker.fetch(request('/connect'),{OAUTH_ENABLED:'NO'});
 const body=await response.text();
 assert.equal(response.status,503);
 assert.match(body,/faltan las credenciales o su activación en Cloudflare/);
 assert.ok(!body.includes('client_secret'));
});
test('OAuth start blocked until configured',async()=>{
 const response=await worker.fetch(request('/oauth/start',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'code=anything'
 }),{OAUTH_ENABLED:'NO'});
 assert.equal(response.status,503);
});
test('OAuth callback blocked until configured',async()=>{
 const response=await worker.fetch(request('/oauth/callback?state=abc&code=x'),{OAUTH_ENABLED:'NO'});
 assert.equal(response.status,503);
});
test('no arbitrary YouTube write endpoints exist',async()=>{
 for(const path of ['/videos/update','/thumbnails/set','/oauth/delete','/publish']){
  const r=await worker.fetch(request(path,{method:'POST'}),{OAUTH_ENABLED:'NO'});
  assert.equal(r.status,404,path);
 }
});
test('reject requests from an unexpected host',async()=>{
 const r=await worker.fetch(new Request('https://evil.example/health'),{OAUTH_ENABLED:'NO'});
 assert.equal(r.status,421);
});


function readyEnv(){
 return {
  OAUTH_ENABLED:'YES',
  YTDB:{prepare(){throw Error('Database should not be accessed in invalid-code test');}},
  GOOGLE_OAUTH_CLIENT_ID:'example.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET:'example_secret_not_real',
  OAUTH_ADMIN_CODE:'a-secret-test-owner-code-12345678',
  OAUTH_TOKEN_KEY_B64:'not_used_in_start'
 };
}
async function extractCsrf(env){
 const r=await worker.fetch(request('/connect'),env);
 const body=await r.text();
 const code=body.match(/name="csrf" value="([^"]+)"/)?.[1];
 const cookie=r.headers.get('set-cookie')?.split(';')[0];
 assert.equal(r.status,200);
 assert.ok(code?.length>=30);
 assert.equal(cookie?.split('=')[1],code);
 return {code,cookie};
}
test('Google connect has an HttpOnly same-site CSRF cookie bound to its form',async()=>{
 const r=await worker.fetch(request('/connect'),readyEnv());
 const text=await r.text();
 const cookie=r.headers.get('set-cookie')||'';
 assert.match(text,/name="csrf" value="/);
 assert.match(cookie,/__Host-ihyt_csrf=/);
 assert.match(cookie,/Secure/);
 assert.match(cookie,/HttpOnly/);
 assert.match(cookie,/SameSite=Strict/);
});
test('embedded browser null Origin with valid CSRF produces a clear wrong-code error (not 500)',async()=>{
 const env=readyEnv();
 const {code,cookie}=await extractCsrf(env);
 const body=new URLSearchParams({code:'definitely-incorrect-admin-code',csrf:code});
 const r=await worker.fetch(request('/session/login',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cookie':cookie,'origin':'null'},body
 }),env);
 assert.equal(r.status,403);
 assert.match(await r.text(),/Contraseña incorrecta/);
});
test('missing or mismatched CSRF fails before verifying owner password',async()=>{
 const env=readyEnv();
 const {code,cookie}=await extractCsrf(env);
 const r=await worker.fetch(request('/session/login',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cookie':cookie,'origin':'null'},
  body:new URLSearchParams({csrf:'not-the-issued-token',code:env.OAUTH_ADMIN_CODE})
 }),env);
 assert.equal(r.status,403);
 assert.equal((await r.json()).error,'session_token_mismatch');
});
test('explicit foreign site fails even with valid CSRF token',async()=>{
 const env=readyEnv(), {code,cookie}=await extractCsrf(env);
 const r=await worker.fetch(request('/session/login',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cookie':cookie,'origin':'https://evil.example','sec-fetch-site':'cross-site'},
  body:new URLSearchParams({csrf:code,code:env.OAUTH_ADMIN_CODE})
 }),env);
 assert.equal(r.status,403);
 assert.equal((await r.json()).error,'form_origin_rejected');
});

class InMemoryDB {
 constructor(){this.sessions=new Map();this.oauthAttempts=0;this.channels=[];}
 prepare(sql){
  const db=this;
  const bound=(...args)=>({
   async first(){
    if(sql.includes('FROM oauth_admin_sessions'))
      return db.sessions.has(args[0])&&db.sessions.get(args[0])>=args[1]?{expires_at:db.sessions.get(args[0])}:null;
    if(sql.includes('FROM oauth_channel'))return null;
    throw Error('Unexpected SQL first: '+sql);
   },
   async run(){
    if(sql.includes('INSERT INTO oauth_admin_sessions'))db.sessions.set(args[0],args[1]);
    else if(sql.includes('INSERT INTO oauth_attempts'))db.oauthAttempts++;
    else if(sql.includes('DELETE FROM oauth_admin_sessions'))db.sessions.delete(args[0]);
    else throw Error('Unexpected SQL run: '+sql);
    return {success:true};
   }
  });
  return {bind(...args){return bound(...args);},first:async()=>bound().first()};
 }
}
async function loggedIn(){
 const env=readyEnv(),db=new InMemoryDB();
 env.YTDB=db;
 const loginForm=await extractCsrf(env);
 const r=await worker.fetch(request('/session/login',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',
   'cookie':loginForm.cookie,'origin':'null'},
  body:new URLSearchParams({csrf:loginForm.code,code:env.OAUTH_ADMIN_CODE})
 }),env);
 assert.equal(r.status,200);
 const firstPage=await r.text();
 assert.match(firstPage,/Sesión iniciada/);
 assert.match(firstPage,/2. Conectar mi YouTube/);
 // Both cookies must be set by the same response, without any mobile redirect.
 const cookies=r.headers.getSetCookie().map(c=>c.split(';')[0]);
 const sessionCookie=cookies.find(c=>c.startsWith('__Host-ihyt_admin='));
 const firstCsrfCookie=cookies.find(c=>c.startsWith('__Host-ihyt_csrf='));
 assert.ok(sessionCookie);
 assert.ok(firstCsrfCookie);
 assert.match(firstPage,/name="csrf" value="/);
 const dashboard=await worker.fetch(request('/connect',{headers:{cookie:sessionCookie}}),env);
 assert.equal(dashboard.status,200);
 const page=await dashboard.text();
 assert.match(page,/Sesión iniciada/);
 assert.match(page,/2. Conectar mi YouTube/);
 const csrf=page.match(/name="csrf" value="([^"]+)"/)?.[1];
 const csrfCookie=(dashboard.headers.get('set-cookie')||'').split(';')[0];
 assert.ok(csrf?.length>30);
 return {env,db,sessionCookie,csrf,csrfCookie};
}
test('password sign-in and separate YouTube connection screen',async()=>{
 const {sessionCookie,env}=await loggedIn();
 const page=await (await worker.fetch(request('/connect',{headers:{cookie:sessionCookie}}),env)).text();
 assert.match(page,/Conectar mi YouTube/);
 assert.doesNotMatch(page,/type="password"/);
});
test('only a signed-in session can create a Google consent request',async()=>{
 const env=readyEnv();env.YTDB=new InMemoryDB();
 const {code,cookie}=await extractCsrf(env);
 const r=await worker.fetch(request('/oauth/start',{
  method:'POST',headers:{cookie,'content-type':'application/x-www-form-urlencoded','origin':'null'},
  body:new URLSearchParams({csrf:code})
 }),env);
 assert.equal(r.status,401);
 assert.match(await r.text(),/sesión ha caducado/);
 assert.equal(env.YTDB.oauthAttempts,0);
});
test('after signing in, Google connect has a visible link for mobile browsers',async()=>{
 const {env,db,sessionCookie,csrf,csrfCookie}=await loggedIn();
 const r=await worker.fetch(request('/oauth/start',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cookie':sessionCookie+'; '+csrfCookie,'origin':'null'},
  body:new URLSearchParams({csrf})
 }),env);
 assert.equal(r.status,200);
 const html=await r.text();
 assert.match(html,/Continuar con Google y seleccionar mi canal/);
 assert.match(html,/https:\/\/accounts.google.com\/o\/oauth2\/v2\/auth/);
 assert.match(html,/code_challenge_method=S256/);
 assert.match(html,/redirect_uri=/);
 assert.equal(db.oauthAttempts,1);
 assert.match(r.headers.get('set-cookie')||'',/ihyt_bind=/);
 assert.doesNotMatch(html,/access_token|refresh_token|client_secret/);
});
test('session is not permanent: expired session blocks start',async()=>{
 const {env,db,sessionCookie,csrf,csrfCookie}=await loggedIn();
 for(const key of db.sessions.keys())db.sessions.set(key,0);
 const r=await worker.fetch(request('/oauth/start',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cookie':sessionCookie+'; '+csrfCookie},
  body:new URLSearchParams({csrf})
 }),env);
 assert.equal(r.status,401);
 assert.equal(db.oauthAttempts,0);
});
test('logged out session loses permission to connect Google',async()=>{
 const {env,db,sessionCookie,csrf,csrfCookie}=await loggedIn();
 const r=await worker.fetch(request('/session/logout',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cookie':sessionCookie+'; '+csrfCookie},
  body:new URLSearchParams({csrf})
 }),env);
 assert.equal(r.status,303);
 assert.equal(db.sessions.size,0);
 const second=await worker.fetch(request('/oauth/start',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cookie':sessionCookie+'; '+csrfCookie},
  body:new URLSearchParams({csrf})
 }),env);
 assert.equal(second.status,401);
});

test('storage health test never exposes session data or channel identifiers',async()=>{
 const env=readyEnv(), db=new InMemoryDB();
 env.YTDB=db;
 const r=await worker.fetch(request('/health/storage'),env);
 assert.equal(r.status,200);
 const data=await r.json();
 assert.deepEqual(data,{available:true,kind:'session_lookup_only'});
 assert.ok(!JSON.stringify(data).includes('channel_id'));
});


test('OAuth state is consumed once using SELECT plus conditional DELETE.run, never write .first',async()=>{
 let saved=true, selectCalls=0, deleteCalls=0;
 const db={
  prepare(sql){
   if(sql.startsWith('SELECT code_verifier FROM oauth_attempts'))return {
    bind(){return {first:async()=>{selectCalls++;return saved?{code_verifier:'mock-pkce-verifier'}:null;}}}
   };
   if(sql.startsWith('DELETE FROM oauth_attempts'))return {
    bind(){return {run:async()=>{deleteCalls++;if(!saved)return {meta:{changes:0}};saved=false;return {meta:{changes:1}};}}}
   };
   throw Error('Unexpected query or unsafe non-SELECT .first(): '+sql);
  }
 };
 const one=await TEST.consumeAttempt(db,'mock-state','mock-browser-cookie',Math.floor(Date.now()/1000));
 const two=await TEST.consumeAttempt(db,'mock-state','mock-browser-cookie',Math.floor(Date.now()/1000));
 assert.equal(one,'mock-pkce-verifier');
 assert.equal(two,null);
 assert.equal(selectCalls,2);
 assert.equal(deleteCalls,1);
});
test('OAuth state fails closed if concurrent use already deleted it',async()=>{
 const db={
  prepare(sql){
   if(sql.startsWith('SELECT code_verifier'))return {bind(){return {first:async()=>({code_verifier:'mock-pkce-verifier'})}}};
   if(sql.startsWith('DELETE FROM oauth_attempts'))return {bind(){return {run:async()=>({meta:{changes:0}})}}};
   throw Error('Unexpected query '+sql);
  }
 };
 assert.equal(await TEST.consumeAttempt(db,'mock-state','mock-cookie',Math.floor(Date.now()/1000)),null);
});
test('channel activation requires a conditional single UPDATE.run then a SELECT',async()=>{
 let active=false,updates=0;
 const db={
  prepare(sql){
   if(sql.startsWith('UPDATE oauth_channel'))return {bind(){return {run:async()=>{
    updates++;if(active)return {meta:{changes:0}};
    active=true;return {meta:{changes:1}};
   }}}};
   if(sql.startsWith('SELECT channel_id,channel_title FROM oauth_channel'))return {bind(id){return {first:async()=>active?{channel_id:id,channel_title:'Owner channel'}:null}}};
   throw Error('Unexpected query '+sql);
  }
 };
 const now=Math.floor(Date.now()/1000);
 const first=await TEST.activateChannel(db,'UC1234567890',now);
 assert.deepEqual(first,{channel_id:'UC1234567890',channel_title:'Owner channel'});
 assert.equal(await TEST.activateChannel(db,'UC1234567890',now),null);
 assert.equal(updates,2);
});
test('expired Google state shows a recoverable message without network or video edits',async()=>{
 const env=readyEnv();
 let anyWrite=false;
 env.YTDB={
  prepare(sql){
   if(sql.startsWith('SELECT expires_at FROM oauth_admin_sessions'))return {bind(){return {first:async()=>({expires_at:Math.floor(Date.now()/1000)+500})}}};
   if(sql.startsWith('SELECT code_verifier FROM oauth_attempts'))return {bind(){return {first:async()=>null}}};
   anyWrite=true;
   throw Error('Unexpected state modification');
  }
 };
 const admin='__Host-ihyt_admin='+'a'.repeat(50),bind='ihyt_bind='+'b'.repeat(50);
 const r=await worker.fetch(request('/oauth/callback?state=mock-state&code=mock-google-code',{
  headers:{cookie:admin+'; '+bind}
 }),env);
 assert.equal(r.status,403);
 const page=await r.text();
 assert.match(page,/caducado o ya se ha utilizado/);
 assert.match(page,/Volver al inicio/);
 assert.equal(anyWrite,false);
});
test('callback database exception reveals only phase identifier and no OAuth secret',async()=>{
 const env=readyEnv();
 env.YTDB={
  prepare(sql){
   if(sql.startsWith('SELECT expires_at FROM oauth_admin_sessions'))return {bind(){return {first:async()=>({expires_at:Math.floor(Date.now()/1000)+300})}}};
   if(sql.startsWith('SELECT code_verifier FROM oauth_attempts'))return {bind(){return {first:async()=>{throw Error('Sensitive SQL details would never be sent to visitor');}}}};
   throw Error('Unexpected DB operation');
  }
 };
 const r=await worker.fetch(request('/oauth/callback?state=dummy-state&code=top-secret-oauth-code',{
  headers:{cookie:'__Host-ihyt_admin='+'a'.repeat(50)+'; ihyt_bind='+'b'.repeat(50)}
 }),env);
 assert.equal(r.status,503);
 const body=await r.text();
 assert.match(body,/GOOGLE_STATE_CHECK/);
 assert.doesNotMatch(body,/top-secret-oauth-code|Sensitive SQL details|refresh_token/);
});
