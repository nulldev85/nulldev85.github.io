const previewAssetQuery=self.location?.search||'?v=icon-stable-1';
importScripts('/assets/vendor/fflate-0.8.3.js'+previewAssetQuery,'/assets/zip-check.js'+previewAssetQuery,'/assets/app-metadata.js'+previewAssetQuery);
let currentPreview=0;
self.onmessage=async event=>{
  if(event.data?.type!=='preview'||!(event.data.ipa instanceof Blob))return;
  const requestId=Number.isSafeInteger(event.data.requestId)?event.data.requestId:0;currentPreview=requestId;
  try{
    const metadata=await readAppMetadata(event.data.ipa);
    if(currentPreview===requestId)self.postMessage({type:'preview',requestId,...metadata,iconDataURL:metadata.icon?appIconDataURL(metadata.icon):null},metadata.icon?[metadata.icon.buffer]:[]);
  }catch{if(currentPreview===requestId)self.postMessage({type:'unavailable',requestId});}
};
