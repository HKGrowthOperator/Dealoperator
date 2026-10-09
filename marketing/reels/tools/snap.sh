#!/bin/bash
# snapshot each line's midpoint (+ a late point) and build one strip image
s=$1; cd "$(dirname "$0")/../reels/$s"
ats=$(node -e "global.window={};require('./data.js');const R=window.REEL;const a=[];R.lines.forEach(l=>{a.push(((l.s+l.e)/2).toFixed(2)); if(l.e-l.s>3) a.push((l.e-0.25).toFixed(2));});a.push((R.duration-0.3).toFixed(2));console.log(a.join(','))")
rm -rf snapshots
PRODUCER_HEADLESS_SHELL_PATH=${PRODUCER_HEADLESS_SHELL_PATH:-/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell} npx -y hyperframes@0.8.143 snapshot . --at $ats --no-end > /dev/null 2>&1
python3 -c "
from PIL import Image, ImageDraw
import glob,re
fs=sorted(glob.glob('snapshots/frame-*.png'))
n=len(fs); cols=min(n,6); rows=(n+cols-1)//cols
W=Image.new('RGB',(cols*300+(cols-1)*6, rows*533+(rows-1)*6),'black')
for i,f in enumerate(fs):
  im=Image.open(f).resize((300,533)); d=ImageDraw.Draw(im); d.text((8,8),re.search(r'at-([\d.]+)s',f).group(1)+'s',fill='yellow')
  W.paste(im,((i%cols)*306,(i//cols)*539))
W.save('snapshots/strip.png')
print(n,'frames')"
