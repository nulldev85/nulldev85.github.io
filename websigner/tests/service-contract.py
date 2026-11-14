"""Exercise the actual ASGI app without a network or real signing credentials."""
import asyncio, io, json, os, plistlib, tempfile, time, zipfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'service'))
temp=tempfile.TemporaryDirectory()
os.environ['DATA_ROOT']=temp.name
import app as service
from collections import namedtuple
# The disposable 32 MiB test tmpfs deliberately cannot satisfy the live 2 GiB
# free-space reserve. Model capacity here; all file I/O remains real.
service.shutil.disk_usage=lambda path: namedtuple('usage','total used free')(10*1024**3,0,10*1024**3)

def ipa(extra=None):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        z.writestr('Payload/Test.app/Info.plist',plistlib.dumps({'CFBundleIdentifier':'test.example','CFBundleVersion':'1','CFBundleExecutable':'Test','CFBundleDisplayName':'<Test>'}))
        z.writestr('Payload/Test.app/Test',b'\xcf\xfa\xed\xfe'+b'0'*100)
        z.writestr('Payload/Test.app/embedded.mobileprovision',b'0'*128)
        z.writestr('Payload/Test.app/_CodeSignature/CodeResources',b'fixture')
        if extra:z.writestr(extra,b'unsafe')
    return out.getvalue()

async def request(path,method='GET',body=b'',headers=None):
    supplied={'host':'signer.mateomedia.link','content-length':str(len(body))}
    supplied.update(headers or {})
    scope={'type':'http','asgi':{'version':'3.0'},'http_version':'1.1','method':method,'scheme':'https','path':path,'raw_path':path.encode(),'query_string':b'','root_path':'','server':('signer.mateomedia.link',443),'client':('127.0.0.1',1000),'headers':[(k.encode(),v.encode()) for k,v in supplied.items()]}
    sent=[]
    received=False
    async def receive():
        nonlocal received
        if received: await asyncio.Event().wait()
        received=True
        return {'type':'http.request','body':body,'more_body':False}
    async def send(message):sent.append(message)
    await service.app(scope,receive,send)
    start=next(m for m in sent if m['type']=='http.response.start')
    return start['status'],dict(start['headers']),b''.join(m.get('body',b'') for m in sent if m['type']=='http.response.body')

async def main():
    service.cleanup()
    status,headers,_=await request('/health')
    assert status==200 and b"frame-ancestors https://nulldev85.github.io" in headers[b'content-security-policy']
    assert headers[b'cache-control']==b'no-store'
    assert (await request('/assets/../app.py'))[0]==404
    assert (await request('/health',headers={'host':'evil.example'}))[0]==400
    upload={'origin':service.ORIGIN,'content-type':'application/octet-stream'}
    assert (await request('/api/uploads','POST',ipa()))[0]==403
    assert (await request('/api/uploads','POST',ipa(),{'origin':service.ORIGIN,'content-type':'multipart/form-data'}))[0]==415
    assert (await request('/api/uploads','POST',b'p12 is never accepted',upload))[0]==400
    assert (await request('/api/uploads','POST',ipa('../escape'),upload))[0]==400
    assert not list(service.DATA.iterdir())
    status,_,body=await request('/api/uploads','POST',ipa(),upload)
    assert status==201,body
    job=json.loads(body);token=job['token']
    assert job['expires']>time.time() and len(token)==64
    status,_,body=await request('/manifest/'+token+'.plist')
    assert status==200
    manifest=plistlib.loads(body)['items'][0]
    assert manifest['assets'][0]['url']==service.ORIGIN+'/files/'+token+'.ipa'
    status,headers,body=await request('/files/'+token+'.ipa',headers={'range':'bytes=0-3'})
    assert status==206 and body==b'PK\x03\x04' and b'content-range' in headers
    assert (await request('/files/'+token+'.ipa',headers={'range':'bytes=0-2,3-4'}))[0]==416
    status,_,body=await request('/install/'+token)
    assert status==200 and b'&lt;Test&gt;' in body and b'<Test>' not in body
    assert (await request('/api/uploads/'+token,'DELETE',headers={'origin':service.ORIGIN}))[0]==403
    assert (await request('/api/uploads/'+token,'DELETE',headers={'origin':service.ORIGIN,'x-delete-token':job['deleteToken']}))[0]==204
    assert (await request('/manifest/'+token+'.plist'))[0]==410
    assert not list(service.DATA.iterdir())
    service.rates.clear()
    status,_,body=await request('/api/uploads','POST',ipa(),upload)
    job=json.loads(body);token=job['token'];p=service.DATA/(token+'.json')
    record=json.loads(p.read_text());record['expires']=0;p.write_text(json.dumps(record))
    assert (await request('/files/'+token+'.ipa'))[0]==410
    service.cleanup();assert not list(service.DATA.iterdir())
    service.rates.clear();service.MAX_JOBS=0
    assert (await request('/api/uploads','POST',ipa(),upload))[0]==503
    assert service.active_uploads==0 and service.reserved==0
    print('PASS: origin/content type, invalid IPA/path cleanup, headers/static isolation, upload, manifest, byte range, HTML escaping, deletion authorization, expiry, capacity and accounting.')

asyncio.run(main())
temp.cleanup()
