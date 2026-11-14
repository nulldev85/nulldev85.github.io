# Null web signer

Browser-local IPA signing, with optional 20-minute signed-IPA hosting for iPhone installation. The website opens the isolated signer in a transparent iframe at `https://signer.mateomedia.link`; its font, colors and button feedback match the main site.

The browser worker receives the IPA, P12, provisioning profile and optional password. It compiles no code, runs no shell, uses no analytics, and stores no signing credentials. Its WASM engine loads from our own server before the inputs are mounted; signing then disables the worker's network APIs. The parent website receives only iframe height notifications. Closing the dialog unloads the iframe and terminates the worker.

Only **Prepare install** uploads anything: the signed IPA, including its embedded public certificate and provisioning profile. P12 and password never enter that request. Do not describe the embedded profile as private to the browser after uploading. Install links are bearer capabilities: anyone with a link can download that IPA until expiry or authorized deletion. Access logging is disabled for this hostname and application. There are no third-party upload hosts.

This is a beta, not an independent security audit. iOS determines certificate trust, revocation, device eligibility and entitlement compatibility. Local signature tests do not prove physical-device installation. The engine currently expects supported Apple certificate issuers. Any IPA may be selected, subject to 128 MiB compressed / 240 MiB expanded browser limits; ZIP64, encrypted archives and symbolic links are rejected. Large apps should use native NullSign. Apple TV installation uses native NullSign rather than iPhone OTA.

## Engine build

`engine-src/SOURCE.json` pins the source and published artifact hashes. The engine derives from SylvaSigner's MIT source at `f7127d6857a6aaa919b7430ef73baa262fe28070`, zsign base `28a6421`, OpenSSL 3.5.7 and Emscripten 6.0.0. Our patches reject expired profiles, expired/mismatched certificates and CMS-generation failure. No upstream frontend, analytics or external install service is included.

Build `engine-src/build-engine.sh` inside `emscripten/emsdk@sha256:9eed2e47b4206928b22f99d2917013ad5462d777bb24cb546a652729896badd8`, with the engine source mounted at `/source`, `EM_CACHE=/source/.emscripten-cache` and 2 build CPUs. The script verifies the OpenSSL source SHA256 before compiling. Copy `public/wasm/zsign-mobile.js` and `.wasm` to `service/static/engine/`. Preserve licenses and update the recorded hashes when rebuilding. Full third-party notices are served at `/assets/LICENSES.txt`; component source notices remain in the vendored sources.

## Service

Build `service/Dockerfile`. Python base image and all dependencies are hash pinned. Deployment uses a non-root, read-only container, no capabilities or published ports, 512 MiB memory, one CPU, a dedicated `/data` bind mount and a separate HTTPS hostname. Application quotas bound concurrent uploads, jobs and aggregate temporary storage. Uploaded archives are inspected without extraction or execution. Cleanup runs on requests and every 30 seconds; expired capabilities immediately stop working. The reverse proxy's only new router/service is `null-websigner`; the previous config is backed up under `/var/backups/null-websigner-before-*`.

Live deployment files: `/opt/null-websigner/compose.yml`, `/opt/null-websigner/deployment.json`, `/opt/null-websigner/service/`. Stop only this service with `docker compose -f /opt/null-websigner/compose.yml stop`. To withdraw it, remove only the `null-websigner` router/service from the current proxy config; do not restore an old whole config over subsequent unrelated changes. No existing NullSign bot or native application service is modified.

## Verification

`tests/make-fixtures.py` generates disposable, intentionally untrusted identities and profiles, using the owned public NullSign IPA as input. `tests/engine-smoke.mjs` executes the actual compiled engine for success, empty/wrong passwords, expired/mismatched profiles and unsupported issuer failure. `tests/verify-signed.py` independently verifies every Mach-O code-page hash and detached CMS signature using OpenSSL, plus app identity and retained Debian resources. Test certificates cannot establish Apple trust.

`tests/service-contract.py` calls the real ASGI app for upload origin/type checks, archive rejection and cleanup, headers, static isolation, manifests, byte ranges, HTML escaping, deletion authorization, expiry and capacity. It runs offline in the production image. Browser layout and physical iPhone installation remain separate device checks.
