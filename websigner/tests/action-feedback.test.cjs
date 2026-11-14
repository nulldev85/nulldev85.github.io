const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
(async()=>{
class Target{
 constructor(){this.events={};}
 addEventListener(type,handler){(this.events[type]??=[]).push(handler);}
 fire(type,event={}){for(const handler of this.events[type]||[])handler({preventDefault(){},...event});}
}
class Element extends Target{
 constructor(tag='BUTTON'){
  super();this.tagName=tag;this.hidden=false;this.disabled=false;this.attributes={};this.files=[];this._value='';this.classes=new Set();
  this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x),toggle:(x,on)=>on?this.classes.add(x):this.classes.delete(x)};
 }
 set value(value){this._value=value;if(value==='')this.files=[];}
 get value(){return this._value;}
 set textContent(value){this._text=value;this.textWrites=(this.textWrites||0)+1;}
 get textContent(){return this._text;}
 setAttribute(name,value){this.attributes[name]=value;}
 removeAttribute(name){delete this.attributes[name];}
 replaceWith(next){nodes[this.id]=next;}
 getBoundingClientRect(){return {left:0,right:100,top:0,bottom:44,height:44};}
 closest(){return this;}
 matches(selector){return selector===':disabled'?this.disabled:['BUTTON','SUMMARY','INPUT'].includes(this.tagName);}
}
const ids=['ipa','certificate','profile','password','status','signer','sign','cancel','upload-progress','upload-progress-fill','install','hosted-actions','prepare','result','sign-form','save','again','delete','copy-install','signer-panel','tutorials-panel','signer-tab','tutorials-tab','ipa-name','certificate-name','profile-name','app-preview','app-icon','app-placeholder','app-name','app-detail'];
const nodes=Object.fromEntries(ids.map(id=>[id,new Element()]));
for(const id of ids){nodes[id].id=id;nodes[id].style={};}
for(const id of ['ipa','certificate','profile','password'])nodes[id].tagName='INPUT';
for(const id of ['result','install','hosted-actions','tutorials-panel','app-preview','app-icon'])nodes[id].hidden=true;
nodes['signer-tab'].dataset={signerView:'signer'};nodes['tutorials-tab'].dataset={signerView:'tutorials'};
const document=new Target();document.getElementById=id=>nodes[id];document.body=new Element();
document.querySelectorAll=selector=>selector==='[data-signer-view]'?[nodes['signer-tab'],nodes['tutorials-tab']]:Object.values(nodes).filter(n=>n.classes.has('is-pressed'));
const window=new Target();window.top=window;window.parent=window;
const workers=[],uploads=[];
const images=[];class Image extends Element{constructor(){super('IMG');this.naturalWidth=0;this.complete=false;images.push(this);}decode(){return new Promise((resolve,reject)=>{this.finishDecode=resolve;this.failDecode=reject;});}}
class Worker{constructor(url){this.url=url;workers.push(this);}postMessage(data){this.sent=data;}terminate(){this.terminated=true;}}
class XHR{constructor(){this.upload={};uploads.push(this);}open(){}setRequestHeader(){}send(){}abort(){this.onabort?.();}}
const context=vm.createContext({document,window,Element,Image,Worker,XMLHttpRequest:XHR,Blob,Uint8Array,Date,URL:{createObjectURL:()=> 'blob:test',revokeObjectURL(){}},location:{origin:'https://signer.mateomedia.link'},ResizeObserver:class{observe(){}},setTimeout:()=>1,clearTimeout(){}});
const source=fs.readFileSync(path.join(__dirname,'../service/static/app.js'),'utf8');
vm.runInContext(source,context);
const ready=id=>nodes[id].classes.has('is-ready');
const busy=id=>nodes[id].attributes['aria-busy']==='true';
assert.equal(ready('sign'),false);
nodes.ipa.fire('pointerdown');assert.equal(workers.length,1);assert.equal(workers[0].sent,undefined,'Reader warms before file selection without receiving data');
for(const id of ['ipa','certificate','profile']){nodes[id].files=[{name:id+'.ipa',size:100}];nodes[id].fire('change');}
assert.equal(nodes['certificate-name'].textContent,'certificate.ipa');assert.equal(nodes['profile-name'].textContent,'profile.ipa');
const oldPreview=workers.at(-1),oldRequest=oldPreview.sent.requestId;assert.ok(oldPreview.url.startsWith('/assets/preview-worker.js?v='));
assert.deepEqual(Object.keys(oldPreview.sent).sort(),['ipa','requestId','type'],'Preview receives no signing identity/profile/password');
nodes.ipa.files=[{name:'too-large.ipa',size:512*1024**2+1}];nodes.ipa.fire('change');
assert.equal(ready('sign'),false);nodes['sign-form'].fire('submit');assert.equal(workers.filter(w=>w.url==='/assets/worker.js').length,0);
assert.match(nodes.status.textContent,/512 MB/);
nodes.ipa.files=[{name:'limit.ipa',size:512*1024**2}];nodes.ipa.fire('change');
assert.ok(!oldPreview.terminated,'Preview reader is reused across selections');
oldPreview.onmessage({data:{type:'preview',requestId:oldRequest,name:'Stale icon'}});assert.notEqual(nodes['app-name'].textContent,'Stale icon');
const currentPreview=workers.at(-1);
currentPreview.onmessage({data:{type:'preview',requestId:currentPreview.sent.requestId,name:'Lineup',version:'0.19.0',bundle:'com.nulldev85.NullSports.iOS',iconDataURL:'data:image/png;base64,iVBORw0KGgo='}});
assert.equal(nodes['app-icon'].hidden,true,'Do not insert an undecoded image');
const embedded=images.at(-1),lateError=embedded.onerror;embedded.onerror();
const fallback=images.at(-1);assert.ok(fallback.src.startsWith('/assets/app-icons/lineup.png?v='));
fallback.naturalWidth=56;fallback.complete=true;const lateFallbackError=fallback.onerror;fallback.onload();
assert.notEqual(nodes['app-icon'],fallback,'Commit waits for actual image decoding');fallback.finishDecode();await Promise.resolve();
assert.equal(nodes['app-icon'],fallback);assert.equal(nodes['app-icon'].hidden,false);assert.equal(nodes['app-placeholder'].hidden,true);
lateError();lateFallbackError();assert.equal(nodes['app-icon'],fallback);assert.equal(nodes['app-placeholder'].hidden,true,'Late errors cannot remove a committed icon');
const readCount=workers.length,imageCount=images.length;nodes.ipa.fire('change');
assert.equal(workers.length,readCount);assert.equal(images.length,imageCount);assert.equal(nodes['app-icon'],fallback);assert.equal(nodes['app-icon'].hidden,false);
nodes['tutorials-tab'].fire('click');nodes['signer-tab'].fire('click');
assert.equal(nodes['app-name'].textContent,'Lineup');assert.equal(nodes.ipa.files[0].name,'limit.ipa');
assert.equal(ready('sign'),true);
nodes['sign-form'].fire('submit');
assert.equal(ready('sign'),false);assert.equal(busy('sign'),true);assert.equal(ready('prepare'),false);
workers.at(-1).onmessage({data:{type:'phase',text:'Packaging the signed IPA…'}});
assert.equal(busy('sign'),true);assert.equal(ready('install'),false);
workers.at(-1).onmessage({data:{type:'signed',bytes:new Uint8Array([80,75,3,4])}});
assert.equal(nodes['app-icon'].hidden,false,'App preview remains visible with signed result');
assert.equal(nodes['certificate-name'].textContent,'No .p12 selected');
assert.equal(busy('sign'),false);assert.equal(ready('prepare'),true);assert.equal(ready('install'),false);
nodes.prepare.fire('click');let upload=uploads.at(-1);
assert.equal(busy('prepare'),true);assert.equal(ready('prepare'),false);
upload.upload.onprogress({lengthComputable:true,loaded:64123,total:100000});
assert.equal(nodes['upload-progress-fill'].style.transform,'scaleX(0.64123)','Smooth bar uses fractional byte progress');
assert.equal(nodes['upload-progress'].attributes['aria-valuenow'],'64');
const textWrites=nodes.status.textWrites;
upload.upload.onprogress({lengthComputable:true,loaded:64124,total:100000});
assert.equal(nodes['upload-progress-fill'].style.transform,'scaleX(0.64124)');assert.equal(nodes.status.textWrites,textWrites,'Fractional updates do not repeatedly redraw unchanged percentage text');
upload.upload.onprogress({lengthComputable:true,loaded:63000,total:100000});assert.equal(nodes['upload-progress-fill'].style.transform,'scaleX(0.64124)','Bar cannot regress');
upload.upload.onprogress({lengthComputable:true,loaded:100,total:100});
assert.equal(ready('install'),false,'100% uploaded is not ready until server accepts');
upload.onerror();assert.equal(busy('prepare'),false);assert.equal(ready('prepare'),true);const oldUpload=upload;
nodes.prepare.fire('click');upload=uploads.at(-1);
assert.equal(nodes['upload-progress-fill'].style.transform,'scaleX(0)','Retry resets bar');
oldUpload.upload.onprogress({lengthComputable:true,loaded:100,total:100});assert.equal(nodes['upload-progress-fill'].style.transform,'scaleX(0)','Old upload events cannot affect retry');
upload.status=201;upload.responseText=JSON.stringify({token:'a'.repeat(64),deleteToken:'test-only',expires:Math.floor(Date.now()/1000)+1200});upload.onload();
assert.equal(busy('prepare'),false);assert.equal(ready('prepare'),false);assert.equal(ready('install'),true);
nodes.install.fire('click');assert.equal(nodes.status.textContent,'Confirm Install in the iPhone prompt.');
assert.doesNotMatch(nodes.status.textContent,/installed|completed/i);
nodes['tutorials-tab'].fire('click');nodes['signer-tab'].fire('click');assert.equal(ready('install'),true);
vm.runInContext('job.expires=0',context);window.fire('focus');assert.equal(ready('install'),false);
let prevented=false;nodes.install.fire('click',{preventDefault(){prevented=true;}});
assert.ok(prevented);assert.equal(ready('prepare'),true);
console.log('PASS: readiness glow follows real input/sign/upload/server states; busy markers clear on completion/error; no premature install or success claim.');
window.fire('message',{origin:'https://nulldev85.github.io',source:window.parent,data:{type:'null-websigner-cancel'}});
assert.equal(nodes['app-preview'].hidden,true);assert.equal(nodes['app-icon'].hidden,true);
assert.equal(nodes['ipa-name'].textContent,'No IPA selected');
console.log('PASS: clean picker filenames update/reset; preview gets only IPA, rejects stale responses, survives tutorial/signing and clears on close.');

const summary=new Element('SUMMARY');nodes.summary=summary;
for(const node of [nodes.prepare,nodes.ipa,summary]){
 node.disabled=false;
 const event={target:node,isPrimary:true,button:0,pointerId:1,clientX:20,clientY:20};
 for(const end of ['pointerup','pointercancel','lostpointercapture','scroll']){
  document.fire('pointerdown',event);assert.ok(node.classes.has('is-pressed'));
  document.fire('pointermove',{...event,clientX:120});assert.ok(!node.classes.has('is-pressed'));
  document.fire('pointermove',event);assert.ok(node.classes.has('is-pressed'));
  document.fire(end,event);assert.ok(!node.classes.has('is-pressed'));
 }
 document.fire('keydown',{target:node,key:' ',repeat:false});assert.ok(node.classes.has('is-pressed'));
 document.fire('keyup');assert.ok(!node.classes.has('is-pressed'));
 document.fire('pointerdown',event);window.fire('blur');assert.ok(!node.classes.has('is-pressed'));
 node.disabled=true;document.fire('pointerdown',event);assert.ok(!node.classes.has('is-pressed'));node.disabled=false;
}
const css=fs.readFileSync(path.join(__dirname,'../service/static/style.css'),'utf8');
assert.ok(css.indexOf('.button.is-ready')<css.indexOf('.button.is-pressed'));
assert.match(css,/input\[type=file\]\.is-pressed::file-selector-button/);
assert.match(css,/prefers-reduced-motion:reduce[\s\S]*aria-busy=true[\s\S]*animation:none/);
const html=fs.readFileSync(path.join(__dirname,'../service/static/index.html'),'utf8');
assert.doesNotMatch(html,/id="app-detail"/);
console.log('PASS: buttons, file choosers and tutorial summaries share held press/release/cancel/scroll/keyboard/blur behavior; disabled controls stay still; reduced motion honored.');
})().catch(error=>{console.error(error);process.exitCode=1;});
