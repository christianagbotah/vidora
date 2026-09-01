#!/bin/bash
# Persistent dev server - restarts if it crashes
cd /home/z/my-project
while true; do
  echo "[$(date)] Starting dev server..." >> dev.log
  npx next dev -p 3000 >> dev.log 2>&1
  echo "[$(date)] Server exited, restarting in 2s..." >> dev.log
  sleep 2
done
