"""Disposable signing identities. Never use these for device installation."""
from datetime import datetime, timedelta, timezone
from pathlib import Path
import plistlib
import shutil
import uuid
import json, re
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12, pkcs7
from cryptography.x509.oid import NameOID, ExtendedKeyUsageOID

root=Path(__file__).resolve().parent.parent/'.test-data'
root.mkdir(exist_ok=True)
now=datetime.now(timezone.utc)
source=(root.parent/'engine-src/vendor/zsign/src/openssl.cpp').read_text()
section=source.split('const char* ZSignAsset::s_szAppleDevCACertG3 =',1)[1].split(';',1)[0]
issuer_pem=''.join(json.loads(s) for s in re.findall(r'"(?:[^"\\]|\\.)*"',section))
issuer=x509.load_pem_x509_certificate(issuer_pem.encode()).subject
# Disposable key, deliberately untrusted certificate. Matching the issuer name
# exercises the engine's production CMS path; it does not create Apple trust.
def identity(cn, known_issuer=True):
    key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
    name=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,cn),x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME,'TEAM000001')])
    cert=(x509.CertificateBuilder().subject_name(name).issuer_name(issuer if known_issuer else name).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-timedelta(days=1)).not_valid_after(now+timedelta(days=14)).add_extension(x509.BasicConstraints(ca=False,path_length=None),critical=True).add_extension(x509.ExtendedKeyUsage([ExtendedKeyUsageOID.CODE_SIGNING]),critical=False).sign(key,hashes.SHA256()))
    return key,cert
key,cert=identity('Null web signer disposable test')
other_key,other_cert=identity('Different disposable test identity')
(root/'identity.p12').write_bytes(pkcs12.serialize_key_and_certificates(b'Test only',key,cert,None,serialization.BestAvailableEncryption(b'test-only')))
(root/'identity-no-password.p12').write_bytes(pkcs12.serialize_key_and_certificates(b'Test only',key,cert,None,serialization.NoEncryption()))
(root/'certificate.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM))
def profile(name,listed,expiration):
    data={'UUID':str(uuid.uuid4()).upper(),'Name':'Disposable local test','TeamName':'Test only','TeamIdentifier':['TEAM000001'],'ApplicationIdentifierPrefix':['TEAM000001'],'CreationDate':(now-timedelta(days=1)).replace(tzinfo=None),'ExpirationDate':expiration.replace(tzinfo=None),'Platform':['iOS'],'DeveloperCertificates':[listed.public_bytes(serialization.Encoding.DER)],'ProvisionsAllDevices':True,'Entitlements':{'application-identifier':'TEAM000001.*','com.apple.developer.team-identifier':'TEAM000001','get-task-allow':False,'keychain-access-groups':['TEAM000001.*']}}
    cms=pkcs7.PKCS7SignatureBuilder().set_data(plistlib.dumps(data)).add_signer(cert,key,hashes.SHA256()).sign(serialization.Encoding.DER,[pkcs7.PKCS7Options.Binary])
    (root/name).write_bytes(cms)
profile('valid.mobileprovision',cert,now+timedelta(days=7))
profile('expired.mobileprovision',cert,now-timedelta(days=1))
profile('mismatch.mobileprovision',other_cert,now+timedelta(days=7))
key,cert=identity('Unsupported disposable issuer',False)
(root/'unsupported.p12').write_bytes(pkcs12.serialize_key_and_certificates(b'Test only',key,cert,None,serialization.BestAvailableEncryption(b'test-only')))
profile('unsupported.mobileprovision',cert,now+timedelta(days=7))
source=Path(__file__).resolve().parents[3]/'nullsign-151-release/NullSign-1.5.1-43.ipa'
if not source.is_file(): raise SystemExit('Provide the owned public NullSign IPA fixture.')
shutil.copyfile(source,root/'input.ipa')
print('Disposable identities, valid/expired/mismatched profiles and owned IPA fixture ready.')
