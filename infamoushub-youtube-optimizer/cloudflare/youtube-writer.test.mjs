import assert from 'node:assert/strict';
import {test} from 'node:test';
import {safeMetadataCandidate,guardedPrivateUpdate} from './youtube-writer.mjs';
const owner='UC'+'a'.repeat(22),id='abcdefghijk';
const video=()=>({id,snippet:{channelId:owner,title:'The True History of Early Video Games',description:'Historical footage credits: Original source.',categoryId:'24',tags:['History']},status:{privacyStatus:'private'},contentDetails:{duration:'PT8M30S'}});
const draft=()=>({video_id:id,channel_id:owner,original_title:'The True History of Early Video Games',proposed_title:'The True History of Early Video Games',alternate_title:'The Story Behind Early Video Games',proposed_description:'An overview of early gaming.',suggested_tags_json:'["History","Video games"]',privacy:'private',status:'needs_review'});
test('private-only candidate preserves credits and existing metadata',()=>{
 const r=safeMetadataCandidate(video(),draft(),owner);
 assert.equal(r.snippet.title,video().snippet.title);
 assert.match(r.snippet.description,/Historical footage credits/);
 assert.ok(r.snippet.tags.includes('History'));
 assert.ok(r.snippet.tags.includes('Video games'));
 assert.equal(r.snippet.categoryId,'24');
 assert.equal(r.id,id);
});
test('no false title or metadata applied to public or Short videos',()=>{
 let v=video();v.status.privacyStatus='public';
 assert.throws(()=>safeMetadataCandidate(v,draft(),owner),/not_private/);
 v=video();v.contentDetails.duration='PT59S';
 assert.throws(()=>safeMetadataCandidate(v,draft(),owner),/not_long_form/);
 v=video();v.snippet.channelId='UC'+'b'.repeat(22);
 assert.throws(()=>safeMetadataCandidate(v,draft(),owner),/channel_mismatch/);
});
test('changed title requires review again',()=>{
 const v=video();v.snippet.title='Updated by human creator';
 assert.throws(()=>safeMetadataCandidate(v,draft(),owner),/title_changed/);
});
test('alternative title is used only when expressly selected',()=>{
 assert.equal(safeMetadataCandidate(video(),draft(),owner).snippet.title,video().snippet.title);
 assert.equal(safeMetadataCandidate(video(),draft(),owner,{useAlternate:true}).snippet.title,'The Story Behind Early Video Games');
});
test('long original descriptions block unsafe loss of credits',()=>{
 const v=video();v.snippet.description='a'.repeat(4980);
 assert.throws(()=>safeMetadataCandidate(v,draft(),owner),/description_too_long/);
});
test('default and unapproved requests make ZERO external API calls',async()=>{
 let called=0;const fetchFn=async()=>{called++;throw Error('Do not call');};
 const x=await guardedPrivateUpdate({env:{},videoId:id,expectedChannel:owner,draft:draft(),accessToken:'a'.repeat(30),fetchFn});
 assert.equal(x.status,'disabled');assert.equal(called,0);
 const y=await guardedPrivateUpdate({env:{YOUTUBE_WRITE_ENABLED:'YES'},videoId:id,expectedChannel:owner,draft:draft(),accessToken:'a'.repeat(30),fetchFn});
 assert.equal(y.status,'requires_review');assert.equal(called,0);
});
test('full private-only test update with JPEG is gated and uses official Google API only',async()=>{
 const d=draft();d.status='approved';
 const urls=[],fakeJpeg=new Uint8Array(8000);fakeJpeg[0]=255;fakeJpeg[1]=216;
 const fetchFn=async(url,options)=>{
  urls.push([String(url),options.method,options.redirect]);
  if(options.method==='GET'&&String(url).includes('/channels?'))return Response.json({items:[{id:owner}]});
  if(options.method==='GET'&&String(url).includes('/videos?'))return Response.json({items:[video()]});
  if(options.method==='PUT'){
   assert.match(url,/^https:\/\/www\.googleapis\.com\/youtube\/v3\/videos\?/);
   assert.equal(JSON.parse(options.body).snippet.title,video().snippet.title);
   return Response.json({id});
  }
  if(options.method==='POST'){
   assert.match(url,/^https:\/\/www\.googleapis\.com\/upload\/youtube\/v3\/thumbnails\/set/);
   assert.equal(options.body.length,8000);
   return Response.json({items:[{default:{url:'https://i.ytimg.com/test'}}]});
  }
  throw Error('Unexpected API request');
 };
 const x=await guardedPrivateUpdate({env:{YOUTUBE_WRITE_ENABLED:'YES'},videoId:id,expectedChannel:owner,
  draft:d,accessToken:'a'.repeat(30),fetchFn,thumbnailRenderer:async()=>({ok:true,bytes:fakeJpeg})});
 assert.equal(x.status,'completed_private_test');assert.equal(x.changed,true);
 assert.equal(x.thumbnail_uploaded,true);assert.equal(urls.length,4);
 assert.ok(urls.every(row=>row[2]==='manual'));
});
test('rendering failure prevents any metadata write',async()=>{
 const d=draft();d.status='approved';let writes=0;
 const fetchFn=async(url,opts)=>{
  if(opts.method!=='GET')writes++;
  if(url.includes('channels?'))return Response.json({items:[{id:owner}]});
  return Response.json({items:[video()]});
 };
 const x=await guardedPrivateUpdate({env:{YOUTUBE_WRITE_ENABLED:'YES'},videoId:id,expectedChannel:owner,
  draft:d,accessToken:'b'.repeat(30),fetchFn,thumbnailRenderer:async()=>({ok:false,reason:'free_quota'})});
 assert.equal(x.status,'thumbnail_free_quota');assert.equal(writes,0);
});
