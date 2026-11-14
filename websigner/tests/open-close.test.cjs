const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
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
const button=new Target();button.dataset={openDialog:'web-signer'};button.focus=()=>{};button.closest=()=>null;
const guide=new Target();guide.id='appletv-install';guide.open=false;guide.querySelector=dialog.querySelector;
guide.showModal=()=>{guide.open=true;};
let delayedGuideClose;guide.close=()=>{guide.open=false;delayedGuideClose=()=>guide.fire('close');};
let guideFocus=0;
const guideOpen=new Target();guideOpen.dataset={openDialog:'appletv-install'};guideOpen.closest=()=>null;guideOpen.focus=()=>{guideFocus++;};
const document={getElementById:id=>id==='signer-frame'?frame:id==='appletv-install'?guide:dialog,querySelector:()=>dialog.open?dialog:guide.open?guide:null,querySelectorAll:selector=>selector==='[data-open-dialog]'?[button,guideOpen]:[dialog,guide]};
const siteMenu={contains:()=>false,open:false};
vm.runInNewContext(script.slice(script.indexOf('const dialogReturnFocus'),script.indexOf('const repoButton')),{document,window,siteMenu});
button.fire('click');assert.equal(dialog.open,true);
dialog.close();assert.equal(messages.length,1);assert.equal(messages[0].data.type,'null-websigner-cancel');
assert.equal(messages[0].origin,'https://signer.mateomedia.link');
button.fire('click');dialog.close();assert.equal(messages.length,2);
console.log('PASS: eager form, hidden layout, immediate opening, no per-open navigation, reset message on every close.');
guideOpen.fire('click');assert.equal(guide.open,true);
guide.close();delayedGuideClose();assert.equal(guideFocus,1,'Return focus to Apple TV Guide button');
assert.match(html,/>Apple TV Guide<\/button>/);
assert.doesNotMatch(html,/id="nullsign-install"|data-open-dialog="nullsign-install"|>Tutorials<\/summary>/);
const previous=execFileSync('git',['show','c4d05df:index.html'],{cwd:root,encoding:'utf8'});
const tvGuide=text=>text.match(/<dialog\b[^>]*id="appletv-install"[\s\S]*?<\/dialog>/)[0].replace(/\r/g,'');
assert.equal(tvGuide(html),tvGuide(previous),'Apple TV instructions retained');
console.log('PASS: direct Apple TV Guide button opens guide and restores focus; redundant main-page iPhone guide removed.');

// Exercise the actual empty-form reset code, since the iframe now stays mounted.
const nodes=Object.fromEntries(['ipa','certificate','profile','password','status','signer','sign','cancel','upload-progress','install','hosted-actions','prepare','result','sign-form','signer-panel','tutorials-panel','signer-tab','tutorials-tab'].map(id=>[id,Object.assign(new Target(),{value:'selected',files:[{name:id+'.test'}],hidden:false,disabled:true,attributes:{},setAttribute(name,value){this.attributes[name]=value;},classList:{add(){},toggle(){}},getBoundingClientRect:()=>({height:600})})]));
nodes['signer-tab'].dataset={signerView:'signer'};nodes['tutorials-tab'].dataset={signerView:'tutorials'};
const childWindow=new Target();childWindow.parent={postMessage(){}};childWindow.top={};
const calls={terminate:0,abort:0,revoke:0};
const context=vm.createContext({document:{getElementById:id=>nodes[id],querySelectorAll:()=>[nodes['signer-tab'],nodes['tutorials-tab']],addEventListener(){},body:{classList:{add(){}}}},window:childWindow,ResizeObserver:class{observe(){}},clearTimeout(){},URL:{revokeObjectURL(){calls.revoke++;}},testWorker:{terminate(){calls.terminate++;}},testUpload:{abort(){calls.abort++;}}});
const app=fs.readFileSync(path.join(root,'websigner/service/static/app.js'),'utf8');
vm.runInContext(app.slice(0,app.indexOf("$('cancel').addEventListener")),context);
vm.runInContext("worker=testWorker;upload=testUpload;signed={};downloadURL='blob:test';job={};",context);
const selected=Object.fromEntries(['ipa','certificate','profile','password'].map(id=>[id,nodes[id].files]));
for(let i=0;i<10;i++){
 nodes['tutorials-tab'].fire('click');
 assert.equal(nodes['signer-panel'].hidden,true);assert.equal(nodes['tutorials-panel'].hidden,false);
 assert.equal(nodes['tutorials-tab'].attributes['aria-pressed'],'true');
 nodes['signer-tab'].fire('click');
 assert.equal(nodes['signer-panel'].hidden,false);assert.equal(nodes['tutorials-panel'].hidden,true);
 for(const id of Object.keys(selected)){assert.equal(nodes[id].value,'selected');assert.equal(nodes[id].files,selected[id]);}
 assert.equal(vm.runInContext("worker===testWorker && upload===testUpload && signed!==null && downloadURL==='blob:test' && job!==null",context),true);
}
assert.deepEqual(calls,{terminate:0,abort:0,revoke:0});
console.log('PASS: repeated tutorial/form switching retains exact file inputs, password, active signing/upload and signed output without reset or navigation.');
const signerHTML=fs.readFileSync(path.join(root,'websigner/service/static/index.html'),'utf8');
assert.match(signerHTML,/id="tutorials-panel"/);
assert.match(signerHTML,/Install NullSign on iPhone/);
assert.doesNotMatch(signerHTML,/Apple TV|tvOS/);
assert.match(html,/id="appletv-install"/);
assert.match(html,/data-open-dialog="appletv-install"/);
console.log('PASS: only iPhone tutorial embedded; Apple TV guide remains in site menu.');
childWindow.fire('message',{origin:'https://evil.example',source:childWindow.parent,data:{type:'null-websigner-cancel'}});
assert.equal(calls.terminate,0);
childWindow.fire('message',{origin:'https://nulldev85.github.io',source:childWindow.parent,data:{type:'null-websigner-cancel'}});
assert.deepEqual(calls,{terminate:1,abort:1,revoke:1});
for(const id of ['ipa','certificate','profile','password'])assert.equal(nodes[id].value,'');
assert.equal(vm.runInContext('worker===null && upload===null && signed===null && downloadURL===null && job===null',context),true);
assert.equal(nodes.result.hidden,true);assert.equal(nodes['sign-form'].hidden,false);
console.log('PASS: close terminates worker, aborts upload, clears files/password/output/link, revokes download URL; foreign reset ignored.');
