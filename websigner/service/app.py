"""Temporary signed-IPA delivery. This service never receives P12/password fields."""
import asyncio
import hashlib
import hmac
import html
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import secrets
import shutil
import stat
import struct
import time
from contextlib import asynccontextmanager, suppress
from urllib.parse import quote, urlsplit
import zipfile

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.trustedhost import TrustedHostMiddleware
from starlette.requests import ClientDisconnect
from starlette.responses import FileResponse, HTMLResponse, JSONResponse, Response
from starlette.routing import Route

ORIGIN = os.environ.get('PUBLIC_ORIGIN', 'https://signer.mateomedia.link').rstrip('/')
PARENT = 'https://nulldev85.github.io'
DATA = Path(os.environ.get('DATA_ROOT', '/data/jobs'))
STATIC = Path(__file__).parent / 'static'
TTL = int(os.environ.get('JOB_TTL_SECONDS', '1200'))
MAX_UPLOAD = 192 * 1024 * 1024
MAX_DISK = 2 * 1024**3
MAX_JOBS = 12
TOKEN = re.compile(r'[a-f0-9]{64}\Z')
RATE_SALT = secrets.token_bytes(32)
rates = {}
active_uploads = 0
reserved = 0


class InvalidIPA(ValueError):
    pass


def inspect_ipa(path):
    """Read bounded metadata, never extract paths or execute anything in the IPA."""
    with open(path, 'rb') as archive:
        archive.seek(0, 2)
        length=archive.tell()
        archive.seek(max(0,length-65557))
        tail=archive.read()
    end=tail.rfind(b'PK\x05\x06')
    if end<0 or end+22>len(tail): raise InvalidIPA('This is not a supported IPA archive.')
    disk,cd_disk,disk_count,count,cd_size,cd_offset,comment=struct.unpack_from('<HHHHIIH',tail,end+4)
    if disk or cd_disk or count!=disk_count or not 0<count<=50000 or cd_size>16*1024**2 or cd_offset+cd_size>length-len(tail)+end or end+22+comment!=len(tail):
        raise InvalidIPA('The IPA file list is invalid or too large.')
    with zipfile.ZipFile(path) as z:
        infos = z.infolist()
        if not infos or len(infos) > 50000:
            raise InvalidIPA('This IPA contains too many files.')
        names, expanded = set(), 0
        for item in infos:
            name = item.filename
            parts = PurePosixPath(name).parts
            if not name or name.startswith(('/', '\\')) or '\\' in name or '\0' in name or '..' in parts or name in names:
                raise InvalidIPA('This IPA has unsafe or duplicate file paths.')
            if stat.S_ISLNK(item.external_attr >> 16):
                raise InvalidIPA('IPAs containing symbolic links are not supported.')
            names.add(name)
            expanded += item.file_size
            if expanded > 1024**3 or item.flag_bits & 1:
                raise InvalidIPA('This IPA is too large or encrypted.')
        plists = [n for n in names if re.fullmatch(r'Payload/[^/]+\.app/Info\.plist', n)]
        if len(plists) != 1:
            raise InvalidIPA('Choose an IPA containing one app in Payload.')
        info_entry = z.getinfo(plists[0])
        if info_entry.file_size > 1024**2:
            raise InvalidIPA('App metadata is too large.')
        info = plistlib.loads(z.read(info_entry))
        if not isinstance(info, dict):
            raise InvalidIPA('The app metadata is invalid.')
        bundle = info.get('CFBundleIdentifier', '')
        version = str(info.get('CFBundleVersion', ''))
        executable = info.get('CFBundleExecutable', '')
        if not isinstance(bundle, str) or not re.fullmatch(r'[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', bundle):
            raise InvalidIPA('The app has an invalid bundle identifier.')
        if not re.fullmatch(r'[A-Za-z0-9._-]{1,128}', version):
            raise InvalidIPA('The app has an invalid build version.')
        if not isinstance(executable, str) or not executable or '/' in executable or '\\' in executable or executable in ('.', '..'):
            raise InvalidIPA('The app executable is invalid.')
        base = plists[0][:-len('Info.plist')]
        for required in [base+'embedded.mobileprovision', base+'_CodeSignature/CodeResources', base+executable]:
            if required not in names:
                raise InvalidIPA('Upload the signed IPA, not the original unsigned app.')
        provision = z.getinfo(base+'embedded.mobileprovision')
        if not 128 <= provision.file_size <= 2 * 1024**2:
            raise InvalidIPA('The embedded provisioning profile is invalid.')
        # Delivery checks metadata and structure; iOS decides certificate trust.
        with z.open(base+executable) as binary:
            magic = binary.read(4)
        if magic not in [b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe', b'\xca\xfe\xba\xbe', b'\xca\xfe\xba\xbf']:
            raise InvalidIPA('The app does not contain a supported Mach-O executable.')
        name = info.get('CFBundleDisplayName') or info.get('CFBundleName') or bundle
        if not isinstance(name, str):
            name = bundle
        name = ''.join(c for c in name if c.isprintable())[:160] or bundle
        tv = 'AppleTVOS' in info.get('CFBundleSupportedPlatforms', []) or 3 in info.get('UIDeviceFamily', [])
        return {'bundle': bundle, 'version': version, 'name': name, 'platform': 'tvOS' if tv else 'iOS'}


def read_job(token):
    if not TOKEN.fullmatch(token):
        return None
    try:
        record = json.loads((DATA / (token+'.json')).read_text())
        if record['expires'] <= time.time() or not (DATA / (token+'.ipa')).is_file():
            return None
        return record
    except (OSError, ValueError, KeyError):
        return None


def erase_job(token):
    if TOKEN.fullmatch(token):
        for suffix in ['.ipa', '.json', '.partial']:
            with suppress(FileNotFoundError):
                (DATA / (token+suffix)).unlink()


def cleanup():
    DATA.mkdir(parents=True, exist_ok=True, mode=0o700)
    now = time.time()
    for entry in DATA.iterdir():
        if not entry.exists():
            continue
        token = entry.stem
        if not TOKEN.fullmatch(token):
            continue
        if entry.suffix == '.json' and read_job(token) is None:
            erase_job(token)
        elif entry.suffix in ['.partial', '.ipa'] and entry.stat().st_mtime < now - TTL - 60:
            erase_job(token)
    for key in list(rates):
        rates[key] = [t for t in rates[key] if now-t < 1800]
        if not rates[key]:
            del rates[key]


@asynccontextmanager
async def lifespan(app):
    cleanup()
    async def sweep():
        while True:
            await asyncio.sleep(30)
            cleanup()
    task = asyncio.create_task(sweep())
    yield
    task.cancel()
    with suppress(asyncio.CancelledError):
        await task


class Headers:
    def __init__(self, app): self.app = app
    async def __call__(self, scope, receive, send):
        if scope['type'] != 'http':
            return await self.app(scope, receive, send)
        async def secured(message):
            if message['type'] == 'http.response.start':
                extra = {
                    'X-Content-Type-Options': 'nosniff',
                    'Referrer-Policy': 'no-referrer',
                    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
                    'Strict-Transport-Security': 'max-age=31536000',
                    'Cache-Control': 'no-store',
                    'Content-Security-Policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'; style-src 'self'; img-src 'self' blob: data:; base-uri 'none'; object-src 'none'; form-action 'none'; frame-src 'none'; frame-ancestors "+PARENT,
                }
                headers = [(k,v) for k,v in message.get('headers', []) if k.lower() not in {n.lower().encode() for n in extra}]
                headers += [(k.lower().encode(),v.encode()) for k,v in extra.items()]
                message['headers'] = headers
            await send(message)
        await self.app(scope, receive, secured)


async def health(request):
    return JSONResponse({'status':'ok', 'version':'1', 'retentionSeconds':TTL, 'maxUploadBytes':MAX_UPLOAD})


async def static(request):
    resource = request.path_params.get('resource', 'index.html')
    if resource not in {'index.html','style.css','app.js','worker.js','zip-check.js','engine/zsign-mobile.js','engine/zsign-mobile.wasm','LICENSES.txt'}:
        return Response(status_code=404)
    types = {'.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.wasm':'application/wasm', '.txt':'text/plain'}
    path = STATIC / resource
    if not path.is_file(): return Response(status_code=404)
    return FileResponse(path, media_type=types[path.suffix])


async def upload(request):
    global active_uploads, reserved
    if request.headers.get('origin') != ORIGIN:
        return JSONResponse({'error':'Open the signer on our site before installing.'},403)
    if request.headers.get('content-type','').split(';')[0].strip() != 'application/octet-stream':
        return JSONResponse({'error':'Only a signed IPA can be uploaded.'},415)
    try:
        size = int(request.headers.get('content-length','0'))
        if not 1 <= size <= MAX_UPLOAD: raise ValueError
    except ValueError:
        return JSONResponse({'error':'Choose a signed IPA no larger than 192 MB.'},413)
    cleanup()
    # Traefik is the only ingress; its final X-Forwarded-For value is the peer IP.
    peer = request.headers.get('x-forwarded-for','').split(',')[-1].strip() or (request.client.host if request.client else 'unknown')
    key = hashlib.sha256(RATE_SALT+peer.encode()).hexdigest()
    history = rates.setdefault(key, [])
    if len(history) >= 6:
        return JSONResponse({'error':'Too many uploads. Try again in 30 minutes.'},429)
    used = sum(p.stat().st_size for p in DATA.iterdir() if p.suffix in ['.ipa','.partial'])
    jobs = len(list(DATA.glob('*.json')))
    if active_uploads >= 2 or used+reserved+size > MAX_DISK or jobs+active_uploads >= MAX_JOBS or shutil.disk_usage(DATA).free < 2*1024**3+size:
        return JSONResponse({'error':'Temporary storage is busy. Please try again shortly.'},503)
    history.append(time.time())
    token, delete_token = secrets.token_hex(32), secrets.token_urlsafe(32)
    partial = DATA / (token+'.partial')
    active_uploads += 1
    reserved += size
    try:
        received = 0
        with partial.open('xb') as out:
            os.chmod(partial, 0o600)
            async with asyncio.timeout(180):
                async for chunk in request.stream():
                    received += len(chunk)
                    if received > size or received > MAX_UPLOAD:
                        raise InvalidIPA('The upload exceeds the size limit.')
                    out.write(chunk)
        if received != size:
            raise InvalidIPA('The upload was interrupted. Please try again.')
        try:
            metadata = await asyncio.to_thread(inspect_ipa, partial)
        except (zipfile.BadZipFile, plistlib.InvalidFileException, KeyError, TypeError, struct.error, OverflowError) as error:
            raise InvalidIPA('This is not a supported signed IPA.') from error
        if metadata['platform'] != 'iOS':
            raise InvalidIPA('For Apple TV, download the signed IPA and install it with NullSign.')
        metadata.update({'expires':int(time.time())+TTL, 'deleteHash':hashlib.sha256(delete_token.encode()).hexdigest()})
        partial.replace(DATA / (token+'.ipa'))
        with (DATA / (token+'.json')).open('x') as record:
            os.chmod(record.name, 0o600)
            json.dump(metadata, record)
        return JSONResponse({'token':token, 'deleteToken':delete_token, 'expires':metadata['expires'], 'installURL':ORIGIN+'/install/'+token, 'manifestURL':ORIGIN+'/manifest/'+token+'.plist'},201)
    except (InvalidIPA, TimeoutError, ClientDisconnect, ValueError) as error:
        erase_job(token)
        message = str(error) if isinstance(error, InvalidIPA) else 'The upload failed. Please try again.'
        return JSONResponse({'error':message},400)
    except asyncio.CancelledError:
        erase_job(token)
        raise
    except Exception:
        erase_job(token)
        return JSONResponse({'error':'The upload could not be stored. Please try again.'},500)
    finally:
        active_uploads -= 1
        reserved -= size


async def manifest(request):
    token = request.path_params['token']
    record = read_job(token)
    if not record: return JSONResponse({'error':'This installation link has expired.'},410)
    data = {'items':[{'assets':[{'kind':'software-package','url':ORIGIN+'/files/'+token+'.ipa'}], 'metadata':{'bundle-identifier':record['bundle'],'bundle-version':record['version'],'kind':'software','title':record['name']}}]}
    return Response(plistlib.dumps(data),media_type='application/xml')


async def download(request):
    token = request.path_params['token']
    if not read_job(token): return Response('This installation link has expired.',410)
    range_header = request.headers.get('range')
    if range_header and (len(range_header)>128 or not re.fullmatch(r'bytes=(?:\d+-\d*|-\d+)', range_header)):
        return Response(status_code=416)
    return FileResponse(DATA / (token+'.ipa'),media_type='application/octet-stream',filename='Signed.ipa')


async def delete(request):
    if request.headers.get('origin') != ORIGIN: return Response(status_code=403)
    token = request.path_params['token']
    record = read_job(token)
    if not record: return Response(status_code=410)
    supplied = hashlib.sha256(request.headers.get('x-delete-token','').encode()).hexdigest()
    if not hmac.compare_digest(supplied,record['deleteHash']): return Response(status_code=403)
    erase_job(token)
    return Response(status_code=204)


async def install(request):
    token = request.path_params['token']
    record = read_job(token)
    if not record: return HTMLResponse('<!doctype html><meta name="viewport" content="width=device-width"><title>Link expired</title><p>This installation link has expired. Sign the app again to create a new one.</p>',410)
    url = 'itms-services://?action=download-manifest&url='+quote(ORIGIN+'/manifest/'+token+'.plist',safe='')
    return HTMLResponse('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/assets/style.css"><title>Install app</title></head><body class="standalone"><main class="install-page"><h1>'+html.escape(record['name'])+'</h1><p>Tap Install on the iPhone you signed this app for.</p><a class="button primary" href="'+html.escape(url,quote=True)+'">Install</a><p class="muted">This link expires after 20 minutes. iOS checks the app and certificate before installing.</p></main></body></html>')


app = Starlette(lifespan=lifespan, routes=[
    Route('/',static), Route('/assets/{resource:path}',static), Route('/health',health),
    Route('/api/uploads',upload,methods=['POST']),
    Route('/api/uploads/{token}',delete,methods=['DELETE']),
    Route('/manifest/{token}.plist',manifest), Route('/files/{token}.ipa',download), Route('/install/{token}',install),
], middleware=[Middleware(Headers),Middleware(TrustedHostMiddleware,allowed_hosts=[urlsplit(ORIGIN).hostname,'localhost','127.0.0.1'])])
