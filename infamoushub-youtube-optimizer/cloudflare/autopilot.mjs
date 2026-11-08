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
 let feed;
 try{feed=await readUploads(env)}catch(e){return {status:'youtube_read_failed',created:0}};
 if(!feed?.ok||!/^UC[A-Za-z0-9_-]{10,}$/.test(feed.channel_id||''))return {status:feed?.kind||'invalid_channel',created:0};
 const channel=feed.channel_id, videos=Array.isArray(feed.long_videos)?feed.long_videos.slice(0,50):[];
 const existing=await env.YTDB.prepare('SELECT channel_id FROM optimizer_watch_state WHERE channel_id=?').bind(channel).first();
 const baseline=!existing;
 if(baseline){
  await env.YTDB.prepare("INSERT OR IGNORE INTO optimizer_watch_state(channel_id,initialized_at,last_scan_at,scan_count) VALUES (?,datetime('now'),datetime('now'),1)").bind(channel).run();
 }
 let created=0, baselineSeen=0, skipped=0;
 for(const v of videos){
  if(!/^[A-Za-z0-9_-]{11}$/.test(v.id||'')||!Number.isInteger(v.seconds)||v.seconds<240){skipped++;continue;}
  const result=await env.YTDB.prepare("INSERT OR IGNORE INTO optimizer_seen_videos(video_id,channel_id,first_seen_at) VALUES (?,?,datetime('now'))").bind(v.id,channel).run();
  if(result.meta?.changes!==1)continue;
  if(baseline){baselineSeen++;continue;}
  try{
   const draft=prepareDraft(v,channel);
   const saved=await env.YTDB.prepare(
    "INSERT OR IGNORE INTO optimizer_drafts(video_id,channel_id,original_title,proposed_title,proposed_description,suggested_tags_json,thumbnail_brief,duration_seconds,privacy,video_published_at,status) VALUES (?,?,?,?,?,?,?,?,?,?,'needs_review')")
    .bind(draft.video_id,draft.channel_id,draft.original_title,draft.proposed_title,draft.proposed_description,draft.suggested_tags_json,draft.thumbnail_brief,draft.duration_seconds,draft.privacy,draft.video_published_at).run();
   created+=saved.meta?.changes||0;
  }catch(e){skipped++;}
 }
 await env.YTDB.prepare("UPDATE optimizer_watch_state SET last_scan_at=datetime('now'),scan_count=scan_count+1,last_error=NULL WHERE channel_id=?").bind(channel).run();
 return {status:baseline?'baseline_created':'checked',channel_id:channel,
  checked:videos.length,baseline_seen:baselineSeen,created,skipped,edits_to_youtube:0,
  thumbnails_uploaded:0,automatic_publication:false};
}
export async function getDrafts(env,channelId){
 if(!/^UC[A-Za-z0-9_-]{10,}$/.test(channelId))return [];
 const r=await env.YTDB.prepare('SELECT video_id,original_title,proposed_title,proposed_description,suggested_tags_json,thumbnail_brief,duration_seconds,privacy,status,created_at FROM optimizer_drafts WHERE channel_id=? ORDER BY created_at DESC,video_id DESC LIMIT 35').bind(channelId).all();
 return r.results||[];
}
