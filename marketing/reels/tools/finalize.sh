#!/bin/bash
# mux the mixed audio, then make a lighter web copy and a poster for the review page
cd "$(dirname "$0")/.."; mkdir -p out/final out/web
for s in "$@"; do
  ffmpeg -v error -y -i out/$s.video.mp4 -i audio/$s.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -ar 48000 -shortest -movflags +faststart out/final/DealOperator-Reel-$s.mp4
  ffmpeg -v error -y -i out/final/DealOperator-Reel-$s.mp4 -c:v libx264 -preset slow -crf 23 -maxrate 3800k -bufsize 7600k -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart out/web/$s.mp4
  ffmpeg -v error -y -ss ${POSTER_T:-1.7} -i out/final/DealOperator-Reel-$s.mp4 -frames:v 1 -vf scale=540:-2 -q:v 4 out/web/$s.jpg
  echo "$s final $(du -h out/final/DealOperator-Reel-$s.mp4 | cut -f1) web $(du -h out/web/$s.mp4 | cut -f1)"
done
