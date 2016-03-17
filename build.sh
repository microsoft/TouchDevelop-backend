#!/bin/sh
set -x
set -e
node scripts/asynclint.js src/*.ts
node node_modules/typescript/bin/tsc
