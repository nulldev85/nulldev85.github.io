importScripts('/assets/zip-check.js','/assets/app-metadata.js');
self.onmessage=async event=>{
  if(event.data?.type!=='preview'||!(event.data.ipa instanceof Blob))return;
  try{
    const metadata=await readAppMetadata(event.data.ipa);
    self.postMessage({type:'preview',...metadata},metadata.icon?[metadata.icon.buffer]:[]);
  }catch{self.postMessage({type:'unavailable'});}
  finally{self.close();}
};
