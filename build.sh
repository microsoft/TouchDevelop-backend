#!/bin/sh
set -x
set -e
cp external/backendutils.js built/
node scripts/asynclint.js src/*.ts
node node_modules/typescript/bin/tsc
