#!/bin/sh
set -x
date -Is
cat /proc/uptime
node -pe "$(date +%s) - $(cut -d' ' -f1 /proc/uptime)"
exec node worker.js
