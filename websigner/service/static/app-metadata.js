/* Bounded, local-only IPA metadata/icon reader. Never receives signing files. */
const pngMagic=new Uint8Array([137,80,78,71,13,10,26,10]);
function crc32(bytes){let c=0xffffffff;for(const byte of bytes){c^=byte;for(let n=0;n<8;n++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
async function decompressBounded(bytes,format,limit){
  const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format)).getReader();
  const chunks=[];let total=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>limit)throw new Error('Preview is too large');chunks.push(value);}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const result=new Uint8Array(total);let p=0;for(const chunk of chunks){result.set(chunk,p);p+=chunk.length;}return result;
}
async function readIPAEntry(file,entry,limit){
  if(entry.expanded>limit||entry.compressed>limit)throw new Error('Preview entry too large');
  const header=new DataView(await file.slice(entry.local,entry.local+30).arrayBuffer());
  if(header.byteLength!==30||header.getUint32(0,true)!==0x04034b50)throw new Error('Invalid ZIP header');
  const start=entry.local+30+header.getUint16(26,true)+header.getUint16(28,true);
  if(start+entry.compressed>file.size)throw new Error('Invalid ZIP range');
  const raw=new Uint8Array(await file.slice(start,start+entry.compressed).arrayBuffer());
  const bytes=entry.method===0?raw:await decompressBounded(raw,'deflate-raw',limit);
  if(bytes.length!==entry.expanded||crc32(bytes)!==entry.crc)throw new Error('Invalid preview entry');
  return bytes;
}
function parseAppPlist(bytes){
  if(bytes.length>1024**2)throw new Error('Metadata too large');
  if(new TextDecoder().decode(bytes.subarray(0,8))!=='bplist00')return parseXMLPlist(new TextDecoder().decode(bytes));
  const end=bytes.length-32;if(end<8)throw new Error('Invalid plist');
  const number=(p,n)=>{if(n<1||n>8||p<0||p+n>bytes.length)throw new Error('Invalid integer');let v=0;for(let i=0;i<n;i++)v=v*256+bytes[p+i];if(!Number.isSafeInteger(v))throw new Error('Invalid integer');return v;};
  const offsetSize=bytes[end+6],refSize=bytes[end+7],count=number(end+8,8),top=number(end+16,8),table=number(end+24,8);
  if(count<1||count>20000||top>=count||offsetSize<1||offsetSize>8||refSize<1||refSize>8||table<8||table+count*offsetSize>end)throw new Error('Invalid object table');
  const cache=new Map(),active=new Set();let visits=0;
  function object(index,depth=0){
    if(depth>32||index>=count||++visits>50000)throw new Error('Invalid object graph');
    if(cache.has(index))return cache.get(index);if(active.has(index))throw new Error('Cyclic plist');active.add(index);
    let p=number(table+index*offsetSize,offsetSize);if(p<8||p>=table)throw new Error('Invalid object');
    const tag=bytes[p++],kind=tag>>>4;let n=tag&15;
    if([4,5,6,7,10,13].includes(kind)&&n===15){const marker=bytes[p++];if((marker>>>4)!==1||(marker&15)>3)throw new Error('Invalid length');const width=1<<(marker&15);n=number(p,width);p+=width;}
    const need=size=>{if(size<0||p+size>table)throw new Error('Invalid object length');};
    let value=null;
    if(kind===0)value=n===9?true:n===8?false:null;
    else if(kind===1){if(n>3)throw new Error('Invalid number');need(1<<n);value=number(p,1<<n);}
    else if(kind===2||kind===3)value=null;
    else if(kind===4){need(n);value=null;}
    else if(kind===5||kind===7){if(n>65536)throw new Error('String too large');need(n);value=new TextDecoder().decode(bytes.subarray(p,p+n));}
    else if(kind===6){if(n>65536)throw new Error('String too large');need(n*2);value=new TextDecoder('utf-16be').decode(bytes.subarray(p,p+n*2));}
    else if(kind===8){need(n+1);value=number(p,n+1);}
    else if(kind===10){if(n>20000)throw new Error('Array too large');need(n*refSize);value=[];for(let i=0;i<n;i++)value.push(object(number(p+i*refSize,refSize),depth+1));}
    else if(kind===13){if(n>20000)throw new Error('Dictionary too large');need(n*refSize*2);value=Object.create(null);for(let i=0;i<n;i++){const key=object(number(p+i*refSize,refSize),depth+1);if(typeof key!=='string')throw new Error('Invalid key');value[key]=object(number(p+(n+i)*refSize,refSize),depth+1);}}
    else throw new Error('Unsupported plist object');
    active.delete(index);cache.set(index,value);return value;
  }
  return object(top);
}
function parseXMLPlist(xml){
  const tokens=xml.match(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<[^>]*>|[^<]+/g)||[];
  if(tokens.length>50000)throw new Error('XML too large');let p=0;
  const decode=s=>s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_,key)=>{
    const known={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};if(known[key])return known[key];const n=key[1]?.toLowerCase()==='x'?parseInt(key.slice(2),16):parseInt(key.slice(1),10);return n>0&&n<=0x10ffff?String.fromCodePoint(n):'';
  });
  function skip(){while(p<tokens.length&&(/^\s*$/.test(tokens[p])||/^<\?|^<!/.test(tokens[p])))p++;}
  function value(depth=0){
    if(depth>32)throw new Error('XML too deep');skip();const tag=tokens[p++];
    if(/^<true\s*\/>$/.test(tag))return true;if(/^<false\s*\/>$/.test(tag))return false;
    const match=/^<(dict|array|string|key|integer|real|date|data)(\s*\/)?\s*>$/.exec(tag||'');if(!match)throw new Error('Unsupported XML');
    const type=match[1];if(match[2])return type==='dict'?Object.create(null):type==='array'?[]:'';
    if(type==='dict'){
      const out=Object.create(null);skip();while(tokens[p]!=='</dict>'){if(!/^<key\s*>/.test(tokens[p]||''))throw new Error('Invalid XML key');const key=value(depth+1);out[key]=value(depth+1);skip();}p++;return out;
    }
    if(type==='array'){const out=[];skip();while(tokens[p]!=='</array>'){out.push(value(depth+1));skip();}p++;return out;}
    let text='';while(p<tokens.length&&tokens[p]!==`</${type}>`){if(tokens[p].startsWith('<'))throw new Error('Invalid XML value');text+=tokens[p++];}if(tokens[p++]!==`</${type}>`)throw new Error('Invalid XML end');
    return type==='string'||type==='key'?decode(text):type==='integer'||type==='real'?Number(text):null;
  }
  skip();if(!/^<plist\b/.test(tokens[p++]||''))throw new Error('Missing plist');const result=value();skip();if(tokens[p]!=='</plist>')throw new Error('Invalid plist end');return result;
}
function pngInfo(bytes){
  if(bytes.length<33||!pngMagic.every((n,i)=>bytes[i]===n))throw new Error('Not PNG');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),chunks=[];let p=8,width=0,height=0,cgbi=false;
  while(p+12<=bytes.length){const length=view.getUint32(p),type=new TextDecoder().decode(bytes.subarray(p+4,p+8));if(p+12+length>bytes.length)throw new Error('Invalid PNG');const data=bytes.subarray(p+8,p+8+length);chunks.push({type,data});if(type==='CgBI')cgbi=true;if(type==='IHDR'){if(length!==13)throw new Error('Invalid PNG header');width=view.getUint32(p+8);height=view.getUint32(p+12);}p+=length+12;if(type==='IEND')break;}
  if(width<1||height<1||width>1024||height>1024)throw new Error('Icon dimensions too large');return {width,height,cgbi,chunks};
}
function pngChunk(type,data){const out=new Uint8Array(data.length+12),view=new DataView(out.buffer);view.setUint32(0,data.length);out.set(new TextEncoder().encode(type),4);out.set(data,8);view.setUint32(out.length-4,crc32(out.subarray(4,out.length-4)));return out;}
async function normalizeAppIcon(bytes){
  const info=pngInfo(bytes);if(!info.cgbi)return bytes;
  const ihdr=info.chunks.find(c=>c.type==='IHDR').data;
  if(ihdr[8]!==8||![2,6].includes(ihdr[9])||ihdr[12]!==0)throw new Error('Unsupported optimized PNG');
  const channels=ihdr[9]===6?4:3,stride=info.width*channels;
  const idats=info.chunks.filter(c=>c.type==='IDAT').map(c=>c.data),total=idats.reduce((n,b)=>n+b.length,0),compressed=new Uint8Array(total);let at=0;for(const part of idats){compressed.set(part,at);at+=part.length;}
  const raw=fflate.inflateSync(compressed,{out:new Uint8Array((stride+1)*info.height)});
  if(raw.length!==(stride+1)*info.height)throw new Error('Invalid icon pixels');
  const pixels=new Uint8Array(stride*info.height);
  const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
  for(let y=0;y<info.height;y++){
    const filter=raw[y*(stride+1)];if(filter>4)throw new Error('Invalid PNG filter');
    for(let x=0;x<stride;x++){const i=y*stride+x,a=x>=channels?pixels[i-channels]:0,b=y?pixels[i-stride]:0,c=y&&x>=channels?pixels[i-stride-channels]:0;pixels[i]=(raw[y*(stride+1)+x+1]+(filter===1?a:filter===2?b:filter===3?Math.floor((a+b)/2):filter===4?paeth(a,b,c):0))&255;}
  }
  const standard=new Uint8Array((stride+1)*info.height);
  for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
    const i=y*stride+x*channels,o=y*(stride+1)+1+x*channels,a=channels===4?pixels[i+3]:255;
    standard[o]=a?Math.min(255,Math.round(pixels[i+2]*255/a)):0;standard[o+1]=a?Math.min(255,Math.round(pixels[i+1]*255/a)):0;standard[o+2]=a?Math.min(255,Math.round(pixels[i]*255/a)):0;if(channels===4)standard[o+3]=a;
  }
  const encoded=fflate.zlibSync(standard,{level:1});
  const parts=[pngMagic,pngChunk('IHDR',ihdr),pngChunk('IDAT',encoded),pngChunk('IEND',new Uint8Array())],out=new Uint8Array(parts.reduce((n,b)=>n+b.length,0));at=0;for(const part of parts){out.set(part,at);at+=part.length;}return out;
}
async function readAppMetadata(file){
  const archive=await checkIPA(file),entry=archive.entries.find(e=>/^Payload\/[^/]+\.app\/Info\.plist$/.test(e.name));
  const info=parseAppPlist(await readIPAEntry(file,entry,1024**2));if(!info||typeof info!=='object')throw new Error('Invalid app metadata');
  const text=value=>typeof value==='string'?value.slice(0,160):'';
  const name=text(info.CFBundleDisplayName)||text(info.CFBundleName)||file.name?.replace(/\.(ipa|tipa)$/i,'')||'Selected app';
  const base=entry.name.slice(0,-10),primary=info.CFBundleIcons?.CFBundlePrimaryIcon||{},names=[...(Array.isArray(primary.CFBundleIconFiles)?primary.CFBundleIconFiles:[]),...(Array.isArray(info.CFBundleIconFiles)?info.CFBundleIconFiles:[]),info.CFBundleIconFile].filter(n=>typeof n==='string').map(n=>n.replace(/\.png$/i,'').toLowerCase());
  const rootPNGs=archive.entries.filter(e=>e.name.startsWith(base)&&!e.name.slice(base.length).includes('/')&&/\.png$/i.test(e.name)&&e.expanded<=2*1024**2&&e.compressed<=2*1024**2);
  let candidates=rootPNGs.filter(e=>names.some(n=>e.name.slice(base.length).toLowerCase().startsWith(n)));
  if(!candidates.length)candidates=rootPNGs.filter(e=>/^(appicon|icon)/i.test(e.name.slice(base.length)));
  candidates.sort((a,b)=>b.expanded-a.expanded);let icon=null,area=0;
  for(const candidate of candidates.slice(0,12)){try{const data=await readIPAEntry(file,candidate,2*1024**2),png=pngInfo(data);if(png.width*png.height>area){icon=data;area=png.width*png.height;}}catch{}}
  if(icon){try{icon=await normalizeAppIcon(icon);}catch{icon=null;}}
  return {name,bundle:text(info.CFBundleIdentifier),version:text(info.CFBundleShortVersionString),icon};
}
function appIconDataURL(bytes){
  let binary='';for(let p=0;p<bytes.length;p+=32768)binary+=String.fromCharCode(...bytes.subarray(p,p+32768));
  return 'data:image/png;base64,'+btoa(binary);
}
