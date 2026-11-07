/** InfamousHub Story Coordinator v0.2.0. Does NOT render/upload/publish. */
const VERSION='0.2.0';
const H={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const reply=(obj,status=200)=>new Response(JSON.stringify(obj),{status,headers:H});
async function secretOk(expected,given){
 if(typeof expected!=='string'||expected.length<32||typeof given!=='string')return false;
 const te=new TextEncoder();
 const a=new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(expected)));
 const b=new Uint8Array(await crypto.subtle.digest('SHA-256',te.encode(given)));
 let d=0;for(let i=0;i<a.length;i++)d|=a[i]^b[i];return d===0;
}
async function authorized(req,env){
 const h=req.headers.get('authorization')||'';
 return h.startsWith('Bearer ')&&await secretOk(env.RENDERER_TOKEN,h.slice(7));
}
function slotId(time){let d=new Date(time);if(!Number.isFinite(d.getTime()))throw Error('Bad date');return 'story-'+d.toISOString().slice(0,10);}
function scheduledDay(time){const day=new Date(time).getUTCDay();return day===2||day===5;}
async function enqueue(env,time){
 if(env.SCHEDULE_ENABLED!=='YES')return {action:'disabled'};
 if(!env.DB)return {action:'no_database'};
 if(!scheduledDay(time))return {action:'outside_schedule'};
 const due=new Date(time).toISOString(),id=slotId(time);
 const r=await env.DB.prepare("INSERT OR IGNORE INTO story_jobs (id,due_utc,state,updated_at) VALUES (?,?,'queued',datetime('now'))").bind(id,due).run();
 return {action:r.meta?.changes?'created':'already_exists',id};
}
async function claim(env){
 const now=Math.floor(Date.now()/1000),lease=crypto.randomUUID();
 return await env.DB.prepare("UPDATE story_jobs SET state='claimed',lease_id=?,lease_until=?,attempts=attempts+1,updated_at=datetime('now') WHERE id=(SELECT id FROM story_jobs WHERE (state='queued' OR (state='claimed' AND lease_until < ?)) AND attempts < 3 ORDER BY due_utc LIMIT 1) RETURNING id,due_utc,state,attempts,lease_id,lease_until").bind(lease,now+7200,now).first();
}
async function report(req,env){
 if(Number(req.headers.get('content-length')||0)>2048)return reply({error:'too_large'},413);
 let p;try{p=await req.json();}catch{return reply({error:'invalid_json'},400);}
 if(!/^story-\d{4}-\d{2}-\d{2}$/.test(p?.id||'')||typeof p.lease_id!=='string'||p.lease_id.length>80)return reply({error:'invalid_claim'},400);
 if(!['rendered','needs_review','failed'].includes(p.state))return reply({error:'invalid_state'},400);
 if(p.state==='rendered'&&!(Number.isFinite(p.duration_seconds)&&p.duration_seconds>=480&&p.duration_seconds<=720))return reply({error:'duration_gate'},400);
 if(p.state==='rendered'&&!/^[a-f0-9]{64}$/.test(p.result_sha256||''))return reply({error:'invalid_checksum'},400);
 const now=Math.floor(Date.now()/1000);
 const r=await env.DB.prepare("UPDATE story_jobs SET state=?,duration_seconds=?,result_sha256=?,lease_id=NULL,lease_until=NULL,updated_at=datetime('now') WHERE id=? AND lease_id=? AND state='claimed' AND lease_until>=? RETURNING id,state").bind(p.state,p.state==='rendered'?p.duration_seconds:null,p.state==='rendered'?p.result_sha256:null,p.id,p.lease_id,now).first();
 return r?reply({ok:true,job:r}):reply({error:'stale_or_invalid_claim'},409);
}
export default {
 async fetch(req,env){
  const path=new URL(req.url).pathname;
  if(req.method==='GET'&&(path==='/'||path==='/health'))return reply({service:'infamoushub-story-coordinator',version:VERSION,status:'staging',scheduling:env.SCHEDULE_ENABLED==='YES'?'enabled':'disabled',publishing:'disabled',renderer:'external_only'});
  if(!path.startsWith('/v1/'))return reply({error:'not_found'},404);
  if(!env.DB)return reply({error:'database_not_configured'},503);
  if(!await authorized(req,env))return reply({error:'unauthorized'},401);
  if(req.method==='GET'&&path==='/v1/jobs'){const r=await env.DB.prepare('SELECT id,due_utc,state,attempts,updated_at FROM story_jobs ORDER BY due_utc DESC LIMIT 20').all();return reply({jobs:r.results||[],publishing:'disabled'});}
  if(req.method==='POST'&&path==='/v1/claim'){const job=await claim(env);return job?reply({job}):new Response(null,{status:204,headers:H});}
  if(req.method==='POST'&&path==='/v1/report')return report(req,env);
  return reply({error:'not_found'},404);
 },
 async scheduled(event,env,ctx){ctx.waitUntil(enqueue(env,event.scheduledTime));}
};
export const testAPI={slotId,scheduledDay,enqueue,claim};