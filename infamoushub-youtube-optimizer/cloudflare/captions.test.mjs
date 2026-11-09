import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseVtt,readOwnerCaptionTrack,inspectNextVideoCaptions,writeCaptionAnalysis} from './captions.mjs';
const id='abcdefghijk',channel='UC7bPVW93xdIXPREbFoHXVrw';
test('VTT parser removes cue timecodes, repeated lines and HTML',()=>{
 const s='WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.000\n<v someone>Early Nintendo history</v>\n\n2\n00:00:02.000 --> 00:00:04.000\nEarly Nintendo history\n\n3\n00:00:04.000 --> 00:00:06.000\nMore <i>games</i> and &amp; stories';
 assert.equal(parseVtt(s),'Early Nintendo history More games and & stories');
});
test('read-only caption request checks owner video and never follows redirects',async()=>{
 const calls=[];
 const fn=async(url,opts)=>{
  calls.push({url:String(url),opts});
  assert.equal(opts.method,'GET');assert.equal(opts.redirect,'manual');
  assert.equal(opts.headers.authorization,'Bearer test-owned-token');
  if(calls.length===1)return Response.json({items:[
   {id:'track_mine',snippet:{videoId:id,status:'serving',language:'en',trackKind:'standard',isDraft:false}},
   {id:'track_other',snippet:{videoId:'wrongowner',status:'serving',language:'en',trackKind:'standard'}}
  ]});
  assert.match(String(url),/\/captions\/track_mine\?tfmt=vtt/);
  return new Response('WEBVTT\n00:00:00.000 --> 00:00:02.000\nThis gaming documentary explains how Nintendo started and grew beyond its first experiments. The company later became known for its distinctive consoles and characters.',{headers:{'content-type':'text/vtt'}});
 };
 const result=await readOwnerCaptionTrack(id,'test-owned-token',fn);
 assert.equal(result.status,'transcript_available');
 assert.equal(result.language,'en');
 assert.match(result.transcript_excerpt,/Nintendo started/);
 assert.equal(calls.length,2);
});
test('no captions never makes an expensive download request',async()=>{
 let calls=0;
 const result=await readOwnerCaptionTrack(id,'test-owned-token',async()=>{
  calls++;return Response.json({items:[]});
 });
 assert.equal(result.status,'no_captions');assert.equal(calls,1);
});
test('redirects and bad access fail closed without moving tokens',async()=>{
 let calls=0;
 const r=await readOwnerCaptionTrack(id,'test-owned-token',async(u,o)=>{
  calls++;return new Response(null,{status:302,headers:{location:'https://attacker.example/'}});
 });
 assert.equal(r.status,'redirect_blocked');assert.equal(calls,1);
});
test('automatic caption inspections stay disabled without explicit flag',async()=>{
 let calls=0;
 const result=await inspectNextVideoCaptions({CAPTION_INSPECTION:'NO'},async()=>{calls++;return null;});
 assert.deepEqual(result,{status:'disabled'});assert.equal(calls,0);
});
test('caption results are sanitized before D1 storage',async()=>{
 let args=[];
 const env={YTDB:{prepare(sql){
  assert.match(sql,/INSERT INTO optimizer_caption_analysis/);
  return {bind(...values){args=values;return {run:async()=>({meta:{changes:1}})}}};
 }}};
 await writeCaptionAnalysis(env,{video_id:id,channel_id:channel},{status:'transcript_available',language:'en',track_kind:'standard',transcript_excerpt:'a'.repeat(10000),excerpt_words:100});
 assert.equal(args[0],id);assert.equal(args[1],channel);assert.equal(args[5].length,4000);
});
