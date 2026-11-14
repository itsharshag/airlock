#!/bin/bash
# Records the full attack demo on a headless Linux box: Xvfb + ffmpeg + Airlock + the injected agent.
# Usage: demo/record.sh [out-dir]   (needs Xvfb and ffmpeg; run from the repo root)
OUT=${1:-out}; mkdir -p $OUT; P=$(mktemp -d)
trap 'kill $EL $SV $XV 2>/dev/null; pkill -f "electron/dist/electron" 2>/dev/null' EXIT
export DISPLAY=:99
Xvfb :99 -screen 0 ${SIZE:-1920x1080}x24 >/dev/null 2>&1 & XV=$!; sleep 1
node demo/server.js > $OUT/server.log 2>&1 & SV=$!
AIRLOCK_SIZE=${SIZE:-1920x1080} AIRLOCK_DEMO=1 AIRLOCK_PROFILE=$P AIRLOCK_PINS=${TIPJAR:-http://127.0.0.1:4001} AIRLOCK_START_URL=${TIPJAR:-http://127.0.0.1:4001}/ AIRLOCK_DEMO_AUTODECIDE=${AUTODECIDE:-approve:5000} AIRLOCK_DEMO_CAPTIONS=${CAPTIONS:-0} \
  npx electron . --no-sandbox > $OUT/airlock.log 2>&1 & EL=$!
for i in $(seq 1 60); do [ -f $P/agent-api.json ] && break; sleep 0.5; done; sleep 4
ffmpeg -y -loglevel error -f x11grab -video_size ${SIZE:-1920x1080} -framerate 30 -i :99 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p $OUT/demo.mp4 & FF=$!
date +%s%3N > $OUT/t0; sleep 2
CAPTIONS=${CAPTIONS:-0} AIRLOCK_PROFILE=$P node demo/agent.js 2>&1 | tee $OUT/agent.log
sleep 4
kill -INT $FF; wait $FF
kill $EL $SV $XV 2>/dev/null
cp $P/pins.json $OUT/ 2>/dev/null
ls -la $OUT
