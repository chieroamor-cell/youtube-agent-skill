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
    if(sql.includes('FROM oauth_channel'))return db.channels[0]||null;
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


test('simulated Google callback stores encrypted token pending and confirms only the owner channel',async()=>{
 const env=readyEnv(),channelId='UC'+'x'.repeat(20);
 env.OAUTH_TOKEN_KEY_B64=Buffer.alloc(32,19).toString('base64');
 const record={status:null,channel_id:null,title:null,iv:null,cipher:null};
 let consumed=0,networkCalls=0;
 env.YTDB={
  prepare(sql){
   const operation=(...args)=>({
    async first(){
     if(sql.startsWith('SELECT expires_at FROM oauth_admin_sessions'))return {expires_at:Math.floor(Date.now()/1000)+500};
     if(sql.startsWith('SELECT code_verifier FROM oauth_attempts'))return consumed?null:{code_verifier:'mock-valid-pkce-verifier'};
     if(sql.startsWith('SELECT status FROM oauth_channel'))return record.status?{status:record.status}:null;
     if(sql.startsWith('SELECT channel_id,channel_title FROM oauth_channel'))return record.status==='active'?{channel_id:channelId,channel_title:'Mock Official Channel'}:null;
     throw Error('Unexpected SELECT: '+sql);
    },
    async run(){
     if(sql.startsWith('DELETE FROM oauth_attempts')){consumed++;return {meta:{changes:consumed===1?1:0}};}
     if(sql.startsWith('INSERT OR REPLACE INTO oauth_channel')){
      assert.equal(args.length,5);
      [record.channel_id,record.title,record.iv,record.cipher]=args;
      record.status='pending';return {meta:{changes:1}};
     }
     if(sql.startsWith('UPDATE oauth_channel SET status=')){
      if(record.status!=='pending'||args[0]!==record.channel_id)return {meta:{changes:0}};
      record.status='active';return {meta:{changes:1}};
     }
     throw Error('Unexpected write: '+sql);
    }
   });
   return {bind(...args){return operation(...args);},first:()=>operation().first()};
  }
 };
 const savedFetch=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  networkCalls++;
  assert.equal(opts?.redirect,'manual','Cloudflare Workers does not support redirect:error');
  if(String(url)==='https://oauth2.googleapis.com/token')
   return new Response(JSON.stringify({access_token:'mock-access-token',refresh_token:'mock-refresh-token'}),{status:200,headers:{'content-type':'application/json'}});
  if(String(url).startsWith('https://www.googleapis.com/youtube/v3/channels?'))
   return new Response(JSON.stringify({items:[{id:channelId,snippet:{title:'Mock Official Channel'}}]}),{status:200,headers:{'content-type':'application/json'}});
  throw Error('Unexpected external request: '+url);
 };
 try{
  const cookie='__Host-ihyt_admin='+'a'.repeat(52)+'; ihyt_bind='+'b'.repeat(52);
  const response=await worker.fetch(request('/oauth/callback?state=mock-state&code=mock-oauth-code',{headers:{cookie}}),env);
  const body=await response.text();
  assert.equal(response.status,200,body);
  assert.equal(networkCalls,2);
  assert.equal(record.channel_id,channelId);
  assert.equal(record.status,'pending');
  assert.equal(consumed,1);
  assert.ok(record.cipher&&record.cipher.length>16);
  assert.ok(record.iv&&record.iv.length>10);
  assert.notEqual(record.cipher,'mock-refresh-token');
  assert.doesNotMatch(body,/mock-refresh-token|mock-access-token|mock-oauth-code/);
  assert.match(body,/Mock Official Channel/);
  const csrf=body.match(/name="csrf" value="([^"]+)"/)?.[1];
  const cookies=response.headers.getSetCookie();
  const csrfCookie=cookies.find(x=>x.startsWith('__Host-ihyt_csrf='))?.split(';')[0];
  assert.ok(csrfCookie&&csrf);
  const confirm=await worker.fetch(request('/oauth/confirm',{
   method:'POST',headers:{cookie:'__Host-ihyt_admin='+'a'.repeat(52)+'; '+csrfCookie,'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({csrf,channel:channelId})
  }),env);
  assert.equal(confirm.status,200,await confirm.clone().text());
  assert.equal(record.status,'active');
  const again=await worker.fetch(request('/oauth/confirm',{
   method:'POST',headers:{cookie:'__Host-ihyt_admin='+'a'.repeat(52)+'; '+csrfCookie,'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({csrf,channel:channelId})
  }),env);
  assert.equal(again.status,409,'A second confirmation must fail');
 }finally{globalThis.fetch=savedFetch;}
});


test('Google OAuth token endpoint never follows HTTP redirects with sensitive credentials',async()=>{
 const env=readyEnv();
 let used=0,redirectRequest=false;
 env.YTDB={
  prepare(sql){
   if(sql.startsWith('SELECT expires_at FROM oauth_admin_sessions'))return {bind(){return {first:async()=>({expires_at:Math.floor(Date.now()/1000)+500})}}};
   if(sql.startsWith('SELECT code_verifier FROM oauth_attempts'))return {bind(){return {first:async()=>({code_verifier:'mock-code-verifier'})}}};
   if(sql.startsWith('DELETE FROM oauth_attempts'))return {bind(){return {run:async()=>({meta:{changes:1}})}}};
   throw Error('Unexpected SQL: '+sql);
  }
 };
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
   used++;
   assert.equal(String(url),'https://oauth2.googleapis.com/token');
   assert.equal(opts.redirect,'manual');
   redirectRequest=true;
   return new Response(null,{status:302,headers:{location:'https://unexpected.example/steal-credentials'}});
 };
 try{
  const r=await worker.fetch(request('/oauth/callback?state=mock-state&code=mock-auth-code',{
   headers:{cookie:'__Host-ihyt_admin='+'a'.repeat(50)+'; ihyt_bind='+'b'.repeat(50)}
  }),env);
  assert.equal(r.status,502);
  assert.match(await r.text(),/redirección inesperada/);
  assert.equal(used,1,'Should not fetch a redirect target');
  assert.equal(redirectRequest,true);
 }finally{globalThis.fetch=original;}
});
test('An invalid Google authorization response gives a recoverable 502, not an internal exception',async()=>{
 const env=readyEnv();
 env.YTDB={
  prepare(sql){
   if(sql.startsWith('SELECT expires_at FROM oauth_admin_sessions'))return {bind(){return {first:async()=>({expires_at:Math.floor(Date.now()/1000)+500})}}};
   if(sql.startsWith('SELECT code_verifier FROM oauth_attempts'))return {bind(){return {first:async()=>({code_verifier:'mock-code-verifier'})}}};
   if(sql.startsWith('DELETE FROM oauth_attempts'))return {bind(){return {run:async()=>({meta:{changes:1}})}}};
   throw Error('Unexpected SQL: '+sql);
  }
 };
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{
  assert.equal(opts.redirect,'manual');
  return new Response(JSON.stringify({error:'invalid_grant'}),{status:400,headers:{'content-type':'application/json'}});
 };
 try{
  const r=await worker.fetch(request('/oauth/callback?state=mock-state&code=mock-auth-code',{
   headers:{cookie:'__Host-ihyt_admin='+'a'.repeat(50)+'; ihyt_bind='+'b'.repeat(50)}
  }),env);
  assert.equal(r.status,502);
  const body=await r.text();
  assert.match(body,/Google rechazó el intercambio/);
  assert.doesNotMatch(body,/mock-auth-code|mock-code-verifier|invalid_grant/);
 }finally{globalThis.fetch=original;}
});


test('read-only verification rejects unauthenticated visitors before accessing any tokens',async()=>{
 const env=readyEnv();
 env.YTDB={prepare(){throw Error('No database should be touched without an admin cookie');}};
 const r=await worker.fetch(request('/channel/verify'),env);
 assert.equal(r.status,401);
 assert.match(await r.text(),/Sesión caducada/);
});
test('read-only verification decrypts refresh token, checks owner ID, and calls Google safely',async()=>{
 const channel='UC'+'r'.repeat(22),testRefresh='completely-fake-refresh-token-for-tests';
 const keybytes=Buffer.alloc(32,27);
 const k=await crypto.subtle.importKey('raw',keybytes,'AES-GCM',false,['encrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(channel)},k,new TextEncoder().encode(testRefresh));
 const b64=u=>Buffer.from(u).toString('base64url');
 const fakeRow={channel_id:channel,channel_title:'Test channel',status:'active',token_iv:b64(iv),token_ct:b64(new Uint8Array(cipher))};
 const env=readyEnv();
 env.OAUTH_TOKEN_KEY_B64=keybytes.toString('base64');
 env.YTDB={prepare(sql){
  assert.match(sql,/SELECT channel_id,channel_title,status,token_iv,token_ct/);
  return {first:async()=>fakeRow};
 }};
 let requests=0;const prior=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  requests++;assert.equal(options.redirect,'manual');
  if(requests===1){
   assert.equal(String(url),'https://oauth2.googleapis.com/token');
   const params=new URLSearchParams(options.body.toString());
   assert.equal(params.get('grant_type'),'refresh_token');
   assert.equal(params.get('refresh_token'),testRefresh);
   return Response.json({access_token:'fake-current-access-token'});
  }
  assert.equal(requests,2);
  assert.match(String(url),/^https:\/\/www\.googleapis\.com\/youtube\/v3\/channels\?/);
  assert.equal(options.headers.authorization,'Bearer fake-current-access-token');
  return Response.json({items:[{id:channel,snippet:{title:'Test channel from Google'},statistics:{videoCount:'42'}}]});
 };
 try{
  const result=await TEST.verifyChannelReadOnly(env);
  assert.equal(result.ok,true);
  assert.equal(result.channel.id,channel);
  assert.equal(result.channel.name,'Test channel from Google');
  assert.equal(result.channel.video_count,42);
  assert.equal(result.write_enabled,false);
  assert.equal(result.privacy_changes_enabled,false);
  assert.equal(requests,2);
 }finally{globalThis.fetch=prior;}
});
test('verified channel must match authorized channel ID',async()=>{
 const authorized='UC'+'x'.repeat(22),wrong='UC'+'y'.repeat(22),refresh='dummy-test-token';
 const raw=Buffer.alloc(32,20),iv=crypto.getRandomValues(new Uint8Array(12));
 const k=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const c=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(authorized)},k,new TextEncoder().encode(refresh));
 const env=readyEnv();
 env.OAUTH_TOKEN_KEY_B64=raw.toString('base64');
 env.YTDB={prepare(){return {first:async()=>({channel_id:authorized,channel_title:'Original',token_iv:Buffer.from(iv).toString('base64url'),token_ct:Buffer.from(c).toString('base64url')})};}};
 const prior=globalThis.fetch;
 let called=0;
 globalThis.fetch=async()=>{
  called++;return called===1?Response.json({access_token:'test'}):Response.json({items:[{id:wrong,snippet:{title:'Wrong channel'}}]});
 };
 try{
  const result=await TEST.verifyChannelReadOnly(env);
  assert.equal(result.ok,false);
  assert.equal(result.kind,'channel_mismatch');
  assert.equal(called,2);
 }finally{globalThis.fetch=prior;}
});
test('read-only verification refuses OAuth redirects and never follows tokens',async()=>{
 const channel='UC'+'p'.repeat(22),raw=Buffer.alloc(32,11),iv=crypto.getRandomValues(new Uint8Array(12));
 const k=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(channel)},k,new TextEncoder().encode('fake-refresh'));
 const env=readyEnv();env.OAUTH_TOKEN_KEY_B64=raw.toString('base64');
 env.YTDB={prepare(){return {first:async()=>({channel_id:channel,channel_title:'Original',token_iv:Buffer.from(iv).toString('base64url'),token_ct:Buffer.from(cipher).toString('base64url')})};}};
 const prior=globalThis.fetch;let calls=0;
 globalThis.fetch=async(u,opt)=>{calls++;assert.equal(opt.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://evil.invalid/steal'}});};
 try{
  const result=await TEST.verifyChannelReadOnly(env);
  assert.equal(result.ok,false);
  assert.equal(result.kind,'unexpected_google_redirect');
  assert.equal(calls,1);
 }finally{globalThis.fetch=prior;}
});


test('long-form video duration parses safely and excludes invalid durations',()=>{
 assert.equal(TEST.safeDuration('PT10M20S'),620);
 assert.equal(TEST.safeDuration('PT2M59S'),179);
 assert.equal(TEST.safeDuration('PT4M'),240);
 assert.equal(TEST.safeDuration('PT1H20M'),4800);
 assert.equal(TEST.safeDuration('PT-10M'),0);
 assert.equal(TEST.safeDuration('a video'),0);
 assert.equal(TEST.safeDuration('PT'),0);
});
test('anonymous users cannot list channel uploads',async()=>{
 const env=readyEnv();
 env.YTDB={prepare(){throw Error('unauthorized user cannot query D1 video tokens');}};
 const r=await worker.fetch(request('/channel/videos'),env);
 assert.equal(r.status,401);
 assert.match(await r.text(),/Sesión caducada/);
});
test('channel listing verifies owner, excludes Shorts and never makes video writes',async()=>{
 const own='UC'+'q'.repeat(22),raw=Buffer.alloc(32,71);
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const cipher=await crypto.subtle.encrypt(
  {name:'AES-GCM',iv,additionalData:new TextEncoder().encode(own)},
  key,new TextEncoder().encode('test-only-refresh-token'));
 const env=readyEnv();env.OAUTH_TOKEN_KEY_B64=raw.toString('base64');
 const stored={channel_id:own,token_iv:Buffer.from(iv).toString('base64url'),token_ct:Buffer.from(cipher).toString('base64url')};
 env.YTDB={prepare(sql){
  assert.match(sql,/SELECT channel_id,token_iv,token_ct/);
  return {first:async()=>stored};
 }};
 let calls=0;
 const original=globalThis.fetch;
 globalThis.fetch=async(url,opt)=>{
  calls++;
  assert.equal(opt.redirect,'manual','No OAuth credential may follow an HTTP redirect');
  if(calls===1){
   assert.equal(url,'https://oauth2.googleapis.com/token');
   return Response.json({access_token:'synthetic-access-token'});
  }
  assert.equal(opt.method,'GET','YouTube API is strictly read-only');
  assert.equal(opt.headers.authorization,'Bearer synthetic-access-token');
  if(calls===2)return Response.json({items:[{id:own,contentDetails:{relatedPlaylists:{uploads:'UUtestPlaylist'}}}]});
  if(calls===3)return Response.json({items:[{contentDetails:{videoId:'abcdefghijk'}},{contentDetails:{videoId:'lmnopqrstuv'}},{contentDetails:{videoId:'12345678901'}}]});
  if(calls===4)return Response.json({items:[
   {id:'abcdefghijk',snippet:{channelId:own,title:'Our long story',publishedAt:'2026-11-08T13:00:00Z'},status:{privacyStatus:'private'},contentDetails:{duration:'PT8M25S'}},
   {id:'lmnopqrstuv',snippet:{channelId:own,title:'Our Shorts clip'},status:{privacyStatus:'public'},contentDetails:{duration:'PT59S'}},
   {id:'12345678901',snippet:{channelId:'UCwrongchannel',title:'Someone else'},contentDetails:{duration:'PT9M'}}
  ]});
  throw Error('Unexpected extra request');
 };
 try{
  const result=await TEST.listOwnerUploads(env);
  assert.equal(result.ok,true,JSON.stringify(result));
  assert.equal(result.checked,2);
  assert.equal(result.long_videos.length,1);
  assert.equal(result.long_videos[0].title,'Our long story');
  assert.equal(result.long_videos[0].privacy,'private');
  assert.equal(result.long_videos[0].seconds,505);
  assert.equal(result.excluded_short,1);
  assert.equal(result.total_seen,3);
  assert.equal(result.read_only,true);
  assert.equal(calls,4);
 }finally{globalThis.fetch=original;}
});
test('listing rejects a YouTube channel different from the owner',async()=>{
 const own='UC'+'b'.repeat(22),raw=Buffer.alloc(32,21),iv=crypto.getRandomValues(new Uint8Array(12));
 const k=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);
 const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(own)},k,new TextEncoder().encode('fake-refresh'));
 const env=readyEnv();env.OAUTH_TOKEN_KEY_B64=raw.toString('base64');
 env.YTDB={prepare(){return {first:async()=>({channel_id:own,token_iv:Buffer.from(iv).toString('base64url'),token_ct:Buffer.from(cipher).toString('base64url')})};}};
 const prior=globalThis.fetch;
 let requests=0;
 globalThis.fetch=async()=>{
  requests++;
  if(requests===1)return Response.json({access_token:'dummy'});
  if(requests===2)return Response.json({items:[{id:'UCwrongowner',contentDetails:{relatedPlaylists:{uploads:'UUwrong'}}}]});
  throw Error('Must not inspect another user playlist');
 };
 try{
  const result=await TEST.listOwnerUploads(env);
  assert.equal(result.ok,false);
  assert.equal(result.kind,'owner_playlist_not_found');
  assert.equal(requests,2);
 }finally{globalThis.fetch=prior;}
});


test('already-connected channel shows long-video link right after login, never new Google consent',async()=>{
 const env=readyEnv(),db=new InMemoryDB();
 const id='UC'+'c'.repeat(22);
 db.channels=[{channel_id:id,channel_title:'infamoushub <test>',status:'active'}];
 env.YTDB=db;
 const {code,cookie}=await extractCsrf(env);
 const r=await worker.fetch(request('/session/login',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','cookie':cookie,'origin':'null'},
  body:new URLSearchParams({csrf:code,code:env.OAUTH_ADMIN_CODE})
 }),env);
 assert.equal(r.status,200);
 const body=await r.text();
 assert.match(body,/Sesión iniciada/);
 assert.match(body,/\/channel\/videos/);
 assert.match(body,/\/channel\/verify/);
 assert.match(body,/infamoushub &lt;test&gt;/);
 assert.doesNotMatch(body,/<test>/);
 assert.doesNotMatch(body,/2. Conectar mi YouTube/);
 assert.doesNotMatch(body,/accounts\.google\.com/);
 const session=(r.headers.getSetCookie().find(c=>c.startsWith('__Host-ihyt_admin='))||'').split(';')[0];
 assert.ok(session);
 const home=await worker.fetch(request('/connect',{headers:{cookie:session}}),env);
 assert.equal(home.status,200);
 const content=await home.text();
 assert.match(content,/Ver mis vídeos largos/);
 assert.doesNotMatch(content,/2. Conectar mi YouTube/);
});


test('an unauthenticated user cannot submit a draft request for any video',async()=>{
 const env=readyEnv();
 env.YTDB={prepare(){throw Error('Owner session must be checked before any database operation');}};
 const r=await worker.fetch(request('/drafts/prepare',{
  method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({video_id:'abcdefghijk'})
 }),env);
 assert.equal(r.status,401);
 assert.match(await r.text(),/Sesión caducada/);
});


test('thumbnail preview refuses public visitors before inspecting any saved draft',async()=>{
 const env=readyEnv();
 env.YTDB={prepare(){throw Error('Anonymous user must not query database');}};
 const r=await worker.fetch(request('/drafts/thumbnail?video_id=abcdefghijk'),env);
 assert.equal(r.status,401);
 assert.match(await r.text(),/Sesión caducada/);
});
test('thumbnail preview is owner-bound and cannot use a different channels video',async()=>{
 const env=readyEnv();
 const owner='UC'+'x'.repeat(22);
 const session='__Host-ihyt_admin='+'a'.repeat(50);
 let calls=0;
 env.YTDB={prepare(sql){
  calls++;
  if(sql.startsWith('SELECT expires_at FROM oauth_admin_sessions'))
   return {bind(){return {first:async()=>({expires_at:Math.floor(Date.now()/1000)+300})}}};
  if(sql.startsWith('SELECT channel_id FROM oauth_channel'))
   return {first:async()=>({channel_id:owner})};
  if(sql.startsWith('SELECT d.video_id,d.channel_id,d.original_title,d.thumbnail_brief,d.thumbnail_headline,d.content_source,d.status,c.status AS caption_status'))
   return {bind(id,own){assert.equal(id,'abcdefghijk');assert.equal(own,owner);return {first:async()=>null}}};
  throw Error('Unrecognized SQL '+sql);
 }};
 const r=await worker.fetch(request('/drafts/thumbnail?video_id=abcdefghijk',{headers:{cookie:session}}),env);
 assert.equal(r.status,404);
 assert.match(await r.text(),/No hay propuesta/);
 assert.ok(calls>=3);
});


test('review and apply endpoints reject anonymous attempts without touching channel',async()=>{
 const env=readyEnv();
 env.YTDB={prepare(){throw Error('Never read D1 for anonymous reviews');}};
 for(const endpoint of ['/drafts/approve','/drafts/apply']){
  const r=await worker.fetch(request(endpoint,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({video_id:'abcdefghijk'})}),env);
  assert.equal(r.status,401,endpoint);
 }
});
test('reviewed private video changes cannot be applied until a separate writer flag is enabled',async()=>{
 const {env,sessionCookie,csrf,csrfCookie}=await loggedIn();
 const r=await worker.fetch(request('/drafts/apply',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded','origin':'null','cookie':sessionCookie+'; '+csrfCookie},
  body:new URLSearchParams({video_id:'abcdefghijk',confirm_private:'YES',csrf})
 }),env);
 assert.equal(r.status,403);
 const txt=await r.text();
 assert.match(txt,/escritura en YouTube sigue desactivada/);
 assert.doesNotMatch(txt,/access_token|client_secret/);
});


test('signed-in thumbnail endpoint streams a real JPEG only from an owner draft',async()=>{
 const env=readyEnv(),owner='UC'+'q'.repeat(22),id='abcdefghijk';
 const fakeJpeg=new Uint8Array(7200);fakeJpeg[0]=255;fakeJpeg[1]=216;
 env.YTDB={prepare(sql){
  if(sql.startsWith('SELECT expires_at FROM oauth_admin_sessions'))
   return {bind(){return {first:async()=>({expires_at:Math.floor(Date.now()/1000)+300})}}};
  if(sql.startsWith('SELECT channel_id FROM oauth_channel'))
   return {first:async()=>({channel_id:owner})};
  if(sql.startsWith('SELECT d.video_id,d.channel_id,d.original_title,d.thumbnail_brief,d.thumbnail_headline,d.content_source,d.status,c.status AS caption_status'))
   return {bind(vid,ch){assert.equal(vid,id);assert.equal(ch,owner);return {first:async()=>({video_id:id,channel_id:owner,original_title:'A Real Story About Games',status:'needs_review'})}}};
  throw Error('Unrecognized SQL '+sql);
 }};
 let screenshots=0;
 env.BROWSER={quickAction:async(name,o)=>{
  screenshots++;assert.equal(name,'screenshot');assert.equal(o.viewport.width,1280);assert.equal(o.viewport.height,720);
  return new Response(fakeJpeg,{headers:{'content-type':'image/jpeg'}});
 }};
 const orig=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('YouTube write API should not be called');};
 try{
  const r=await worker.fetch(request('/drafts/thumbnail?video_id=abcdefghijk',{
   headers:{cookie:'__Host-ihyt_admin='+'a'.repeat(50)}
  }),env);
  assert.equal(r.status,200,await r.clone().text().catch(()=>''));assert.equal(screenshots,1);
  assert.equal(r.headers.get('content-type'),'image/jpeg');
  assert.match(r.headers.get('content-disposition')||'',/infamoushub-abcdefghijk\.jpg/);
  assert.equal(r.headers.get('cache-control'),'no-store');
  const b=new Uint8Array(await r.arrayBuffer());assert.equal(b.length,7200);assert.equal(b[0],255);assert.equal(b[1],216);
 }finally{globalThis.fetch=orig;}
});


test('captions analysis dashboard requires owner session before any D1 query',async()=>{
 const env=readyEnv();
 env.YTDB={prepare(){throw Error('Anonymous client must never access private transcript');}};
 const r=await worker.fetch(request('/analysis/status'),env);
 assert.equal(r.status,401);
 assert.match(await r.text(),/Inicia sesión/);
});
test('caption dashboard hides full private content from untrusted visitors',async()=>{
 const env=readyEnv(),owner='UC'+'a'.repeat(22);
 env.YTDB={prepare(sql){
  if(sql.startsWith('SELECT expires_at FROM oauth_admin_sessions'))
   return {bind(){return {first:async()=>({expires_at:Math.floor(Date.now()/1000)+600})}}};
  if(sql.startsWith('SELECT channel_id FROM oauth_channel'))
   return {first:async()=>({channel_id:owner})};
  if(sql.startsWith('SELECT c.video_id,c.status'))
   return {bind(ch){assert.equal(ch,owner);return {all:async()=>({results:[{
    video_id:'abcdefghijk',status:'transcript_available',language:'en',
    excerpt_words:300,attempts:1,last_checked_at:'2026-11-09 06:00:00',
    privacy:'private',title:'Private <title>',excerpt:'This shows <script> not trusted'
   }]})}}};
  throw Error('Unexpected SQL: '+sql);
 }};
 const r=await worker.fetch(request('/analysis/status',{headers:{cookie:'__Host-ihyt_admin='+'a'.repeat(50)}}),env);
 assert.equal(r.status,200);
 const html=await r.text();
 assert.match(html,/Private &lt;title&gt;/);
 assert.match(html,/This shows &lt;script&gt; not trusted/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/transcript_available/);
 assert.equal(r.headers.get('cache-control'),'no-store');
});


test('manual captions check requires an authenticated admin session',async()=>{
 const env=readyEnv();
 env.YTDB={prepare(){throw Error('Anonymous access must not touch owner data');}};
 const r=await worker.fetch(request('/analysis/check',{
  method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({csrf:'anything'})
 }),env);
 assert.equal(r.status,401);
});
test('signed-in captions check fails closed when disabled, without touching YouTube',async()=>{
 const {env,sessionCookie,csrf,csrfCookie}=await loggedIn();
 env.CAPTION_INSPECTION='NO';
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw Error('Do not contact YouTube when caption checking is disabled');};
 try{
  const r=await worker.fetch(request('/analysis/check',{
   method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',
    cookie:sessionCookie+'; '+csrfCookie,'origin':'null'},
   body:new URLSearchParams({csrf})
  }),env);
  assert.equal(r.status,200);
  assert.match(await r.text(),/disabled/);
 }finally{globalThis.fetch=original;}
});
