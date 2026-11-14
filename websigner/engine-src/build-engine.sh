#!/bin/sh
set -eu
cd /source
mkdir -p .build deps
if [ ! -f .build/openssl-3.5.7.tar.gz ]; then
  curl --fail --location --retry 2 https://www.openssl.org/source/openssl-3.5.7.tar.gz -o .build/openssl-3.5.7.tar.gz
fi
echo 'a8c0d28a529ca480f9f36cf5792e2cd21984552a3c8e4aa11a24aa31aeac98e8  .build/openssl-3.5.7.tar.gz' | sha256sum -c -
if [ ! -f deps/openssl-wasm/lib/libcrypto.a ]; then
  tar -xzf .build/openssl-3.5.7.tar.gz -C .build
  cd .build/openssl-3.5.7
  emconfigure perl Configure gcc enable-legacy no-shared no-module no-tests no-apps no-asm no-dso no-engine --prefix=/source/deps/openssl-wasm --openssldir=/ssl
  sed -i 's/^CROSS_COMPILE=.*/CROSS_COMPILE=/' Makefile
  emmake make -j2
  emmake make install_sw
  cd /source
fi
ZSIGN_WASM_VARIANT=mobile node scripts/build-wasm.mjs
sha256sum public/wasm/zsign-mobile.js public/wasm/zsign-mobile.mjs public/wasm/zsign-mobile.wasm > public/wasm/SHA256SUMS
echo ENGINE_BUILD_SUCCEEDED
