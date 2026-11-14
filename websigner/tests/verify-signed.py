"""Verify real WASM output: Mach-O page hashes and detached CMS signatures."""
from pathlib import Path
import hashlib, math, plistlib, struct, subprocess, zipfile, sys

root=Path(__file__).resolve().parent.parent/'.test-data'
openssl=Path('C:/Program Files/Git/usr/bin/openssl.exe')
if not openssl.is_file(): openssl=Path('/usr/bin/openssl')
u32=lambda b,o:struct.unpack_from('>I',b,o)[0]

def slices(binary):
    magic=binary[:4]
    if magic in (b'\xca\xfe\xba\xbe',b'\xca\xfe\xba\xbf'):
        count=u32(binary,4);step=32 if magic.endswith(b'\xbf') else 20
        assert 0<count<32
        for i in range(count):
            p=8+i*step
            off,size=struct.unpack_from('>QQ' if step==32 else '>II',binary,p+8)
            assert off+size<=len(binary)
            yield binary[off:off+size]
    else: yield binary

def verify(binary,index,resources=None):
    total=0
    for arch in slices(binary):
        assert arch[:4] in (b'\xcf\xfa\xed\xfe',b'\xce\xfa\xed\xfe')
        n,command_bytes=struct.unpack_from('<II',arch,16)
        p=32 if arch[:4]==b'\xcf\xfa\xed\xfe' else 28
        assert p+command_bytes<=len(arch) and n<10000
        signature=None
        for _ in range(n):
            kind,length=struct.unpack_from('<II',arch,p);assert length>=8 and p+length<=len(arch)
            if kind==0x1d:
                off,size=struct.unpack_from('<II',arch,p+8);assert off+size<=len(arch)
                signature=arch[off:off+size]
            p+=length
        assert signature and u32(signature,0)==0xfade0cc0
        length,count=u32(signature,4),u32(signature,8)
        assert length<=len(signature) and count<100
        blobs={}
        for i in range(count):
            slot,off=struct.unpack_from('>II',signature,12+i*8)
            size=u32(signature,off+4);assert off+size<=length
            blobs[slot]=signature[off:off+size]
        assert 0 in blobs and 0x10000 in blobs, f'Missing CodeDirectory/CMS slots: {sorted(blobs)}'
        for slot,cd in blobs.items():
            if slot!=0 and not 0x1000<=slot<=0x1005: continue
            assert u32(cd,0)==0xfade0c02
            hash_off,nslots,limit=u32(cd,16),u32(cd,28),u32(cd,32)
            hash_size,kind,page=cd[36],cd[37],cd[39]
            assert page<=24 and limit<=len(arch)
            assert nslots==math.ceil(limit/(1<<page))
            algorithm={1:'sha1',2:'sha256',3:'sha256',4:'sha384'}[kind]
            if resources is not None:
                assert u32(cd,24)>=3
                assert cd[hash_off-3*hash_size:hash_off-2*hash_size]==hashlib.new(algorithm,resources).digest()[:hash_size], 'CodeResources binding mismatch'
            for j in range(nslots):
                expected=hashlib.new(algorithm,arch[j*(1<<page):min((j+1)*(1<<page),limit)]).digest()[:hash_size]
                assert cd[hash_off+j*hash_size:hash_off+(j+1)*hash_size]==expected, 'Code page hash mismatch'
        cms=blobs[0x10000]
        assert u32(cms,0)==0xfade0b01
        stem=root/f'verify-{index}-{total}'
        Path(str(stem)+'.der').write_bytes(cms[8:u32(cms,4)])
        Path(str(stem)+'.cd').write_bytes(blobs[0])
        result=subprocess.run([str(openssl),'cms','-verify','-binary','-inform','DER','-in',str(stem)+'.der','-content',str(stem)+'.cd','-noverify','-out',str(stem)+'.verified'],capture_output=True)
        assert result.returncode==0, result.stderr.decode(errors='replace')
        assert Path(str(stem)+'.verified').read_bytes()==blobs[0]
        total+=1
    return total

with zipfile.ZipFile(root/(sys.argv[1] if len(sys.argv)>1 else 'signed.ipa')) as signed,zipfile.ZipFile(root/'input.ipa') as original:
    assert signed.testzip() is None
    main=next(n for n in signed.namelist() if n.count('/')==2 and n.endswith('.app/Info.plist'))
    info=plistlib.loads(signed.read(main));before=plistlib.loads(original.read(main))
    for key in ['CFBundleIdentifier','CFBundleVersion','CFBundleShortVersionString']:
        assert info[key]==before[key]
    verified=0;architectures=0
    for item in signed.infolist():
        if item.is_dir():continue
        with signed.open(item) as f: magic=f.read(4)
        if magic in (b'\xcf\xfa\xed\xfe',b'\xce\xfa\xed\xfe',b'\xca\xfe\xba\xbe',b'\xca\xfe\xba\xbf'):
            try:
                resource_path=item.filename.rsplit('/',1)[0]+'/_CodeSignature/CodeResources'
                resources=signed.read(resource_path) if resource_path in signed.namelist() else None
                architectures+=verify(signed.read(item),verified,resources);verified+=1
            except AssertionError as error:
                raise AssertionError(f'{item.filename}: {error}') from error
        elif item.filename.endswith('.deb') and item.filename in original.namelist():
            assert signed.read(item)==original.read(item.filename),'Bundled Debian archive changed'
    assert verified>0
    base=main[:-len('Info.plist')]
    assert signed.read(base+'embedded.mobileprovision')==(root/'valid.mobileprovision').read_bytes()
    print(f'PASS: {verified} Mach-O binaries / {architectures} architectures; all code page hashes and CMS cryptographic signatures verify; app identity, embedded profile and Debian resources retained.')
    print('This verifies cryptographic output, not Apple trust or physical-device installation.')
