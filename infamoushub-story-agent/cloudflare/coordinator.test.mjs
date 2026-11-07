import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker, { testAPI } from './coordinator.mjs';
const request=(path,opts={})=>new Request('https://worker.example'+path,opts);
test('health never enables rendering or publication',async()=>{
 const r=await worker.fetch(request('/health'),{SCHEDULE_ENABLED:'NO'});
 const json=await r.json();
 assert.equal(r.status,200);assert.equal(json.publishing,'disabled');assert.equal(json.scheduling,'disabled');
});
test('default disabled scheduler does not read database',async()=>{
 const r=await testAPI.enqueue({SCHEDULE_ENABLED:'NO',DB:{prepare(){throw Error('Unexpected DB')}}},Date.now());
 assert.deepEqual(r,{action:'disabled'});
});
test('only Tuesday and Friday are scheduled',()=>{
 assert.equal(testAPI.scheduledDay('2026-11-10T09:00:00Z'),true);
 assert.equal(testAPI.scheduledDay('2026-11-13T09:00:00Z'),true);
 assert.equal(testAPI.scheduledDay('2026-11-12T09:00:00Z'),false);
 assert.equal(testAPI.slotId('2026-11-10T09:00:00Z'),'story-2026-11-10');
});
test('requests without a configured token are unauthorized',async()=>{
 const r=await worker.fetch(request('/v1/jobs',{headers:{authorization:'Bearer bad'}}),{DB:{}});
 assert.equal(r.status,401);
});
test('an insecure short token is always rejected',async()=>{
 const r=await worker.fetch(request('/v1/jobs',{headers:{authorization:'Bearer insecure'}}),{DB:{},RENDERER_TOKEN:'insecure'});
 assert.equal(r.status,401);
});
test('publishing cannot be reported as completed',async()=>{
 const token='x'.repeat(40);
 const r=await worker.fetch(request('/v1/report',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({id:'story-2026-11-10',lease_id:'abc',state:'published'})}),{DB:{},RENDERER_TOKEN:token});
 assert.equal(r.status,400);assert.equal((await r.json()).error,'invalid_state');
});
test('video shorter than 8 minutes fails before DB usage',async()=>{
 const token='x'.repeat(40);
 const r=await worker.fetch(request('/v1/report',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({id:'story-2026-11-10',lease_id:'abc',state:'rendered',duration_seconds:45})}),{DB:{},RENDERER_TOKEN:token});
 assert.equal(r.status,400);assert.equal((await r.json()).error,'duration_gate');
});
test('unknown endpoints reveal no secrets',async()=>{
 const r=await worker.fetch(request('/internal'),{});
 assert.equal(r.status,404);
});