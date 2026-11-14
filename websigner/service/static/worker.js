/* One local signing job per disposable worker. No credentials leave this worker. */
importScripts('/assets/zip-check.js');
let started=false;
self.onmessage=async event=>{
  if(started||event.data?.type!=='sign')return;
  started=true;
  const {ipa,certificate,profile,password}=event.data;
  let reason='Signing failed. Check the IPA, certificate and provisioning profile.';
  const phase=text=>self.postMessage({type:'phase',text});
  try{
    if(!(ipa instanceof Blob)||!(certificate instanceof Blob)||!(profile instanceof Blob)||typeof password!=='string'||password.length>1024||certificate.size<1||profile.size<1||certificate.size>2*1024**2||profile.size>2*1024**2) throw new Error('Choose an IPA, .p12 certificate and provisioning profile.');
    phase('Checking IPA…');await checkIPA(ipa);
    phase('Loading the local signer…');
    importScripts('/assets/engine/zsign-mobile.js');
    let packaging=false;
    const inspectLog=value=>{
      const line=String(value);
      if(line.includes('NULL_PROFILE_EXPIRED'))reason='The provisioning profile is expired or invalid.';
      else if(line.includes('NULL_CERTIFICATE_MISMATCH_OR_EXPIRED'))reason='The certificate is expired or doesn’t match this profile.';
      else if(line.includes('correct file and password'))reason='Couldn’t open the .p12. Check its password.';
      else if(line.includes('NULL_CMS_SIGNATURE_FAILED'))reason='The certificate could not create a valid signature. Use a supported Apple signing certificate.';
      else if(line.includes("Can't find TeamId"))reason='Choose a valid provisioning profile.';
      else if(line.includes('Unzip failed'))reason='The IPA could not be unpacked.';
      if(!packaging&&line.includes('Archiving:')){packaging=true;phase('Packaging the signed IPA…');}
    };
    const mod=await createZsignModule({noInitialRun:true,locateFile:name=>'/assets/engine/'+name,print:inspectLog,printErr:inspectLog});
    // Asset loading is finished. Signing has no network access through these APIs.
    self.fetch=()=>Promise.reject(new Error('Network is disabled during signing.'));
    self.XMLHttpRequest=undefined;self.WebSocket=undefined;
    self.importScripts=()=>{throw new Error('Further imports are disabled.');};
    const FS=mod.FS;
    for(const dir of ['/blob','/output','/work'])FS.mkdir(dir);
    FS.chdir('/work');
    FS.mount(mod.WORKERFS,{blobs:[{name:'input.ipa',data:ipa},{name:'identity.p12',data:certificate},{name:'profile.mobileprovision',data:profile}]},'/blob');
    phase('Signing on this device…');
    let code;
    try{code=mod.callMain(['-f','-k','/blob/identity.p12','-m','/blob/profile.mobileprovision','-p',password,'-z','1','-o','/output/Signed.ipa','/blob/input.ipa']);}
    catch(error){if(Number.isInteger(error?.status))code=error.status;else throw error;}
    if(code!==0)throw new Error(reason);
    const node=FS.analyzePath('/output/Signed.ipa').object;
    if(!node?.contents||node.usedBytes<22)throw new Error(reason);
    const bytes=node.contents.subarray(0,node.usedBytes);
    if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error(reason);
    self.postMessage({type:'signed',bytes},[bytes.buffer]);
  }catch(error){
    const known=/^(Choose |This |Split |IPAs |The IPA |This app |The provisioning |The certificate |Couldn’t open|Signing failed)/;
    const text=error instanceof Error&&known.test(error.message)?error.message:reason;
    self.postMessage({type:'failed',text});
  }finally{self.close();}
};
