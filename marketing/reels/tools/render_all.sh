#!/bin/bash
cd "$(dirname "$0")/.." && mkdir -p out
export PRODUCER_HEADLESS_SHELL_PATH=${PRODUCER_HEADLESS_SHELL_PATH:-/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell}
for s in "$@"; do
  (cd reels/$s && npx -y hyperframes@0.8.143 render . -o ../../out/$s.video.mp4 --quality high --quiet > ../../out/render-$s.log 2>&1)
  echo "rendered $s $?" >> out/render-all.log
done
echo ALL DONE >> out/render-all.log
