// Owner-only YouTube caption inspection. Read-only; bounded API use and storage.
// Captions API listing costs quota units; invoke at most one new private video
// per scheduled scan and retry unavailable tracks no more than every 72 hours.
const idRE=/^[A-Za-z0-9_-]{11}$/;
const channelRE=/^UC[A-Za-z0-9_-]{10,}$/;
export function parseVtt(content){
 const source=String(content||'').slice(0,100000).replace(/\r\n?/g,'\n');
 const result=[];
 let last='';
 for(const rawLine of source.split('\n')){
  const line=rawLine.replace(/<[^>]{0,180}>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/\s+/g,' ').trim();
  if(!line||/^(WEBVTT|NOTE|STYLE|REGION|Kind:|Language:)/i.test(line)||
     /^\d{1,6}$/.test(line)||line.includes('-->')||/^\d\d:\d\d:\d\d/.test(line)||
     line===last)continue;
  result.push(line);last=line;
  if(result.join(' ').length>4300)break;
 }
 return result.join(' ').slice(0,4000).trim();
}
export async function readOwnerCaptionTrack(videoId,accessToken,fetchFn=fetch){
 if(!idRE.test(videoId||'')||typeof accessToken!=='string'||accessToken.length<8)
  return {status:'invalid_request'};
 const auth={authorization:'Bearer '+accessToken};
 async function get(url){
  const r=await fetchFn(url,{method:'GET',headers:auth,redirect:'manual'});
  if(r.status>=300&&r.status<400)return {error:'redirect_blocked'};
  if(!r.ok)return {error:r.status===401||r.status===403?'permission_denied':'unavailable'};
  return {response:r};
 }
 let tracks;
 try{tracks=await get('https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId='+videoId);}
 catch(e){return {status:'network_unavailable'};}
 if(tracks.error)return {status:tracks.error};
 let metadata;
 try{metadata=await tracks.response.json();}catch(e){return {status:'invalid_caption_list'};}
 const items=Array.isArray(metadata?.items)?metadata.items.slice(0,30):[];
 const available=items.filter(x=>x?.snippet?.videoId===videoId&&
  x.snippet?.status==='serving'&&x.snippet?.isDraft!==true&&
  /^[A-Za-z0-9._~-]{1,200}$/.test(x.id||''));
 // Favor non-automated captions, then English, then another available language.
 available.sort((a,b)=>{
  const score=x=>(x.snippet.trackKind==='ASR'?0:2)+(String(x.snippet.language||'').startsWith('en')?1:0);
  return score(b)-score(a);
 });
 if(!available.length)return {status:'no_captions',tracks_found:items.length};
 const selected=available[0];
 let download;
 try{download=await get('https://www.googleapis.com/youtube/v3/captions/'+
  encodeURIComponent(selected.id)+'?tfmt=vtt');}
 catch(e){return {status:'network_unavailable',tracks_found:items.length};}
 if(download.error)return {status:'caption_'+download.error,tracks_found:items.length};
 let transcript;
 try{transcript=parseVtt(await download.response.text());}
 catch(e){return {status:'unreadable_caption',tracks_found:items.length};}
 if(transcript.length<50)return {status:'empty_caption',tracks_found:items.length};
 const words=transcript.split(/\s+/).filter(Boolean).length;
 return {status:'transcript_available',tracks_found:items.length,language:String(selected.snippet.language||'').slice(0,16),
  track_kind:String(selected.snippet.trackKind||'standard').slice(0,20),
  transcript_excerpt:transcript,excerpt_words:words};
}
export async function findCaptionCandidate(env){
 if(!env?.YTDB)return null;
 return await env.YTDB.prepare(
  "SELECT v.video_id,v.channel_id,v.title,v.privacy,v.duration_seconds "+
  "FROM optimizer_video_inventory v LEFT JOIN optimizer_caption_analysis a ON a.video_id=v.video_id "+
  "WHERE v.privacy='private' AND v.duration_seconds>=240 AND "+
  "(a.video_id IS NULL OR (a.attempts<3 AND a.last_checked_at<=datetime('now','-72 hours') "+
  "AND a.status IN ('no_captions','caption_unavailable','network_unavailable','empty_caption'))) "+
  "ORDER BY v.last_checked_at DESC,v.video_id DESC LIMIT 1").first();
}
export async function writeCaptionAnalysis(env,candidate,result){
 if(!channelRE.test(candidate?.channel_id||'')||!idRE.test(candidate?.video_id||''))throw Error('Invalid caption analysis reference');
 const status=String(result?.status||'unavailable').slice(0,48);
 const transcript=status==='transcript_available'?String(result.transcript_excerpt||'').slice(0,4000):'';
 await env.YTDB.prepare(
  "INSERT INTO optimizer_caption_analysis(video_id,channel_id,status,language,track_kind,transcript_excerpt,excerpt_words,attempts,last_checked_at) "+
  "VALUES (?,?,?,?,?,?,?,1,datetime('now')) ON CONFLICT(video_id) DO UPDATE SET "+
  "status=excluded.status,language=excluded.language,track_kind=excluded.track_kind,"+
  "transcript_excerpt=excluded.transcript_excerpt,excerpt_words=excluded.excerpt_words,"+
  "attempts=optimizer_caption_analysis.attempts+1,last_checked_at=datetime('now') "+
  "WHERE optimizer_caption_analysis.channel_id=excluded.channel_id")
  .bind(candidate.video_id,candidate.channel_id,status,
   String(result.language||'').slice(0,16),String(result.track_kind||'').slice(0,20),
   transcript,Number(result.excerpt_words||0)).run();
 return {saved:true,status,video_id:candidate.video_id};
}
export async function inspectNextVideoCaptions(env,ownerAccess,fetchFn=fetch){
 if(env.CAPTION_INSPECTION!=='YES')return {status:'disabled'};
 const candidate=await findCaptionCandidate(env);
 if(!candidate)return {status:'no_candidate'};
 const connected=await env.YTDB.prepare("SELECT channel_id FROM oauth_channel WHERE singleton=1 AND status='active'").first();
 if(!connected||candidate.channel_id!==connected.channel_id)return {status:'unexpected_channel'};
 // Never proceed with captions.list unless the owner token is available.
 const token=await ownerAccess(env,candidate.channel_id);
 if(!token)return {status:'token_unavailable'};
 const result=await readOwnerCaptionTrack(candidate.video_id,token,fetchFn);
 const saved=await writeCaptionAnalysis(env,candidate,result);
 return {status:saved.status,video_id:candidate.video_id,stored:true};
}
