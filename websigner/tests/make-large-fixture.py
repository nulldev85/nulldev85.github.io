"""Owned IPA plus disposable, incompressible resource; no new executable code."""
from pathlib import Path
import hashlib,json,random,shutil,zipfile
root=Path(__file__).resolve().parent.parent/'.test-data'
target=root/'large-input.ipa'
shutil.copyfile(root/'input.ipa',target)
rng=random.Random(512)
digest=hashlib.sha256()
name='Payload/NullSign.app/web-signer-size-test.bin'
with zipfile.ZipFile(target,'a',compression=zipfile.ZIP_STORED,allowZip64=False) as archive:
    with archive.open(name,'w') as out:
        for _ in range(480):
            chunk=rng.randbytes(1024**2);out.write(chunk);digest.update(chunk)
assert 490*1024**2<target.stat().st_size<=512*1024**2
(root/'large-fixture.json').write_text(json.dumps({'inputBytes':target.stat().st_size,'resource':name,'resourceBytes':480*1024**2,'resourceSHA256':digest.hexdigest()},indent=2)+'\n')
print('Large owned-app fixture ready:',target.stat().st_size,'bytes; SHA256 resource recorded.')
