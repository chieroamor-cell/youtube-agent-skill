import assert from 'node:assert/strict';
import {test} from 'node:test';
import {safeThumbnailTitle,makeThumbnailHTML,renderThumbnail} from './thumbnail.mjs';
const draft={video_id:'abcdefghijk',original_title:'The Amazing Story of a Video Game Company',proposed_title:'Original title',duration_seconds:520};
test('thumbnail HTML includes only verified original title and brand',()=>{
 const h=makeThumbnailHTML(draft);
 assert.match(h,/1280px/);assert.match(h,/720px/);
 assert.match(h,/THE AMAZING STORY OF A VIDEO GAME COMPANY/i);
 assert.match(h,/INFAMOUSHUB/);
 assert.doesNotMatch(h,/script src|fonts\.google|i\.ytimg/);
});
test('HTML injection in video metadata is escaped',()=>{
 const h=makeThumbnailHTML({...draft,original_title:'A <img src=x onerror=1> & danger'});
 assert.match(h,/&lt;img src=x onerror=1&gt; &amp; danger/);
 assert.doesNotMatch(h,/<img/);
});
test('invalid ID or title rejected',()=>{
 assert.throws(()=>makeThumbnailHTML({...draft,video_id:'../evil'}),/invalid_video_id/);
 assert.throws(()=>makeThumbnailHTML({...draft,original_title:'x'}),/invalid_title/);
});
test('long title is truncated without inventing words',()=>{
 assert.ok(safeThumbnailTitle({...draft,original_title:'History '.repeat(12)}).length<=72);
});
test('missing Browser Run binding fails safely',async()=>{
 assert.deepEqual(await renderThumbnail({},draft),{ok:false,reason:'browser_not_enabled'});
});
test('a real JPEG response is required',async()=>{
 const bytes=new Uint8Array(7000);bytes[0]=255;bytes[1]=216;
 let calls=0;
 const x=await renderThumbnail({BROWSER:{async quickAction(name,options){
  calls++;assert.equal(name,'screenshot');assert.equal(options.viewport.width,1280);
  assert.equal(options.viewport.height,720);assert.equal(options.screenshotOptions.type,'jpeg');
  return new Response(bytes,{headers:{'content-type':'image/jpeg'}});
 }}},draft);
 assert.equal(calls,1);assert.equal(x.ok,true);assert.equal(x.size,7000);
 assert.match(x.downloadName,/abcdefghijk\.jpg/);
});
test('browser failures never serve content',async()=>{
 assert.deepEqual(await renderThumbnail({BROWSER:{quickAction:async()=>{throw Error('PRIVATE data');}}},draft),{ok:false,reason:'render_failed'});
 assert.deepEqual(await renderThumbnail({BROWSER:{quickAction:async()=>new Response('invalid',{headers:{'content-type':'text/plain'}})}},draft),{ok:false,reason:'invalid_browser_response'});
});
