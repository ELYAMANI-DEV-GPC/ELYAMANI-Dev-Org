#!/usr/bin/env sh
set -eu
cd /app
git remote set-url origin https://github.com/ELYAMANI-Dev/play-console-chrome-ext.git
git push origin master
