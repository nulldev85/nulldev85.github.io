const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].at(-1)[1];
new vm.Script(script);
assert.match(html,/<iframe[^>]+id="signer-frame"[^>]+src="https:\/\/signer\.mateomedia\.link\/"[^>]+loading="eager"/);
assert.match(html,/#web-signer:not\(\[open\]\)\s*\{[^}]*visibility: hidden;[^}]*pointer-events: none;/);
assert.match(html,/#web-signer\[open\]\s*\{ animation: none; \}/);
assert.doesNotMatch(html,/signerFrame\.(?:src\s*=|removeAttribute\("src"\))/);
class Target{
 constructor(){this.events={};}
 addEventListener(name,handler){(this.events[name]??=[]).push(handler);}
 fire(name,event={}){for(const fn of this.events[name]||[])fn(event);}
}
const frame={style:{},contentWindow:{postMessage:(data,origin)=>messages.push({data,origin})}};
const messages=[];const window=new Target();
const dialog=new Target();dialog.id='web-signer';dialog.open=false;
dialog.querySelector=()=>({scrollTop:100,addEventListener(){}});
dialog.showModal=()=>{dialog.open=true;};
dialog.close=()=>{dialog.open=false;dialog.fire('close');};
const button=new Target();button.dataset={openDialog:'web-signer'};button.focus=()=>{};
const document={getElementById:id=>id==='signer-frame'?frame:dialog,querySelectorAll:selector=>selector==='[data-open-dialog]'?[button]:[dialog]};
const siteMenu={contains:()=>false,open:false};
vm.runInNewContext(script.slice(script.indexOf('const dialogReturnFocus'),script.indexOf('const repoButton')),{document,window,siteMenu});
button.fire('click');assert.equal(dialog.open,true);
dialog.close();assert.equal(messages.length,1);assert.equal(messages[0].data.type,'null-websigner-cancel');
assert.equal(messages[0].origin,'https://signer.mateomedia.link');
button.fire('click');dialog.close();assert.equal(messages.length,2);
console.log('PASS: eager form, hidden layout, immediate opening, no per-open navigation, reset message on every close.');

// Exercise the actual empty-form reset code, since the iframe now stays mounted.
const nodes=Object.fromEntries(['ipa','certificate','profile','password','status','signer','sign','cancel','upload-progress','install','hosted-actions','prepare','result','sign-form'].map(id=>[id,{value:'selected',hidden:false,disabled:true,classList:{add(){}},getBoundingClientRect:()=>({height:600})}]));
const childWindow=new Target();childWindow.parent={};childWindow.top={};
const calls={terminate:0,abort:0,revoke:0};
const context=vm.createContext({document:{getElementById:id=>nodes[id],body:{classList:{add(){}}}},window:childWindow,ResizeObserver:class{observe(){}},clearTimeout(){},URL:{revokeObjectURL(){calls.revoke++;}},testWorker:{terminate(){calls.terminate++;}},testUpload:{abort(){calls.abort++;}}});
const app=fs.readFileSync(path.join(root,'websigner/service/static/app.js'),'utf8');
vm.runInContext(app.slice(0,app.indexOf("$('cancel').addEventListener")),context);
vm.runInContext("worker=testWorker;upload=testUpload;signed={};downloadURL='blob:test';job={};",context);
childWindow.fire('message',{origin:'https://evil.example',source:childWindow.parent,data:{type:'null-websigner-cancel'}});
assert.equal(calls.terminate,0);
childWindow.fire('message',{origin:'https://nulldev85.github.io',source:childWindow.parent,data:{type:'null-websigner-cancel'}});
assert.deepEqual(calls,{terminate:1,abort:1,revoke:1});
for(const id of ['ipa','certificate','profile','password'])assert.equal(nodes[id].value,'');
assert.equal(vm.runInContext('worker===null && upload===null && signed===null && downloadURL===null && job===null',context),true);
assert.equal(nodes.result.hidden,true);assert.equal(nodes['sign-form'].hidden,false);
console.log('PASS: close terminates worker, aborts upload, clears files/password/output/link, revokes download URL; foreign reset ignored.');
