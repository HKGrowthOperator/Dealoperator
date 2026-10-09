"""Load a reel page headless and dump the SFX cue list the timeline registered."""
import os, sys, json, asyncio, pathlib
from playwright.async_api import async_playwright
async def main(slugs):
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=os.environ.get("CHROME_PATH", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"), args=["--allow-file-access-from-files"])
        for slug in slugs:
            pg = await b.new_page(viewport={"width": 1080, "height": 1920})
            await pg.add_init_script("window.__timelines = {};")
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.on("console", lambda m: errs.append("console:" + m.text) if m.type == "error" else None)
            await pg.goto(pathlib.Path(f"reels/{slug}/index.html").resolve().as_uri())
            try:
                await pg.wait_for_function("!!(window.__timelines && window.__timelines.main)", timeout=15000, polling=200)
            except Exception:
                print(slug, "FAILED", errs); continue
            cues = await pg.evaluate("window.__sfx")
            dur = await pg.evaluate("window.__timelines.main.duration()")
            json.dump(cues, open(f"reels/{slug}/cues.json", "w"), indent=0)
            print(slug, "cues", len(cues), "timeline", round(dur, 2), "errors", errs)
            await pg.close()
        await b.close()
asyncio.run(main(sys.argv[1:]))
