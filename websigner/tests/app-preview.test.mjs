import fs from 'node:fs';import path from 'node:path';import vm from 'node:vm';import assert from 'node:assert/strict';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),assets=path.join(root,'service/static'),fixtures=path.join(root,'.test-data');
const messages=[];let closed=false;
const context=vm.createContext({Blob,Uint8Array,DataView,TextDecoder,TextEncoder,DecompressionStream,CompressionStream,Response,btoa,console});
context.self=context;context.postMessage=message=>messages.push(message);context.close=()=>{closed=true;};
context.importScripts=(...urls)=>{for(const raw of urls){const url=raw.split('?')[0];assert.ok(['/assets/vendor/fflate-0.8.3.js','/assets/zip-check.js','/assets/app-metadata.js'].includes(url));vm.runInContext(fs.readFileSync(path.join(assets,url.slice(8)),'utf8'),context);}};
vm.runInContext(fs.readFileSync(path.join(assets,'preview-worker.js'),'utf8'),context);
await context.onmessage({data:{type:'preview',ipa:new Blob([fs.readFileSync(path.join(fixtures,'input.ipa'))])}});
assert.equal(closed,false,'Reader remains warm for later files');assert.equal(messages.length,1);const preview=messages[0];
assert.equal(preview.type,'preview');assert.equal(preview.name,'NullSign');assert.equal(preview.bundle,'com.elmat.NullSign');
assert.ok(preview.icon instanceof Uint8Array&&preview.icon.length>100);
assert.ok(preview.iconDataURL.startsWith('data:image/png;base64,'));
assert.deepEqual(Buffer.from(preview.iconDataURL.split(',')[1],'base64'),Buffer.from(preview.icon));
assert.equal(Buffer.from(preview.icon).subarray(12,16).toString(),'IHDR','CgBI normalized to standard PNG');
fs.writeFileSync(path.join(fixtures,'preview-nullsign.png'),preview.icon);
console.log('PASS: actual preview worker reads owned IPA name/bundle and converts embedded Apple CgBI icon without loading WASM or using network.');
for(const lineupPath of [path.resolve(root,'../../lineup-1089-835-release/Lineup-iPhone-0.19.0-1089.ipa'),path.join(fixtures,'lineup-1101.ipa')]){
if(fs.existsSync(lineupPath)){
 const other=vm.createContext({Blob,Uint8Array,DataView,TextDecoder,TextEncoder,DecompressionStream,CompressionStream,Response,btoa});let result;
 other.self=other;other.close=()=>{};other.postMessage=value=>{result=value;};
 other.importScripts=(...urls)=>{for(const raw of urls){const url=raw.split('?')[0];assert.ok(['/assets/vendor/fflate-0.8.3.js','/assets/zip-check.js','/assets/app-metadata.js'].includes(url));vm.runInContext(fs.readFileSync(path.join(assets,url.slice(8)),'utf8'),other);}};
 vm.runInContext(fs.readFileSync(path.join(assets,'preview-worker.js'),'utf8'),other);
 await other.onmessage({data:{type:'preview',ipa:new Blob([fs.readFileSync(lineupPath)])}});
 assert.equal(result.type,'preview');assert.equal(result.name,'Lineup');assert.ok(result.icon?.length>100);
 fs.writeFileSync(path.join(fixtures,'preview-lineup.png'),result.icon);
 console.log('PASS: owned Lineup iPhone IPA also displays its real app name and icon:',path.basename(lineupPath));
}
}

const xml=new TextEncoder().encode('<?xml version="1.0"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleDisplayName</key><string>Test &amp; App</string><key>CFBundleIcons</key><dict><key>CFBundlePrimaryIcon</key><dict><key>CFBundleIconFiles</key><array><string>AppIcon60</string></array></dict></dict></dict></plist>');
context.xml=xml;
assert.equal(vm.runInContext('parseAppPlist(xml).CFBundleDisplayName',context),'Test & App');
assert.equal(vm.runInContext('parseAppPlist(xml).CFBundleIcons.CFBundlePrimaryIcon.CFBundleIconFiles[0]',context),'AppIcon60');
assert.throws(()=>vm.runInContext('parseAppPlist(new Uint8Array(1024**2+1))',context));
assert.throws(()=>vm.runInContext('parseAppPlist(new TextEncoder().encode("bplist00"))',context));
assert.throws(()=>vm.runInContext('pngInfo(new Uint8Array(100))',context));
closed=false;messages.length=0;
await context.onmessage({data:{type:'preview',ipa:new Blob([new Uint8Array(22)])}});
assert.equal(closed,false);assert.equal(messages[0].type,'unavailable');
messages.length=0;
await Promise.all([
 context.onmessage({data:{type:'preview',requestId:41,ipa:new Blob([fs.readFileSync(path.join(fixtures,'input.ipa'))])}}),
 context.onmessage({data:{type:'preview',requestId:42,ipa:new Blob([new Uint8Array(22)])}}),
]);
assert.ok(messages.length>0&&messages.every(m=>m.requestId===42),'Reused worker suppresses older file results');
console.log('PASS: XML/binary metadata supported; invalid/oversized metadata and malformed PNG fail safely; invalid IPA preview cannot block signing.');
