// Safe YouTube private-video update protocol. No production write route until explicit review.
// All HTTP destinations are fixed Google API origins. Tokens never reach URLs or logs.
const idRE=/^[A-Za-z0-9_-]{11}$/;
const channelRE=/^UC[A-Za-z0-9_-]{10,}$/;
const t=s=>String(s||'').trim();
const max=(s,n)=>t(s).slice(0,n);
function duration(raw){
 const m=/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(raw||'');
 return m?Number(m[1]||0)*86400+Number(m[2]||0)*3600+Number(m[3]||0)*60+Number(m[4]||0):0;
}
export function safeMetadataCandidate(video,draft,expectedChannel,{useAlternate=false}={}){
 if(!channelRE.test(expectedChannel)||!idRE.test(draft?.video_id)||video?.id!==draft.video_id)
  throw Error('video_or_owner_invalid');
 if(video.snippet?.channelId!==expectedChannel||draft.channel_id!==expectedChannel)
  throw Error('channel_mismatch');
 if(video.status?.privacyStatus!=='private'||draft.privacy!=='private')
  throw Error('video_not_private');
 if(duration(video.contentDetails?.duration)<240)throw Error('not_long_form');
 if(video.snippet?.liveBroadcastContent==='live'||video.snippet?.liveBroadcastContent==='upcoming')
  throw Error('live_content');
 if(t(video.snippet?.title)!==t(draft.original_title))
  throw Error('title_changed_since_draft');
 const title=String(useAlternate?draft.alternate_title:draft.proposed_title||'').trim();
 if(title.length<3||title.length>100||/[<>\r\n]/.test(title))throw Error('invalid_new_title');
 const currentDescription=String(video.snippet?.description||'');
 const suggested=String(draft.proposed_description||'');
 if(suggested.length>4800)throw Error('description_too_long');
 // If the current description contains credits, preserve it byte-for-byte.
 let description=currentDescription;
 if(suggested&&!currentDescription){
  description=suggested;
 }else if(suggested&&!currentDescription.includes(suggested)&&suggested!==currentDescription){
  description=suggested+'\n\n--- Original description and attribution ---\n'+currentDescription;
 }
 if(new TextEncoder().encode(description).length>5000)throw Error('description_too_long');
 let proposedTags=[];
 try{const tags=JSON.parse(draft.suggested_tags_json||'[]');if(Array.isArray(tags))proposedTags=tags.filter(z=>typeof z==='string'&&z.length<=80);}catch(e){}
 const tags=[...new Set([...(video.snippet.tags||[]),...proposedTags])].filter(z=>typeof z==='string').slice(0,40);
 if(new TextEncoder().encode(tags.join(',')).length>450)throw Error('tags_over_limit');
 const snippet={title,description,categoryId:String(video.snippet.categoryId||'24'),tags};
 for(const field of ['defaultLanguage','defaultAudioLanguage']){
  if(video.snippet[field])snippet[field]=video.snippet[field];
 }
 return {id:video.id,snippet};
}
export async function guardedPrivateUpdate({env,videoId,expectedChannel,draft,accessToken,
 fetchFn=fetch,thumbnailRenderer}={}){
 if(env?.YOUTUBE_WRITE_ENABLED!=='YES')return {status:'disabled',changed:false,thumbnail_uploaded:false};
 if(draft?.status!=='approved')return {status:'requires_review',changed:false,thumbnail_uploaded:false};
 if(!idRE.test(videoId)||videoId!==draft?.video_id||!channelRE.test(expectedChannel))
  return {status:'invalid_reference',changed:false,thumbnail_uploaded:false};
 if(typeof accessToken!=='string'||accessToken.length<8)
  return {status:'missing_token',changed:false,thumbnail_uploaded:false};
 const auth={authorization:'Bearer '+accessToken};
 const get=async url=>{
  const r=await fetchFn(url,{method:'GET',headers:auth,redirect:'manual'});
  if(r.status>=300&&r.status<400)throw Error('redirect_blocked');
  if(!r.ok)throw Error('google_api_unavailable');
  return r.json();
 };
 try{
  const mine=await get('https://www.googleapis.com/youtube/v3/channels?part=id&mine=true');
  if(!Array.isArray(mine.items)||!mine.items.some(x=>x.id===expectedChannel))
   return {status:'wrong_oauth_channel',changed:false,thumbnail_uploaded:false};
  const data=await get('https://www.googleapis.com/youtube/v3/videos?part=snippet%2Cstatus%2CcontentDetails&id='+videoId);
  if(!Array.isArray(data.items)||data.items.length!==1)return {status:'video_not_found',changed:false,thumbnail_uploaded:false};
  const video=data.items[0];
  let candidate;
  try{candidate=safeMetadataCandidate(video,draft,expectedChannel,{useAlternate:draft.selected_title==='alternate'});}
  catch(e){return {status:e.message||'invalid_package',changed:false,thumbnail_uploaded:false};}
  // Generate and validate JPEG BEFORE any YouTube change, preventing partial writes
  // when Browser Run is unavailable or free-tier quota is exhausted.
  if(typeof thumbnailRenderer!=='function')return {status:'missing_thumbnail_renderer',changed:false,thumbnail_uploaded:false};
  const picture=await thumbnailRenderer(env,draft);
  if(!picture.ok)return {status:'thumbnail_'+picture.reason,changed:false,thumbnail_uploaded:false};
  const png=picture.bytes;
  if(!(png instanceof Uint8Array)||png.length<5000||png.length>1950000||png[0]!==255||png[1]!==216)
   return {status:'thumbnail_invalid',changed:false,thumbnail_uploaded:false};
  const updated=await fetchFn('https://www.googleapis.com/youtube/v3/videos?part=snippet',{
   method:'PUT',headers:{...auth,'content-type':'application/json; charset=utf-8'},
   body:JSON.stringify(candidate),redirect:'manual'
  });
  if(!updated.ok||updated.status>=300)return {status:'metadata_rejected',changed:false,thumbnail_uploaded:false};
  const saved=await updated.json();
  if(saved.id!==videoId)return {status:'metadata_unconfirmed',changed:true,thumbnail_uploaded:false};
  const uploaded=await fetchFn('https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId='+videoId+'&uploadType=media',{
   method:'POST',headers:{...auth,'content-type':'image/jpeg'},
   body:png,redirect:'manual'
  });
  if(!uploaded.ok||uploaded.status>=300)return {status:'metadata_updated_thumbnail_failed',changed:true,thumbnail_uploaded:false};
  return {status:'completed_private_test',video_id:videoId,changed:true,thumbnail_uploaded:true,
   privacy_untouched:true};
 }catch(e){return {status:'api_error',changed:false,thumbnail_uploaded:false};}
}
