#!/bin/sh
cd $HOME/bkp
node backup.js < envbkp.json > lastcron.txt 2>&1
