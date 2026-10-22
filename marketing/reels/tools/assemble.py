"""Write reels/<slug>/index.html around data.js + reel.js and copy the shared assets."""
import json, os, re, shutil, sys

TEMPLATE = """<!doctype html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=1080, height=1920">
<title>Deal Operator Reel {slug}</title>
<link rel="stylesheet" href="assets/brand.css">
<script src="assets/gsap.min.js"></script>
<script src="data.js"></script>
<script src="assets/lib.js"></script>
<style>{css}</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-width="1080" data-height="1920" data-duration="{duration}"></div>
<script>
document.fonts.ready.then(function () {{
  var tl = gsap.timeline({{ paused: true }});
  H.stage();
  H.drift(tl, REEL.duration);
{reel}
  H.captions(tl, {{ skipCta: true }});
  window.__timelines["main"] = tl;
}});
</script>
</body>
</html>
"""

def main(slug):
    d = f"reels/{slug}"
    data = open(f"{d}/data.js").read()
    duration = json.loads(data[data.index("{"):data.rindex("}") + 1])["duration"]
    reel = open(f"{d}/reel.js").read()
    css = open(f"{d}/reel.css").read() if os.path.exists(f"{d}/reel.css") else ""
    reel = "\n".join("  " + l if l.strip() else l for l in reel.splitlines())
    open(f"{d}/index.html", "w").write(TEMPLATE.format(slug=slug, duration=duration, reel=reel, css=css))
    os.makedirs(f"{d}/assets", exist_ok=True)
    for f in os.listdir("shared"):
        shutil.copy2(f"shared/{f}", f"{d}/assets/{f}")
    # Manrope: the app's own font files (marketing/reels sits two levels below the repo root)
    fonts = os.environ.get("FONTS_DIR", "../../public/fonts")
    for w in (500, 600, 700, 800):
        if not os.path.exists(f"{d}/assets/manrope-{w}.ttf"):
            shutil.copy2(f"{fonts}/manrope-{w}.ttf", f"{d}/assets/manrope-{w}.ttf")
    print("assembled", slug, duration)

if __name__ == "__main__":
    for s in sys.argv[1:]:
        main(s)
