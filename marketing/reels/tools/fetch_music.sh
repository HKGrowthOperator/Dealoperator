#!/bin/bash
# The three CC0 tracks (Kevin MacLeod via FreePD.com) from the FreePD archive copy on archive.org.
cd "$(dirname "$0")/.." && mkdir -p music && cd music
for n in "electronic/Goodnightmare.mp3" "Page2/Industrial Matter.mp3" "electronic/Arpent.mp3"; do
  f=$(basename "$n"); enc=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1]))" "$n")
  curl -fsSL --retry 5 -o "$f" "https://archive.org/download/freepd/$enc" && echo "ok $f"
done
