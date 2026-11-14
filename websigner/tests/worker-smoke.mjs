// Execute the production worker with real WASM and a synchronous Blob reader
// boundary. This tests worker I/O and privacy wiring, not Safari compatibility.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const assets=path.join(root,'service/static');
const fixtures=path.join(root,'.test-data');
const zipContext=vm.createContext({Blob,ArrayBuffer,Uint8Array,DataView,TextDecoder});
vm.runInContext(fs.readFileSync(path.join(assets,'zip-check.js'),'utf8'),zipContext);
const original=fs.readFileSync(path.join(fixtures,'input.ipa'));
const end=original.lastIndexOf(Buffer.from('504b0506','hex'));
const central=original.readUInt32LE(end+16);
await zipContext.checkIPA(new Blob([original]));
for(const [name,mutate] of [
 ['unsafe path',b=>b.write('../',central+46)],
 ['symbolic link',b=>b.writeUInt32LE(0xa1ff0000,central+38)],
 ['ZIP64',b=>b.writeUInt16LE(65535,end+10)],
 ['expanded size',b=>b.writeUInt32LE(769*1024**2,central+24)],
 ['encryption',b=>b.writeUInt16LE(1,central+8)],
 ['invalid local offset',b=>b.writeUInt32LE(central,central+42)],
]){
 const bytes=Buffer.from(original);mutate(bytes);
 await assert.rejects(zipContext.checkIPA(new Blob([bytes])));
 console.log('PASS: ZIP preflight rejects',name);
}
class TestBlob extends Blob{
 constructor(parts){super(parts);this.bytes=Buffer.concat(parts.map(p=>Buffer.from(p)));}
 slice(start=0,end=this.size){return new TestBlob([this.bytes.subarray(start<0?this.size+start:start,end<0?this.size+end:end)]);}
}
for(const profile of ['valid.mobileprovision','expired.mobileprovision']){
 const messages=[],requests=[];let closed=false;
 const context=vm.createContext({Blob:TestBlob,ArrayBuffer,Uint8Array,Int8Array,Int16Array,Uint16Array,Int32Array,Uint32Array,Float32Array,Float64Array,BigInt64Array,BigUint64Array,DataView,TextDecoder,TextEncoder,WebAssembly,URL,Response,console,performance,setTimeout,clearTimeout,crypto:webcrypto,location:{href:'https://signer.mateomedia.link/assets/worker.js'},FileReaderSync:class{readAsArrayBuffer(blob){return Uint8Array.from(blob.bytes).buffer;}}});
 context.self=context;
 context.WorkerGlobalScope=class {};
 context.postMessage=message=>messages.push(message);
 context.close=()=>{closed=true;};
 context.fetch=async url=>{requests.push(String(url));assert.equal(new URL(url,'https://signer.mateomedia.link').href,'https://signer.mateomedia.link/assets/engine/zsign-mobile.wasm');return new Response(fs.readFileSync(path.join(assets,'engine/zsign-mobile.wasm')),{headers:{'Content-Type':'application/wasm'}});};
 context.importScripts=(url)=>{assert.ok(['/assets/zip-check.js','/assets/engine/zsign-mobile.js'].includes(url));vm.runInContext(fs.readFileSync(path.join(assets,url.slice('/assets/'.length)),'utf8'),context,{filename:url});};
 vm.runInContext(fs.readFileSync(path.join(assets,'worker.js'),'utf8'),context);
 const blob=name=>new TestBlob([fs.readFileSync(path.join(fixtures,name))]);
 await context.onmessage({data:{type:'sign',ipa:blob('input.ipa'),certificate:blob('identity.p12'),profile:blob(profile),password:'test-only'}});
 assert.ok(closed);assert.equal(requests.length,1);
 const last=messages.at(-1);
 if(profile==='valid.mobileprovision'){
   assert.equal(last.type,'signed',JSON.stringify(messages));assert.ok(last.bytes.length>1000);
   fs.writeFileSync(path.join(fixtures,'worker-signed.ipa'),last.bytes);
 }else assert.equal(last.type,'failed',JSON.stringify(messages));
 assert.ok(messages.every(m=>!JSON.stringify(m).includes('test-only')));
 console.log('PASS: actual worker /',profile,'/ only own WASM fetched / no credential messages');
}
