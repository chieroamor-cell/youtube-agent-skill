// InfamousHub long-video discovery and editorial draft queue.
// NEVER uses YouTube write APIs. Drafts are not approval to change the channel.
const squeeze=s=>String(s||'').replace(/\s+/g,' ').trim();
const bound=(s,n)=>squeeze(s).slice(0,n);
export function prepareDraft(video, channelId){
 if(!/^[A-Za-z0-9_-]{11}$/.test(video?.id||'') ||
     !/^UC[A-Za-z0-9_-]{10,}$/.test(channelId||'') ||
     !Number.isInteger(video.seconds)||video.seconds<240)
  throw new Error('Not an owned eligible long-form video');
 const original=bound(video.title,100);
 if(original.length<3)throw new Error('Missing original video title');
 const originalDescription=String(video.description||'').slice(0,4500).trim();
 // Never overwrite credits, invent events, or make sensational claims. Suggestions are editorial drafts.
 const proposedDescription=originalDescription ||
   'Watch "'+original+'" on InfamousHub.\n\nMore stories: https://infamoushub.com/';
 const topic=bound(original.replace(/(\s*[-|–—]\s*(official|video|full story|explained)\b.*)$/i,''),70);
 const alternate=bound('The Story Behind '+topic,100);
 const wordTokens=original.match(/[A-Za-z0-9]{3,}/g)||[];
 const tags=[...new Set([original,'InfamousHub',...wordTokens.slice(0,6)])].slice(0,9);
 const teaser=bound(topic.toUpperCase(),30);
 return {
  video_id:video.id,channel_id:channelId,original_title:original,
  proposed_title:original,alternate_title:alternate,
  proposed_description:proposedDescription,
  suggested_tags_json:JSON.stringify(tags),
  thumbnail_brief:'16:9 (1280x720) high-contrast thumbnail featuring the actual subject of "'+original+
   '". Large legible text "'+teaser+'"; use original licensed/owned footage or verified photographs only. DO NOT invent identity or imply facts not in video.',
  duration_seconds:video.seconds,
  privacy:bound(video.privacy||'unknown',20),
  video_published_at:bound(video.published||'',40),
  status:'needs_review',
  caveat:'No transcript or visual asset was analyzed. Review all suggestions, factual context and image rights before applying them.'
 };
}
export async function discoverNewLongVideos(env,readUploads,options={}){
 if(env.AUTO_DISCOVERY!=='YES'&&!options.force) return {status:'disabled',created:0};
 if(!env.YTDB)return {status:'missing_database',created:0};
 const recordError=async code=>{
  try{await env.YTDB.prepare("UPDATE optimizer_watch_state SET last_error=?,last_scan_at=datetime('now') WHERE channel_id=(SELECT channel_id FROM oauth_channel WHERE singleton=1 AND status='active')").bind(code).run();}
  catch(e){/* Never leak tokens or error messages to a public endpoint. */}
 };
 let feed;
 try{feed=await readUploads(env)}catch(e){
  await recordError('youtube_read_failed');
  return {status:'youtube_read_failed',created:0};
 }
 if(!feed?.ok||!/^UC[A-Za-z0-9_-]{10,}$/.test(feed.channel_id||'')){
  const code=['google_token_rejected','youtube_api_failed','youtube_read_unavailable','channel_mismatch','invalid_channel'].includes(feed?.kind)?feed.kind:'invalid_channel';
  await recordError(code);
  return {status:code,created:0};
 }
 const channel=feed.channel_id,videos=Array.isArray(feed.long_videos)?feed.long_videos.slice(0,50):[];
 // Internal owner-only inventory: actual privacy/title/description from OAuth APIs.
 // Never exposed publicly or used for any YouTube write. Upsert only changed records.
 if(env.CAPTURE_INVENTORY==='YES'){
  try{await saveOwnerInventory(env,channel,videos);}catch(e){await recordError('inventory_sync_failed');return {status:'inventory_sync_failed',created:0};}
 }
 const initial=await env.YTDB.prepare('SELECT channel_id FROM optimizer_watch_state WHERE channel_id=?').bind(channel).first();
 const baseline=!initial;
 const valid=videos.filter(v=>/^[A-Za-z0-9_-]{11}$/.test(v?.id||'')&&Number.isInteger(v.seconds)&&v.seconds>=240);
 let skipped=videos.length-valid.length,created=0;
 // One SELECT and one D1.batch() keep this below Free plan's per-invocation query limits
 // even when the channel has 50 recent long-form videos.
 const ids=valid.map(v=>v.id);
 const already=ids.length?await env.YTDB.prepare(
  'SELECT video_id FROM optimizer_seen_videos WHERE channel_id=? AND video_id IN ('+ids.map(()=>'?').join(',')+')')
  .bind(channel,...ids).all():{results:[]};
 const seen=new Set((already.results||[]).map(r=>r.video_id));
 const fresh=valid.filter(v=>!seen.has(v.id));
 const stmts=[];
 if(baseline){
  // Baseline must be committed atomically with its seen IDs, or a partial failure
  // could classify old uploads as new on the next scheduled run.
  for(const v of fresh){
   stmts.push(env.YTDB.prepare("INSERT OR IGNORE INTO optimizer_seen_videos(video_id,channel_id,first_seen_at) VALUES (?,?,datetime('now'))").bind(v.id,channel));
  }
  stmts.push(env.YTDB.prepare("INSERT OR IGNORE INTO optimizer_watch_state(channel_id,initialized_at,last_scan_at,scan_count) VALUES (?,datetime('now'),datetime('now'),0)").bind(channel));
  await env.YTDB.batch(stmts);
 }else{
  for(const video of fresh){
   let draft;
   try{draft=prepareDraft(video,channel);}
   catch(e){skipped++;continue;}
   // Atomic pair: if a draft cannot be saved, its video ID is not marked seen.
   stmts.push(env.YTDB.prepare("INSERT OR IGNORE INTO optimizer_seen_videos(video_id,channel_id,first_seen_at) VALUES (?,?,datetime('now'))").bind(video.id,channel));
   stmts.push(env.YTDB.prepare(
    "INSERT OR IGNORE INTO optimizer_drafts(video_id,channel_id,original_title,proposed_title,proposed_description,suggested_tags_json,thumbnail_brief,duration_seconds,privacy,video_published_at,status,alternate_title) VALUES (?,?,?,?,?,?,?,?,?,?,'needs_review',?)")
    .bind(draft.video_id,draft.channel_id,draft.original_title,draft.proposed_title,
     draft.proposed_description,draft.suggested_tags_json,draft.thumbnail_brief,
     draft.duration_seconds,draft.privacy,draft.video_published_at,draft.alternate_title));
  }
  if(stmts.length){
   const result=await env.YTDB.batch(stmts);
   // Every second result belongs to INSERT OR IGNORE draft.
   for(let i=1;i<result.length;i+=2)created+=Number(result[i]?.meta?.changes||0);
  }
 }
 await env.YTDB.prepare("UPDATE optimizer_watch_state SET last_scan_at=datetime('now'),scan_count=scan_count+1,last_error=NULL WHERE channel_id=?").bind(channel).run();
 return {status:baseline?'baseline_created':'checked',channel_id:channel,
  checked:valid.length,baseline_seen:baseline?valid.length:0,created,skipped,
  edits_to_youtube:0,thumbnails_uploaded:0,automatic_publication:false};
}
export async function saveOwnerInventory(env,channelId,videos){
 if(!/^UC[A-Za-z0-9_-]{10,}$/.test(channelId))throw Error('Invalid owner channel');
 if(!env?.YTDB?.batch)throw Error('Missing internal D1 binding');
 const list=(Array.isArray(videos)?videos:[]).filter(v=>/^[A-Za-z0-9_-]{11}$/.test(v?.id||'')&&
  Number.isInteger(v.seconds)&&v.seconds>=240).slice(0,50);
 if(!list.length)return {stored:0};
 const stmts=list.map(v=>env.YTDB.prepare(
  "INSERT INTO optimizer_video_inventory(video_id,channel_id,title,privacy,duration_seconds,description,published_at,last_checked_at) "+
  "VALUES(?,?,?,?,?,?,?,datetime('now')) "+
  "ON CONFLICT(video_id) DO UPDATE SET title=excluded.title,privacy=excluded.privacy,"+
  "duration_seconds=excluded.duration_seconds,description=excluded.description,published_at=excluded.published_at,"+
  "last_checked_at=datetime('now') "+
  "WHERE optimizer_video_inventory.channel_id=excluded.channel_id")
  .bind(v.id,channelId,bound(v.title,150),bound(v.privacy,20),v.seconds,String(v.description||'').slice(0,4000),bound(v.published,40)));
 await env.YTDB.batch(stmts);
 return {stored:list.length};
}

export async function getDrafts(env,channelId){
 if(!/^UC[A-Za-z0-9_-]{10,}$/.test(channelId))return [];
 const r=await env.YTDB.prepare('SELECT video_id,original_title,proposed_title,alternate_title,proposed_description,suggested_tags_json,thumbnail_brief,thumbnail_headline,content_source,duration_seconds,privacy,status,selected_title,created_at FROM optimizer_drafts WHERE channel_id=? ORDER BY created_at DESC,video_id DESC LIMIT 35').bind(channelId).all();
 return r.results||[];
}


// Owner-only explicit drafting for an existing long video; never modifies YouTube.
// The caller must enforce an authenticated admin session and double-submit CSRF.
export async function prepareExistingLongVideo(env,readUploads,videoId){
 if(!/^[A-Za-z0-9_-]{11}$/.test(videoId||''))return {status:'invalid_video_id',created:0};
 if(!env.YTDB)return {status:'missing_database',created:0};
 const connected=await env.YTDB.prepare(
  "SELECT channel_id FROM oauth_channel WHERE singleton=1 AND status='active'").first();
 if(!connected||!/^UC[A-Za-z0-9_-]{10,}$/.test(connected.channel_id||''))
  return {status:'not_authorized',created:0};
 let feed;
 try{feed=await readUploads(env)}catch(e){return {status:'youtube_read_failed',created:0}};
 if(!feed?.ok||feed.channel_id!==connected.channel_id)return {status:'channel_mismatch_or_unavailable',created:0};
 const video=(Array.isArray(feed.long_videos)?feed.long_videos:[]).find(v=>v.id===videoId);
 if(!video||!Number.isInteger(video.seconds)||video.seconds<240)return {status:'video_not_eligible_or_not_recent',created:0};
 let draft;
 try{draft=prepareDraft(video,connected.channel_id)}catch(e){return {status:'invalid_video_metadata',created:0}};
 const result=await env.YTDB.prepare(
  "INSERT OR IGNORE INTO optimizer_drafts(video_id,channel_id,original_title,proposed_title,proposed_description,suggested_tags_json,thumbnail_brief,duration_seconds,privacy,video_published_at,status,alternate_title) VALUES (?,?,?,?,?,?,?,?,?,?,'needs_review',?)")
  .bind(draft.video_id,draft.channel_id,draft.original_title,draft.proposed_title,
   draft.proposed_description,draft.suggested_tags_json,draft.thumbnail_brief,
   draft.duration_seconds,draft.privacy,draft.video_published_at,draft.alternate_title).run();
 return {status:result.meta?.changes===1?'draft_created':'already_exists',
  video_id:videoId,created:result.meta?.changes===1?1:0,
  youtube_modified:false,thumbnail_uploaded:false};
}
