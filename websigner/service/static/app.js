'use strict';
const $=id=>document.getElementById(id);
const fields=['ipa','certificate','profile','password'];
const MAX_IPA_BYTES=512*1024**2;
// Bump whenever a versioned preview worker/helper/icon asset changes.
const PREVIEW_ASSET_VERSION='icon-stable-1';
let worker=null,signed=null,downloadURL=null,upload=null,job=null,timer=null,activePress=null;
let previewWorker=null,previewTimer=null,previewEpoch=0;
let iconLoad=null,iconLoadId=0,previewMetadataCache=new WeakMap();
let uploadFraction=0;
const decodedIcons=new Map();
const PARENT='https://nulldev85.github.io';
if(window.top===window)document.body.classList.add('standalone');
const status=text=>{$('status').textContent=text;syncActionHints();};
function syncActionHints(){
  const selected=['ipa','certificate','profile'].every(id=>$(id).files?.length>0)&&$('ipa').files[0].size<=MAX_IPA_BYTES;
  $('sign').classList.toggle('is-ready',selected&&!$('sign').disabled&&!$('sign-form').hidden);
  $('prepare').classList.toggle('is-ready',!!signed&&!job&&!upload&&!$('prepare').disabled&&!$('result').hidden);
  $('install').classList.toggle('is-ready',!!job&&job.expires*1000>Date.now()&&!$('install').hidden);
  $('sign').setAttribute('aria-busy',String($('sign').disabled));
  $('prepare').setAttribute('aria-busy',String(!$('prepare').hidden&&$('prepare').disabled));
}
function measure(){if(window.parent!==window)window.parent.postMessage({type:'null-websigner-size',height:Math.ceil($('signer').getBoundingClientRect().height+8)},PARENT);}
new ResizeObserver(measure).observe($('signer'));
function updateFileNames(){
  for(const [id,empty] of [['ipa','No IPA selected'],['certificate','No .p12 selected'],['profile','No profile selected']])$(id+'-name').textContent=$(id).files[0]?.name||empty;
}
function clearAppPreview(release=true){
  previewEpoch++;iconLoadId++;clearTimeout(previewTimer);
  if(iconLoad){iconLoad.onload=null;iconLoad.onerror=null;iconLoad.removeAttribute('src');iconLoad=null;}
  if(release){previewWorker?.terminate();previewWorker=null;previewMetadataCache=new WeakMap();decodedIcons.clear();}
  $('app-icon').hidden=true;$('app-icon').classList.remove('is-decoded');$('app-icon').onload=null;$('app-icon').onerror=null;
  if(release)$('app-icon').removeAttribute('src');
  $('app-placeholder').hidden=false;$('app-preview').hidden=true;
}
function displayAppIcon(source,fallback,epoch,onReady){
  const request=++iconLoadId;let settled=false;
  const current=()=>epoch===previewEpoch&&request===iconLoadId&&!settled;
  const commit=(image,value)=>{
    if(!current()||!image.naturalWidth)return;
    settled=true;image.onload=null;image.onerror=null;iconLoad=null;
    image.id='app-icon';image.alt='';image.width=56;image.height=56;image.hidden=false;image.classList.add('is-decoded');
    const old=$('app-icon');if(old!==image)old.replaceWith(image);
    $('app-placeholder').hidden=true;
    decodedIcons.delete(value);decodedIcons.set(value,image);
    while(decodedIcons.size>2)decodedIcons.delete(decodedIcons.keys().next().value);
    onReady?.(value);
  };
  const load=value=>{
    if(!current())return;
    const cached=decodedIcons.get(value);if(cached?.complete&&cached.naturalWidth>0){commit(cached,value);return;}
    const image=new Image();iconLoad=image;image.decoding='async';let decoding=false,failedOnce=false;
    const failed=()=>{if(!current()||iconLoad!==image||failedOnce)return;failedOnce=true;image.onload=null;image.onerror=null;iconLoad=null;if(fallback&&value!==fallback)load(fallback);};
    const ready=()=>{
      if(!current()||iconLoad!==image||decoding)return;decoding=true;
      if(typeof image.decode==='function')image.decode().then(()=>commit(image,value)).catch(failed);
      else commit(image,value);
    };
    image.onload=ready;image.onerror=failed;image.src=value;
    if(image.complete&&image.naturalWidth>0)ready();
  };
  if(source||fallback)load(source||fallback);
}
function ensurePreviewWorker(){
  if(!previewWorker){
    const reader=new Worker('/assets/preview-worker.js?v='+PREVIEW_ASSET_VERSION);
    reader.onerror=()=>{if(previewWorker===reader){reader.terminate();previewWorker=null;}};
    previewWorker=reader;
  }
  return previewWorker;
}
function warmPreviewWorker(){try{ensurePreviewWorker();}catch{}}
function previewApp(){
  clearAppPreview(false);const ipa=$('ipa').files[0];if(!ipa||ipa.size>MAX_IPA_BYTES)return;
  const epoch=previewEpoch;
  $('app-name').textContent=ipa.name.replace(/\.(ipa|tipa)$/i,'');$('app-preview').hidden=false;
  const render=data=>{
    if(typeof data.name==='string'&&data.name.trim())$('app-name').textContent=data.name.slice(0,160);
    const fallback=({'com.nulldev85.NullSports.iOS':'/assets/app-icons/lineup.png','com.nulldev85.NullSports':'/assets/app-icons/lineup.png','com.elmat.NullSign':'/assets/app-icons/nullsign.png'})[data.bundle];
    const source=typeof data.iconDataURL==='string'&&data.iconDataURL.startsWith('data:image/png;base64,')&&data.iconDataURL.length<=12*1024**2?data.iconDataURL:null;
    displayAppIcon(data.preferredSource||source,fallback?fallback+'?v='+PREVIEW_ASSET_VERSION:null,epoch,value=>{data.preferredSource=value;});
  };
  const cached=previewMetadataCache.get(ipa);if(cached){render(cached);return;}
  const read=attempt=>{
    let reader;
    const failed=()=>{
      if(epoch!==previewEpoch||(reader&&previewWorker!==reader))return;
      clearTimeout(previewTimer);reader?.terminate();previewWorker=null;
      if(attempt===0)read(1);
    };
    try{
      reader=ensurePreviewWorker();
      reader.onmessage=event=>{
        const data=event.data;if(epoch!==previewEpoch||data?.requestId!==epoch||previewWorker!==reader)return;
        clearTimeout(previewTimer);reader.onerror=()=>{if(previewWorker===reader){reader.terminate();previewWorker=null;}};
        if(data.type!=='preview')return;
        const metadata={name:data.name,bundle:data.bundle,iconDataURL:data.iconDataURL};
        previewMetadataCache.set(ipa,metadata);render(metadata);
      };
      reader.onerror=failed;reader.postMessage({type:'preview',requestId:epoch,ipa});
      previewTimer=setTimeout(()=>{if(epoch===previewEpoch&&previewWorker===reader){reader.terminate();previewWorker=null;}},60000);
    }catch{failed();}
  };
  read(0);
}
function showSignerView(view){
  const tutorial=view==='tutorials';
  $('signer-panel').hidden=tutorial;$('tutorials-panel').hidden=!tutorial;
  $('signer-tab').setAttribute('aria-pressed',String(!tutorial));$('tutorials-tab').setAttribute('aria-pressed',String(tutorial));
  measure();
}
function clearInputs(){fields.forEach(id=>{$(id).value='';});updateFileNames();syncActionHints();}
function busy(value){fields.forEach(id=>{$(id).disabled=value;});$('sign').disabled=value;$('sign').textContent=value?'Signing…':'Sign IPA';$('cancel').hidden=!value;syncActionHints();}
function stop(){clearTimeout(timer);worker?.terminate();worker=null;upload?.abort();upload=null;busy(false);$('upload-progress').hidden=true;}
function clearJob(){job=null;$('install').hidden=true;$('hosted-actions').hidden=true;$('prepare').hidden=false;$('prepare').disabled=false;$('prepare').textContent='Prepare install';}
function updateUploadProgress(fraction,reset=false){
  const progress=$('upload-progress');
  const value=Number.isFinite(fraction)?Math.min(1,Math.max(0,fraction)):0;
  const measured=reset?value:Math.max(uploadFraction,value);uploadFraction=measured;
  const previousPercent=Math.floor(progress.value||0),percent=Math.floor(measured*100);
  progress.value=measured*100;if(reset||percent!==previousPercent)progress.setAttribute('aria-valuenow',String(percent));
  $('upload-progress-fill').style.transform='scaleX('+measured+')';
  return percent;
}
function reset(){stop();clearInputs();clearAppPreview();signed=null;if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=null;clearJob();$('result').hidden=true;$('sign-form').hidden=false;status('');showSignerView('signer');}
window.addEventListener('pagehide',()=>{stop();clearInputs();clearAppPreview();if(downloadURL)URL.revokeObjectURL(downloadURL);});
window.addEventListener('message',event=>{if(event.origin===PARENT&&event.source===window.parent&&event.data?.type==='null-websigner-cancel')reset();});
document.querySelectorAll('[data-signer-view]').forEach(button=>button.addEventListener('click',()=>showSignerView(button.dataset.signerView)));
fields.forEach(id=>{for(const type of ['input','change'])$(id).addEventListener(type,()=>{updateFileNames();syncActionHints();});});
$('ipa').addEventListener('change',previewApp);
$('ipa').addEventListener('pointerdown',warmPreviewWorker,{passive:true});
$('ipa').addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' ')warmPreviewWorker();});
window.addEventListener('focus',syncActionHints);
document.addEventListener('visibilitychange',syncActionHints);
syncActionHints();
$('cancel').addEventListener('click',()=>{stop();clearInputs();clearAppPreview();status('Signing cancelled.');});
$('again').addEventListener('click',reset);
$('sign-form').addEventListener('submit',event=>{
  event.preventDefault();if(worker)return;
  const ipa=$('ipa').files[0],certificate=$('certificate').files[0],profile=$('profile').files[0],password=$('password').value;
  if(!ipa||!certificate||!profile){status('Choose an IPA, certificate and provisioning profile.');return;}
  if(ipa.size>MAX_IPA_BYTES){status('Choose an IPA no larger than 512 MB.');return;}
  busy(true);clearJob();$('result').hidden=true;
  try{
    worker=new Worker('/assets/worker.js');
    worker.onmessage=event=>{
      const data=event.data;
      if(data.type==='phase'){status(data.text);return;}
      clearTimeout(timer);worker?.terminate();worker=null;busy(false);clearInputs();
      if(data.type==='failed'){clearAppPreview();status(data.text);return;}
      if(data.type!=='signed'||!(data.bytes instanceof Uint8Array)){clearAppPreview();status('The signer returned an invalid result.');return;}
      signed=new Blob([data.bytes],{type:'application/octet-stream'});
      if(downloadURL)URL.revokeObjectURL(downloadURL);downloadURL=URL.createObjectURL(signed);
      $('save').href=downloadURL;$('save').download='Signed-'+ipa.name.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').slice(0,100).replace(/\.(?:ipa|tipa)$/i,'')+'.ipa';
      $('sign-form').hidden=true;$('result').hidden=false;status('Signed IPA ready.');
    };
    worker.onerror=()=>{stop();clearInputs();clearAppPreview();status('The browser couldn’t finish signing. Try a smaller IPA or use NullSign.');};
    worker.postMessage({type:'sign',ipa,certificate,profile,password});
    $('password').value='';
    timer=setTimeout(()=>{stop();clearInputs();clearAppPreview();status('Signing took too long. Try a smaller IPA or use NullSign.');},10*60*1000);
  }catch{stop();clearInputs();clearAppPreview();status('The local signer could not start in this browser.');}
});

$('prepare').addEventListener('click',()=>{
  if(!signed||upload)return;
  $('prepare').disabled=true;$('prepare').textContent='Uploading…';status('Uploading the signed IPA only…');
  const progress=$('upload-progress');updateUploadProgress(0,true);progress.hidden=false;
  const xhr=new XMLHttpRequest();upload=xhr;
  let reportedPercent=-1;
  xhr.open('POST','/api/uploads');xhr.setRequestHeader('Content-Type','application/octet-stream');xhr.timeout=900000;
  xhr.upload.onprogress=event=>{if(upload===xhr&&event.lengthComputable&&event.total>0){const percent=updateUploadProgress(event.loaded/event.total);if(percent!==reportedPercent){reportedPercent=percent;status(percent<100?'Uploading signed IPA… '+percent+'%':'Checking the uploaded IPA…');}}};
  const failure=text=>{if(upload!==xhr)return;upload=null;progress.hidden=true;$('prepare').disabled=false;$('prepare').textContent='Prepare install';status(text);};
  xhr.onerror=()=>failure('The upload failed. Please try again.');xhr.ontimeout=()=>failure('The upload timed out. Please try again.');xhr.onabort=()=>failure('Upload cancelled.');
  xhr.onload=()=>{
    if(upload!==xhr)return;
    let data;try{data=JSON.parse(xhr.responseText);}catch{failure('The server returned an invalid response.');return;}
    if(xhr.status!==201){failure(data.error||'The signed IPA could not be uploaded.');return;}
    if(!/^[a-f0-9]{64}$/.test(data.token)||typeof data.deleteToken!=='string'||!Number.isInteger(data.expires)){failure('The server returned an invalid installation link.');return;}
    // Only construct installation addresses on this service, never trust a returned redirect.
    job={token:data.token,deleteToken:data.deleteToken,expires:data.expires};
    const manifest=location.origin+'/manifest/'+job.token+'.plist';
    $('install').href='itms-services://?action=download-manifest&url='+encodeURIComponent(manifest);
    upload=null;progress.hidden=true;$('prepare').hidden=true;$('install').hidden=false;$('hosted-actions').hidden=false;
    status('Ready. Tap Install app and confirm on your iPhone.');
  };
  xhr.send(signed);
});
$('install').addEventListener('click',event=>{
  if(!job||job.expires*1000<=Date.now()){event.preventDefault();clearJob();status('The link expired. Prepare installation again.');return;}
  status('Confirm Install in the iPhone prompt.');
});
$('copy-install').addEventListener('click',async()=>{
  if(!job)return;
  const value=location.origin+'/install/'+job.token;
  try{await navigator.clipboard.writeText(value);status('Installation link copied. It expires after 20 minutes.');}
  catch{
    const input=document.createElement('textarea');input.className='clipboard-helper';input.readOnly=true;input.tabIndex=-1;input.value=value;document.body.appendChild(input);input.select();
    let copied=false;try{copied=document.execCommand('copy');}catch{}input.remove();$('copy-install').focus({preventScroll:true});status(copied?'Installation link copied.':'Couldn’t copy the link.');
  }
});
$('delete').addEventListener('click',async()=>{
  if(!job)return;$('delete').disabled=true;
  try{const response=await fetch('/api/uploads/'+job.token,{method:'DELETE',headers:{'X-Delete-Token':job.deleteToken}});if(response.status!==204&&response.status!==410)throw new Error();clearJob();status('Temporary copy removed. Your saved IPA is unchanged.');}
  catch{status('Couldn’t remove it now. It will expire automatically.');}
  finally{$('delete').disabled=false;}
});

function releasePress(){activePress?.node.classList.remove('is-pressed');activePress=null;}
const pressControls='.button, input[type=file], .signer-guide summary';
document.addEventListener('pointerdown',event=>{releasePress();if(!event.isPrimary||event.button!==0||!(event.target instanceof Element))return;const node=event.target.closest(pressControls);if(!node||node.matches(':disabled'))return;activePress={node,id:event.pointerId,bounds:node.getBoundingClientRect()};node.classList.add('is-pressed');},{passive:true});
document.addEventListener('pointermove',event=>{if(!activePress||activePress.id!==event.pointerId)return;const b=activePress.bounds;activePress.node.classList.toggle('is-pressed',event.clientX>=b.left&&event.clientX<=b.right&&event.clientY>=b.top&&event.clientY<=b.bottom);},{passive:true});
for(const type of ['pointerup','pointercancel','lostpointercapture'])document.addEventListener(type,releasePress,true);
document.addEventListener('scroll',releasePress,{capture:true,passive:true});window.addEventListener('blur',releasePress);
document.addEventListener('keydown',event=>{if(event.repeat||!(event.target instanceof Element))return;const node=event.target.closest(pressControls);if(node&&!node.matches(':disabled')&&(event.key==='Enter'||(event.key===' '&&node.matches('button, summary, input[type=file]'))))node.classList.add('is-pressed');});
const releaseKeys=()=>document.querySelectorAll('.is-pressed').forEach(node=>node.classList.remove('is-pressed'));
document.addEventListener('keyup',releaseKeys);document.addEventListener('focusout',releaseKeys);window.addEventListener('blur',releaseKeys);
