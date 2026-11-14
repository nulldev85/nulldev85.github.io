// Production worker + real WASM; file-backed Blob/FileReaderSync boundary avoids
// copying a half-gigabyte fixture just to simulate a browser File's lazy reads.
import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixtures=path.join(root,'.test-data'),assets=path.join(root,'service/static');
class FileBlob extends Blob{
 constructor(filename,start=0,length=fs.statSync(filename).size-start){super([]);this.filename=filename;this.start=start;this.length=length;}
 get size(){return this.length;}
 slice(start=0,end=this.size){const normalize=n=>n<0?Math.max(0,this.size+n):Math.min(n,this.size);start=normalize(start);end=normalize(end);return new FileBlob(this.filename,this.start+start,Math.max(0,end-start));}
 read(){const data=new Uint8Array(this.size);const fd=fs.openSync(this.filename,'r');try{let n=0;while(n<data.length){const got=fs.readSync(fd,data,n,data.length-n,this.start+n);if(!got)throw new Error('Short fixture read');n+=got;}}finally{fs.closeSync(fd);}return data.buffer;}
 async arrayBuffer(){return this.read();}
}
const messages=[],requests=[];let closed=false,output=0;
const context=vm.createContext({Blob:FileBlob,ArrayBuffer,Uint8Array,Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,DataView,TextDecoder,TextEncoder,WebAssembly,URL,Response,console,performance,setTimeout,clearTimeout,crypto:webcrypto,location:{href:'https://signer.mateomedia.link/assets/worker.js'},WorkerGlobalScope:class{},FileReaderSync:class{readAsArrayBuffer(blob){return blob.read();}}});
context.self=context;context.close=()=>{closed=true;};
context.postMessage=message=>{
 if(message.type==='signed'){output=message.bytes.length;fs.writeFileSync(path.join(fixtures,'large-signed.ipa'),message.bytes);}
 else{messages.push(message);console.log(message.type+':',message.text);}
};
context.fetch=async url=>{requests.push(String(url));assert.equal(new URL(url,'https://signer.mateomedia.link').pathname,'/assets/engine/zsign-mobile.wasm');return new Response(fs.readFileSync(path.join(assets,'engine/zsign-mobile.wasm')),{headers:{'Content-Type':'application/wasm'}});};
context.importScripts=url=>{assert.ok(['/assets/zip-check.js','/assets/engine/zsign-mobile.js'].includes(url));vm.runInContext(fs.readFileSync(path.join(assets,url.slice(8)),'utf8'),context,{filename:url});};
vm.runInContext(fs.readFileSync(path.join(assets,'worker.js'),'utf8'),context);
const input=new FileBlob(path.join(fixtures,'large-input.ipa'));
assert.ok(input.size>490*1024**2&&input.size<=512*1024**2);
await context.onmessage({data:{type:'sign',ipa:input,certificate:new FileBlob(path.join(fixtures,'identity.p12')),profile:new FileBlob(path.join(fixtures,'valid.mobileprovision')),password:'test-only'}});
assert.ok(closed);assert.equal(requests.length,1);assert.ok(output>490*1024**2,JSON.stringify(messages));
console.log('PASS: production worker signed',input.size,'input bytes into',output,'output bytes; only own WASM fetched.');
