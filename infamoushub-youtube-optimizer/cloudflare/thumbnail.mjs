// InfamousHub thumbnail preview: original typography and shapes, no unlicensed photos.
// Browser Run creates real 1280x720 JPGs on demand. Does not upload to YouTube.
const ID_RE=/^[A-Za-z0-9_-]{11}$/;
const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function safeThumbnailTitle(draft){
 const original=String(draft?.original_title||'').replace(/\s+/g,' ').trim();
 if(original.length<3||original.length>110)throw Error('invalid_title');
 // A topic-specific headline is allowed only when ALL significant tokens
 // occur in the private transcript evidence for the exact same video.
 const headline=String(draft?.thumbnail_headline||'').replace(/\s+/g,' ').trim();
 if(draft?.content_source==='caption_excerpt'&&
    draft?.caption_status==='transcript_available'&&
    headline.length>=8&&headline.length<=62&&
    /^[\p{L}\p{N}\p{P}\p{Zs}]+$/u.test(headline)){
   const tokens=text=>String(text).normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().match(/[a-z0-9]+/g)||[];
   const captionTokens=new Set(tokens(draft.caption_excerpt||''));
   const required=[...new Set(tokens(headline).filter(t=>t.length>=3||/^\d+$/.test(t)))];
   if(required.length>=3&&required.every(t=>captionTokens.has(t)))return headline;
 }
 let display='';
 for(const word of original.split(' ')){
  if((display+' '+word).trim().length>72)break;
  display=(display+' '+word).trim();
 }
 return display||original.slice(0,70);
}
const CSS='*{box-sizing:border-box}html,body{padding:0;margin:0;width:1280px;height:720px;overflow:hidden}'+
 'body{font-family:Arial,Helvetica,sans-serif;color:#fff;background:radial-gradient(ellipse at 90% 18%,#364b8a 0%,transparent 34%),linear-gradient(125deg,#060b17 15%,#102042 56%,#291354 100%)}'+
 '.stage{width:1280px;height:720px;position:relative;overflow:hidden}'+
 '.film{position:absolute;inset:0;opacity:.19;background:repeating-linear-gradient(110deg,transparent 0,transparent 53px,#ffffff10 54px,#ffffff10 56px,transparent 58px,transparent 97px);z-index:1}'+
 '.light{position:absolute;right:-110px;top:-140px;width:710px;height:710px;border:100px solid #8d5fff;transform:rotate(-17deg);border-radius:140px;opacity:.16}'+
 '.ring{position:absolute;right:64px;top:117px;width:440px;height:440px;border-radius:50%;border:35px solid #28ccff;box-shadow:0 0 95px #2271ff inset,0 0 70px #905cf4;opacity:.45}'+
 '.ring:after{content:"";position:absolute;inset:67px;border:7px solid #fff;border-radius:50%;opacity:.38}'+
 '.accent{position:absolute;right:-22px;bottom:68px;width:600px;height:74px;transform:rotate(-20deg);background:#ff3a70;box-shadow:0 0 90px #c9155e;opacity:.84}'+
 '.crest{position:absolute;right:162px;top:245px;font-size:130px;font-weight:900;letter-spacing:-16px;color:#fff;text-shadow:0 4px 40px #041522;opacity:.62}'+
 '.basketball{position:absolute;right:128px;top:168px;width:310px;height:310px;border-radius:50%;opacity:.88;background:radial-gradient(circle at 31% 23%,#ffd38a 0%,#fa9d3f 26%,#cf6122 68%,#7a2a19 100%);border:9px solid #201824;box-shadow:0 14px 75px #e5744599,16px 24px 60px #030812aa}'+
 '.basketball:before{content:"";position:absolute;inset:0;border-radius:50%;border-left:12px solid #281826;border-right:12px solid #281826;transform:scaleX(.5)}'+
 '.basketball:after{content:"";position:absolute;top:48%;left:-1%;width:102%;height:13px;background:#281826;transform:rotate(-17deg)}'+
 '.left{position:absolute;z-index:5;left:65px;top:48px;width:830px;height:620px;display:flex;flex-direction:column}'+
 '.tag{display:inline-block;width:max-content;font-size:26px;font-weight:900;letter-spacing:6px;color:#6be2ff;padding:8px 13px;border-left:7px solid #f43f8c}'+
 '.title{width:820px;max-height:365px;overflow:hidden;line-height:.99;letter-spacing:-3px;text-transform:uppercase;font-size:75px;font-weight:900;text-shadow:0 5px 22px #0008;margin:auto 0;text-wrap:balance;overflow-wrap:break-word}'+
 '.footer{height:66px;display:flex;align-items:center;gap:15px}'+
 '.line{width:88px;height:9px;background:#f43f8c;border-radius:5px}'+
 '.brand{font-size:26px;font-weight:800;letter-spacing:2px}'+
 '.right-label{position:absolute;bottom:28px;right:55px;z-index:7;font-size:22px;color:#c5d6ff;font-weight:bold;letter-spacing:2px}'+
 '.shade{position:absolute;inset:0;background:linear-gradient(90deg,#05081700 0%,#05081733 63%,#080b1680 100%);pointer-events:none}';
export function makeThumbnailHTML(draft){
 if(!ID_RE.test(draft?.video_id||''))throw Error('invalid_video_id');
 const title=esc(safeThumbnailTitle(draft));
 const sport= draft?.caption_status==='transcript_available' &&
  /\bbasketball\b/i.test(String(draft.caption_excerpt||''));
 return '<!doctype html><html lang="en"><head><meta charset="utf-8">'+
  '<meta name="viewport" content="width=1280,initial-scale=1"><style>'+CSS+'</style></head><body>'+
  '<div class="stage"><div class="light"></div><div class="film"></div>'+
  '<div class="ring"></div>'+(sport?'<div class="basketball" aria-hidden="true"></div>':'<div class="crest">IH</div>')+
  '<div class="accent"></div><div class="shade"></div>'+
  '<div class="left"><div class="tag">FEATURED VIDEO</div><div class="title">'+title+'</div>'+
  '<div class="footer"><span class="line"></span><span class="brand">INFAMOUSHUB</span></div></div>'+
  '<div class="right-label">INFAMOUSHUB.COM</div></div></body></html>';
}
export async function renderThumbnail(env,draft){
 if(!env.BROWSER?.quickAction)return {ok:false,reason:'browser_not_enabled'};
 let r;
 try{
  r=await env.BROWSER.quickAction('screenshot',{
   html:makeThumbnailHTML(draft),
   viewport:{width:1280,height:720},
   screenshotOptions:{type:'jpeg',quality:82,encoding:'binary'},
   actionTimeout:20000,
   rejectResourceTypes:['script','xhr','websocket','font','media','image']
  });
 }catch(e){return {ok:false,reason:'render_failed'};}
 if(!(r instanceof Response)||!r.ok||!(r.headers.get('content-type')||'').toLowerCase().startsWith('image/jpeg'))
  return {ok:false,reason:'invalid_browser_response'};
 let bytes;
 try{bytes=new Uint8Array(await r.arrayBuffer());}catch(e){return {ok:false,reason:'image_unreadable'};}
 if(bytes.byteLength<5000||bytes.byteLength>1950000||bytes[0]!==255||bytes[1]!==216)
  return {ok:false,reason:'invalid_image_size_or_type'};
 return {ok:true,bytes,contentType:'image/jpeg',size:bytes.byteLength,downloadName:'infamoushub-'+draft.video_id+'.jpg'};
}
