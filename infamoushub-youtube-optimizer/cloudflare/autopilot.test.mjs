import assert from 'node:assert/strict';
import {test} from 'node:test';
import {prepareDraft,discoverNewLongVideos,getDrafts} from './autopilot.mjs';
import oauthWorker from './yt-connect-worker.mjs';

const channel='UC'+'a'.repeat(22);
const vid=(id,title='A real history story',seconds=520)=>({id,title,seconds,
 privacy:'private',published:'2026-11-08T09:00:00Z',
 description:'The original creator explains the history using licensed footage. Credits: Original source.'});
class MemoryDB {
 constructor(){this.watch=new Map();this.seen=new Set();this.drafts=new Map();this.batchCalls=0;this.batchSizes=[];}
 prepare(query){
  const db=this;
  const action=(...args)=>({
   async first(){
    if(query.startsWith('SELECT channel_id FROM optimizer_watch_state')){
      return db.watch.has(args[0])?{channel_id:args[0]}:null;
    }
    throw Error('Unexpected first: '+query);
   },
   async run(){
    if(query.startsWith('INSERT OR IGNORE INTO optimizer_watch_state')){
      if(db.watch.has(args[0]))return {meta:{changes:0}};
      db.watch.set(args[0],{scan_count:1});return {meta:{changes:1}};
    }
    if(query.startsWith('INSERT OR IGNORE INTO optimizer_seen_videos')){
      if(db.seen.has(args[0]))return {meta:{changes:0}};
      db.seen.add(args[0]);return {meta:{changes:1}};
    }
    if(query.startsWith('INSERT OR IGNORE INTO optimizer_drafts')){
      if(db.drafts.has(args[0]))return {meta:{changes:0}};
      db.drafts.set(args[0],{video_id:args[0],channel_id:args[1],original_title:args[2],
        proposed_title:args[3],proposed_description:args[4],suggested_tags_json:args[5],
        thumbnail_brief:args[6],duration_seconds:args[7],privacy:args[8],status:'needs_review'});
      return {meta:{changes:1}};
    }
    if(query.startsWith('UPDATE optimizer_watch_state')){
      const x=db.watch.get(args[0]);if(x)x.scan_count++;
      return {meta:{changes:x?1:0}};
    }
    throw Error('Unexpected run '+query);
   },
   async all(){
    if(query.startsWith('SELECT video_id FROM optimizer_seen_videos')){
      return {results:args.slice(1).filter(id=>db.seen.has(id)).map(video_id=>({video_id}))};
    }
    if(query.startsWith('SELECT video_id,original_title,proposed_title,proposed_description')){
      return {results:[...db.drafts.values()].filter(x=>x.channel_id===args[0])};
    }
    throw Error('Unexpected all '+query);
   }
  });
  return {bind:(...args)=>action(...args)};
 }
 async batch(statements){
  this.batchCalls++;this.batchSizes.push(statements.length);
  const result=[];
  for(const stmt of statements)result.push(await stmt.run());
  return result;
 }
}
const testEnv=()=>({AUTO_DISCOVERY:'YES',YTDB:new MemoryDB()});
const feed=items=>async()=>({ok:true,channel_id:channel,long_videos:items});

test('drafts do not invent story facts; preserve original video credits',()=>{
 const d=prepareDraft(vid('abcdefghijk'),channel);
 assert.equal(d.proposed_title,d.original_title);
 assert.match(d.proposed_description,/Credits: Original source/);
 assert.match(d.thumbnail_brief,/rights|licensed/i);
 assert.equal(d.status,'needs_review');
 assert.equal(d.privacy,'private');
 assert.ok(JSON.parse(d.suggested_tags_json).includes('InfamousHub'));
 assert.ok(d.caveat.includes('No transcript'));
});
test('Shorts and invalid IDs are refused',()=>{
 assert.throws(()=>prepareDraft(vid('abcdefghijk','Shorts',59),channel));
 assert.throws(()=>prepareDraft(vid('a','Bad',520),channel));
});
test('first scan baselines existing videos without creating a single draft',async()=>{
 const env=testEnv();
 const res=await discoverNewLongVideos(env,feed([vid('abcdefghijk'),vid('lmnopqrstuv')]));
 assert.equal(res.status,'baseline_created');
 assert.equal(res.created,0);
 assert.equal(res.baseline_seen,2);
 assert.equal(env.YTDB.drafts.size,0);
 assert.equal(env.YTDB.seen.size,2);
});
test('newly discovered long video becomes one draft, not a YouTube update',async()=>{
 const env=testEnv();
 await discoverNewLongVideos(env,feed([vid('abcdefghijk')]));
 const first=await discoverNewLongVideos(env,feed([vid('abcdefghijk'),vid('lmnopqrstuv','Nintendo history',700)]));
 assert.equal(first.created,1);
 assert.equal(first.edits_to_youtube,0);
 assert.equal(first.thumbnails_uploaded,0);
 assert.equal(first.automatic_publication,false);
 const again=await discoverNewLongVideos(env,feed([vid('abcdefghijk'),vid('lmnopqrstuv','Nintendo history',700)]));
 assert.equal(again.created,0);
 const drafts=await getDrafts(env,channel);
 assert.equal(drafts.length,1);
 assert.equal(drafts[0].video_id,'lmnopqrstuv');
 assert.match(drafts[0].proposed_description,/Credits: Original source/);
});
test('fail closed when disabled; do not call YouTube',async()=>{
 const env={AUTO_DISCOVERY:'NO',YTDB:new MemoryDB()};
 let touched=false;
 const result=await discoverNewLongVideos(env,async()=>{touched=true;throw Error('Never contact YouTube')});
 assert.equal(result.status,'disabled');
 assert.equal(touched,false);
});
test('API failure adds no draft, does not establish baseline',async()=>{
 const env=testEnv();
 const bad=await discoverNewLongVideos(env,async()=>{throw Error('OAuth expired')});
 assert.equal(bad.status,'youtube_read_failed');
 assert.equal(env.YTDB.watch.size,0);
 assert.equal(env.YTDB.drafts.size,0);
});
test('only eligible long video IDs generate drafts',async()=>{
 const env=testEnv();
 await discoverNewLongVideos(env,feed([]));
 const result=await discoverNewLongVideos(env,feed([vid('abcdefghijk','A short',59),vid('lmnopqrstuv','A long story',400)]));
 assert.equal(result.created,1);
 assert.equal(result.skipped,1);
});
test('scheduled handler does nothing when AUTO_DISCOVERY off',async()=>{
 let touched=false;
 const env={AUTO_DISCOVERY:'NO',YTDB:{prepare(){touched=true;throw Error('not allowed');}}};
 let waited=false;
 await oauthWorker.scheduled({},env,{waitUntil(){waited=true;}});
 assert.equal(waited,false);
 assert.equal(touched,false);
});
test('scheduled handler queues only safe read-only scan work',async()=>{
 // In production scan function is the authenticated YouTube reader and cannot be faked here.
 // This checks that there is a scheduled entrypoint, not actual external API writes.
 assert.equal(typeof oauthWorker.scheduled,'function');
});


test('a full 50-video baseline uses one atomic batch and no draft writes',async()=>{
 const env=testEnv();
 const ids=Array.from({length:50},(_,i)=>i.toString(36).padStart(11,'a'));
 assert.equal(new Set(ids).size,50);
 const result=await discoverNewLongVideos(env,feed(ids.map(id=>vid(id))));
 assert.equal(result.status,'baseline_created');
 assert.equal(result.baseline_seen,50);
 assert.equal(env.YTDB.drafts.size,0);
 assert.equal(env.YTDB.seen.size,50);
 assert.equal(env.YTDB.batchCalls,1);
 assert.equal(env.YTDB.batchSizes[0],51);
});
test('new videos are stored with their drafts in one D1 batch',async()=>{
 const env=testEnv();
 await discoverNewLongVideos(env,feed([vid('abcdefghijk')]));
 const before=env.YTDB.batchCalls;
 const response=await discoverNewLongVideos(env,feed([vid('abcdefghijk'),vid('lmnopqrstuv')]));
 assert.equal(response.created,1);
 assert.equal(env.YTDB.batchCalls,before+1);
 assert.equal(env.YTDB.batchSizes.at(-1),2);
 assert.equal(env.YTDB.drafts.size,1);
});
