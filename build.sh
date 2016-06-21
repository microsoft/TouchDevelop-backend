#!/bin/sh
set -e

mkdir -p built/
cp external/backendutils.js built/
node scripts/asynclint.js src/*.ts
echo "[tsc]"
node node_modules/typescript/bin/tsc
echo "[babel]"
node node_modules/babel-cli/bin/babel -q built/ts --out-dir built
echo "[done]"
