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
 assert.equal(response.status,200);
 assert.match(body,/Falta configurar y autorizar Google OAuth/);
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
  return {
   bind(...args){
    return {
     async first(){
      if(sql.includes('FROM oauth_admin_sessions'))return db.sessions.has(args[0])&&db.sessions.get(args[0])>=args[1]?{expires_at:db.sessions.get(args[0])}:null;
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
    };
   }
  };
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
 assert.equal(r.status,303);
 assert.equal(r.headers.get('location'),'/connect');
 const sessionCookie=(r.headers.get('set-cookie')||'').split(';')[0];
 assert.match(sessionCookie,/__Host-ihyt_admin=/);
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
