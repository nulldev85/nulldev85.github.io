from pathlib import Path
import hashlib,json,plistlib,zipfile
root=Path(__file__).resolve().parent.parent/'.test-data'
expected=json.loads((root/'large-fixture.json').read_text())
with zipfile.ZipFile(root/'large-signed.ipa') as archive:
    digest=hashlib.sha256();length=0
    with archive.open(expected['resource']) as resource:
        while chunk:=resource.read(1024**2):digest.update(chunk);length+=len(chunk)
    assert length==expected['resourceBytes']
    assert digest.hexdigest()==expected['resourceSHA256']
    resources=plistlib.loads(archive.read('Payload/NullSign.app/_CodeSignature/CodeResources'))
    assert resources['files2']['web-signer-size-test.bin']['hash2']==digest.digest()
print('PASS: all 480 MiB of test resource preserved byte-for-byte and sealed in CodeResources.')
