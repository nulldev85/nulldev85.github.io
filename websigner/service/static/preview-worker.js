importScripts('/assets/vendor/fflate-0.8.3.js','/assets/zip-check.js','/assets/app-metadata.js');
self.onmessage=async event=>{
  if(event.data?.type!=='preview'||!(event.data.ipa instanceof Blob))return;
  try{
    const metadata=await readAppMetadata(event.data.ipa);
    self.postMessage({type:'preview',...metadata,iconDataURL:metadata.icon?appIconDataURL(metadata.icon):null},metadata.icon?[metadata.icon.buffer]:[]);
  }catch{self.postMessage({type:'unavailable'});}
  finally{self.close();}
};
