import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const evidence=path.resolve(root,'../../websigner-build');
const create=(await import(pathToFileURL(path.join(evidence,'zsign-mobile.mjs')).href)).default;
const wasm=fs.readFileSync(path.join(root,'service/static/engine/zsign-mobile.wasm'));
const fixtures=path.join(root,'.test-data');
for(const test of [
 {name:'valid',password:'test-only',profile:'valid.mobileprovision',code:0},
 {name:'empty password',password:'',p12:'identity-no-password.p12',profile:'valid.mobileprovision',code:0},
 {name:'wrong password',password:'wrong-test-only',profile:'valid.mobileprovision',error:'correct file and password'},
 {name:'expired profile',password:'test-only',profile:'expired.mobileprovision',error:'NULL_PROFILE_EXPIRED'},
 {name:'profile mismatch',password:'test-only',profile:'mismatch.mobileprovision',error:'NULL_CERTIFICATE_MISMATCH_OR_EXPIRED'},
 {name:'unsupported issuer fails closed',password:'test-only',p12:'unsupported.p12',profile:'unsupported.mobileprovision',error:'NULL_CMS_SIGNATURE_FAILED'},
]){
 const logs=[];
 const mod=await create({noInitialRun:true,wasmBinary:wasm,print:s=>logs.push(s),printErr:s=>logs.push(s)});
 for(const dir of ['/blob','/output','/work'])mod.FS.mkdir(dir);
 mod.FS.chdir('/work');
 for(const [dest,source] of [['input.ipa','input.ipa'],['identity.p12',test.p12||'identity.p12'],['profile.mobileprovision',test.profile]]) mod.FS.writeFile('/blob/'+dest,fs.readFileSync(path.join(fixtures,source)));
 let code;try{code=mod.callMain(['-f','-k','/blob/identity.p12','-m','/blob/profile.mobileprovision','-p',test.password,'-z','1','-o','/output/Signed.ipa','/blob/input.ipa']);}catch(error){if(Number.isInteger(error?.status))code=error.status;else throw error;}
 if(test.code===0){
  assert.equal(code,0,logs.filter(s=>/Error|failed|Can't/.test(s)).join('\n'));
  const bytes=mod.FS.readFile('/output/Signed.ipa');assert.ok(bytes.length>1000);
  if(test.name==='valid'){fs.writeFileSync(path.join(fixtures,'signed.ipa'),bytes);fs.writeFileSync(path.join(fixtures,'engine-valid.log'),logs.join('\n'));}
 }else{
  assert.notEqual(code,0);assert.ok(logs.some(s=>s.includes(test.error)));
  assert.equal(mod.FS.analyzePath('/output/Signed.ipa').exists,false);
 }
 console.log('PASS:',test.name);
}
