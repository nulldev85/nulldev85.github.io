/* Bounded ZIP directory preflight. No extraction, network, or credentials. */
async function checkIPA(file) {
  const MAX_INPUT=128*1024*1024, MAX_EXPANDED=240*1024*1024;
  if (!file || file.size<22 || file.size>MAX_INPUT) throw new Error('Choose an IPA no larger than 128 MB.');
  const tail=new Uint8Array(await file.slice(Math.max(0,file.size-65557)).arrayBuffer());
  const view=new DataView(tail.buffer,tail.byteOffset,tail.byteLength);
  let end=-1;
  for(let i=tail.length-22;i>=0;i--) if(view.getUint32(i,true)===0x06054b50 && i+22+view.getUint16(i+20,true)===tail.length){end=i;break;}
  if(end<0) throw new Error('This file is not a supported IPA archive.');
  const count=view.getUint16(end+10,true),size=view.getUint32(end+12,true),offset=view.getUint32(end+16,true);
  if(view.getUint16(end+4,true)||view.getUint16(end+6,true)||count===65535||size===0xffffffff||offset===0xffffffff) throw new Error('Split and ZIP64 archives are not supported in the web signer.');
  if(count<1||count>40000||size>8*1024*1024||offset+size>file.size-tail.length+end) throw new Error('This IPA has an invalid or oversized file list.');
  const raw=await file.slice(offset,offset+size).arrayBuffer(),cd=new DataView(raw),names=new Set();
  let p=0,total=0,apps=0;
  for(let i=0;i<count;i++){
    if(p+46>raw.byteLength||cd.getUint32(p,true)!==0x02014b50) throw new Error('This IPA has an invalid file list.');
    const flags=cd.getUint16(p+8,true),method=cd.getUint16(p+10,true),expanded=cd.getUint32(p+24,true),compressed=cd.getUint32(p+20,true),n=cd.getUint16(p+28,true),extra=cd.getUint16(p+30,true),comment=cd.getUint16(p+32,true),mode=cd.getUint32(p+38,true)>>>16,local=cd.getUint32(p+42,true);
    if(p+46+n+extra+comment>raw.byteLength||local+30>offset||compressed===0xffffffff||expanded===0xffffffff) throw new Error('This IPA contains an invalid file entry.');
    const name=new TextDecoder().decode(new Uint8Array(raw,p+46,n)),canonical=name.replace(/\/$/,'');
    if(!name||name.startsWith('/')||name.includes('\\')||name.includes('\0')||/^[a-z]:/i.test(name)||canonical.split('/').some(part=>part==='..'||part==='.'||part==='')||names.has(canonical)) throw new Error('This IPA has unsafe or duplicate file paths.');
    if((mode&0xf000)===0xa000) throw new Error('IPAs containing symbolic links are not supported.');
    if(flags&1||![0,8].includes(method)) throw new Error('This IPA uses unsupported ZIP encryption or compression.');
    total+=expanded;if(total>MAX_EXPANDED) throw new Error('This app expands beyond the web signer’s memory limit. Use the NullSign app.');
    if(/^Payload\/[^/]+\.app\/Info\.plist$/.test(name)) apps++;
    names.add(canonical);p+=46+n+extra+comment;
  }
  if(p!==raw.byteLength||apps!==1) throw new Error('Choose an IPA containing one app inside Payload.');
  return {files:count,expandedBytes:total};
}
