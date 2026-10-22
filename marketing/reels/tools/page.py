"""Build the review page (Artifact) for the six reels: players, scripts, post texts, test plan."""
import html, json, os, shutil

ROOT = os.environ.get("REELS_ROOT", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = f"{ROOT}/out/page"
DISCORD = "https://discord.gg/NjkFJtBkZm"

POSTS = {
    "1-allein": "Callen alleine ist brutal. Liste offen, Telefon in der Hand und niemand, der mitzieht.\n\nBei Deal Operator callen wir zusammen: feste Sessions, Roleplays und Call-Partner im Discord. Kostenfrei.\n\nSchreib „Discord“ in die Kommentare und du bekommst den Link per DM.\n\n#coldcalling #kaltakquise #vertrieb #sales #setter #closer",
    "2-merkt": "Du hörst nicht wegen der Absagen auf. Sondern weil keiner merkt, wenn du aufhörst.\n\nBei Deal Operator endet jeder Calling-Tag mit deinem Tagesabschluss: Anwahlen, Settings, Closings. Deine Serie wächst, und in der Rangliste sehen alle, wer dranbleibt.\n\nSchreib „Discord“ in die Kommentare und du bekommst den Link per DM.\n\n#coldcalling #kaltakquise #vertrieb #sales #dranbleiben #setter",
    "3-einwand": "„Schicken Sie mir einfach mal Infos per Mail.“ Was sagst du jetzt? Schreib deine Antwort in die Kommentare.\n\nIm Discord üben wir genau das: Einer spielt den Kunden, du antwortest, die anderen geben dir Feedback.\n\nSchreib „Discord“ in die Kommentare und du bekommst den Link per DM.\n\n#einwandbehandlung #coldcalling #kaltakquise #vertrieb #sales #roleplay",
    "4-pov": "POV: Es ist 8:59. Gleich startet die Call-Session.\n\nRein in den Raum, Liste auf, alle wählen gleichzeitig. Abends Zahlen eintragen, Serie verlängert. So fühlt sich Callen an, wenn du nicht allein bist.\n\nSchreib „Discord“ in die Kommentare und du bekommst den Link per DM.\n\n#coldcalling #kaltakquise #vertrieb #sales #setter #closer",
    "5-ehrlich": "Wie viele Anwahlen hast du diese Woche gemacht? Ehrlich, ohne nachzuschauen.\n\nBei Deal Operator trägst du jeden Calling-Tag in zwei Minuten ein. Tagesmarke, Serie und Woche stehen schwarz auf weiß da. Kostenfrei.\n\nSchreib „Discord“ in die Kommentare und du bekommst den Link per DM.\n\n#coldcalling #kaltakquise #vertrieb #sales #tracking #dranbleiben",
    "6-rollen": "Opener. Setter. Closer. Selbstständig. Egal, wo du gerade stehst.\n\nCall-Partner für deine Zielgruppe, Roleplays für Einwände und eine Rangliste, die zeigt, wer dranbleibt. Alles kostenfrei.\n\nSchreib „Discord“ in die Kommentare und du bekommst den Link per DM.\n\n#coldcalling #kaltakquise #vertrieb #sales #opener #setter #closer",
}
SHOW = {  # what each reel shows, in one line
    "1-allein": "Einsame Anrufliste, dann geht das Licht an: der Raum füllt sich, Sessions, Roleplays, Call-Partner, gemeinsame Zahlen.",
    "2-merkt": "Absagen regnen, die Woche leert sich still. Dann Erinnerung, Tagesabschluss in zwei Minuten, Serie und Rangliste.",
    "3-einwand": "Echter Einwand am Telefon, drei Sekunden Countdown, dann das Roleplay im Discord mit Antwort und Feedback.",
    "4-pov": "Die Uhr springt auf 9:00, die Session geht live, alle wählen, das erste Setting zieht den Raum mit.",
    "5-ehrlich": "Die Zahl lässt sich nicht greifen. Dann Tagesabschluss, Tagesmarke, Serie und 412 Anwahlen schwarz auf weiß.",
    "6-rollen": "Vier Rollen knallen rein. Dann Leute wie du, Call-Partner nach Zielgruppe, Roleplay, Rangliste nach Serie.",
}
DM = f"Hey, schön, dass du dabei sein willst! Hier ist der Link zu unserem Discord: {DISCORD}\n\nStell dich kurz vor und schreib dazu, ob du Opener, Setter, Closer oder selbstständig bist. Alles kostenfrei."

def reel_data(slug):
    s = open(f"{ROOT}/reels/{slug}/data.js").read()
    return json.loads(s[s.index("{"):s.rindex("}") + 1])

def main():
    S = json.load(open(f"{ROOT}/scripts.json"))
    os.makedirs(f"{OUT}/reels", exist_ok=True)
    cards = []
    for i, r in enumerate(S["reels"]):
        slug = r["slug"]
        for ext in ("mp4", "jpg"):
            shutil.copy2(f"{ROOT}/out/web/{slug}.{ext}", f"{OUT}/reels/{slug}.{ext}")
        d = reel_data(slug)
        lines = "".join(f"<li>{html.escape(t)}</li>" for t in r["lines"] + [S["cta"]["text"]])
        post = html.escape(POSTS[slug])
        cards.append(f"""
    <article class="reel" id="reel-{i + 1}">
      <div class="phone"><video controls playsinline preload="metadata" poster="reels/{slug}.jpg" src="reels/{slug}.mp4"></video></div>
      <div class="meta-row"><span class="num">Reel {i + 1}</span><span class="dur">{d['duration']:.0f} s</span></div>
      <h3>{html.escape(r['lines'][0]) if slug != '4-pov' else 'POV: 8:59. Gleich startet die Call-Session.'}</h3>
      <p class="show">{html.escape(SHOW[slug])}</p>
      <details><summary>Sprechertext</summary><ol class="script">{lines}</ol></details>
      <details><summary>Posting-Text</summary><pre class="post" id="post-{i + 1}">{post}</pre><button class="copy" type="button" data-target="post-{i + 1}">Text kopieren</button></details>
    </article>""")
    page = TEMPLATE.replace("{{CARDS}}", "".join(cards)).replace("{{DM}}", html.escape(DM)).replace("{{DISCORD}}", DISCORD)
    open(f"{OUT}/index.html", "w").write(page)
    print("page written", sum(os.path.getsize(f"{OUT}/reels/{f}") for f in os.listdir(f"{OUT}/reels")) // 1024 // 1024, "MB media")

TEMPLATE = """<title>Deal Operator Community-Reels</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&display=swap">
<style>
  /* Layout: short intro, a wall of six phone players (3 / 2 / 1 columns) with script and post text, then trigger, test plan, rights. */
  :root {
    --bg: #f5f8fd; --surface: #ffffff; --ink: #0a2043; --muted: #52647e; --line: #dae4f2;
    --accent: #0755f5; --accent-2: #04bafa; --chip: rgba(7, 85, 245, .08); --stage: #06152f;
    --display: "Manrope", system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) { --bg: #050f24; --surface: #0b1d40; --ink: #f2f7ff; --muted: #a9bedd; --line: #1d3762; --accent: #68d8ff; --accent-2: #2f7bff; --chip: rgba(104, 216, 255, .1); --stage: #020817; color-scheme: dark; }
  }
  :root[data-theme="dark"] { --bg: #050f24; --surface: #0b1d40; --ink: #f2f7ff; --muted: #a9bedd; --line: #1d3762; --accent: #68d8ff; --accent-2: #2f7bff; --chip: rgba(104, 216, 255, .1); --stage: #020817; color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: var(--display); font-size: 16px; line-height: 1.55; padding-inline: 20px; padding-block: 40px 72px; }
  .wrap { max-width: 1180px; margin: 0 auto; display: grid; gap: 48px; }
  header { display: grid; gap: 16px; max-width: 780px; }
  .brand { display: inline-flex; align-items: center; gap: 10px; font-weight: 800; font-size: 20px; letter-spacing: -.04em; }
  .brand svg { width: 30px; height: 28px; }
  .brand b { color: var(--accent); font-weight: 800; }
  h1 { margin: 0; font-size: clamp(34px, 6vw, 60px); line-height: 1.02; letter-spacing: -.045em; font-weight: 800; text-wrap: balance; }
  h1 span { background: linear-gradient(170deg, var(--accent-2), var(--accent)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .lede { margin: 0; color: var(--muted); font-size: 18px; max-width: 62ch; }
  .facts { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; padding: 0; list-style: none; }
  .facts li { padding: 8px 14px; border-radius: 999px; background: var(--chip); border: 1px solid var(--line); font-weight: 700; font-size: 14px; }
  .sound { margin: 0; padding: 14px 18px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); color: var(--muted); max-width: 680px; }
  .wall { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 28px; }
  @media (max-width: 980px) { .wall { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media (max-width: 620px) { .wall { grid-template-columns: minmax(0, 1fr); } }
  .reel { display: grid; gap: 12px; align-content: start; min-width: 0; }
  .phone { border-radius: 26px; overflow: hidden; background: var(--stage); aspect-ratio: 9 / 16; max-width: 100%; box-shadow: 0 30px 60px -30px rgba(6, 21, 47, .55); border: 1px solid var(--line); }
  .phone video { display: block; width: 100%; height: 100%; object-fit: cover; background: var(--stage); }
  .meta-row { display: flex; justify-content: space-between; font-weight: 700; font-size: 14px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .num { color: var(--accent); }
  .reel h3 { margin: 0; font-size: 21px; line-height: 1.2; letter-spacing: -.03em; text-wrap: balance; }
  .show { margin: 0; color: var(--muted); font-size: 15px; }
  details { border-top: 1px solid var(--line); padding-top: 10px; }
  summary { cursor: pointer; font-weight: 700; font-size: 15px; }
  summary:focus-visible, .copy:focus-visible { outline: 3px solid var(--accent-2); outline-offset: 3px; border-radius: 6px; }
  .script { margin: 10px 0 0; padding-left: 20px; color: var(--muted); font-size: 15px; display: grid; gap: 4px; }
  .post { white-space: pre-wrap; word-break: break-word; font-family: var(--display); font-size: 14px; line-height: 1.5; margin: 10px 0; padding: 14px; border-radius: 12px; background: var(--chip); border: 1px solid var(--line); }
  .copy { font: 700 14px var(--display); color: var(--surface); background: var(--accent); border: 0; border-radius: 10px; padding: 10px 16px; cursor: pointer; }
  section { display: grid; gap: 16px; max-width: 820px; }
  h2 { margin: 0; font-size: 28px; letter-spacing: -.035em; line-height: 1.1; }
  section p { margin: 0; max-width: 64ch; }
  .steps { margin: 0; padding-left: 22px; display: grid; gap: 8px; max-width: 64ch; }
  .muted { color: var(--muted); }
  .code { font-weight: 700; padding: 2px 8px; border-radius: 8px; background: var(--chip); border: 1px solid var(--line); word-break: break-all; }
  .cols { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 28px; max-width: 1180px; }
  @media (max-width: 760px) { .cols { grid-template-columns: minmax(0, 1fr); } }
  .cols ul { margin: 0; padding-left: 20px; display: grid; gap: 6px; }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto; } }
</style>

<div class="wrap">
  <header>
    <div class="brand"><svg viewBox="0 0 360 340" aria-hidden="true"><defs><linearGradient id="o" x1=".1" y1="0" x2=".8" y2="1"><stop stop-color="#061b40"/><stop offset=".48" stop-color="#0755f5"/><stop offset="1" stop-color="#04bafa"/></linearGradient><linearGradient id="f" x1="0" y1="0" x2=".7" y2="1"><stop stop-color="#04c2f8"/><stop offset="1" stop-color="#0755f5"/></linearGradient></defs><path fill="url(#o)" fill-rule="evenodd" d="M20 4H174C279 4 352 74 352 170S279 336 174 336H22Q4 336 4 318V286L111 176 4 74V22Q4 4 20 4ZM105 98 176 169 109 240H171C215 240 245 211 245 170S215 98 171 98Z"/><path fill="#061b40" d="M4 286 112 178 164 229 53 336H22Q4 336 4 318Z"/><path fill="url(#f)" d="M8 8 178 171Q197 190 178 210L127 262Q135 239 115 220L15 124Q4 113 4 94V23Q4 13 8 8Z"/></svg><span>Deal <b>Operator</b></span></div>
    <h1>Community-Reels, die in den <span>Discord</span> ziehen.</h1>
    <p class="lede">Sechs Reels für die Sales-Community. Jedes startet mit einem Hook aus dem Calling-Alltag, zeigt die Community in der Bildsprache der App und endet mit demselben Trigger: „Schreib Discord in die Kommentare, und ich schick dir den Link.“</p>
    <ul class="facts"><li>9:16 · 1080 × 1920</li><li>22 bis 27 Sekunden</li><li>Stimme, Musik, Untertitel</li><li>−14 LUFS</li></ul>
    <p class="sound">Ton: Auf Play tippen, die Videos spielen mit Stimme und Musik. Bleibt es still, im Player das Lautsprecher-Symbol antippen und am Handy den Lautlos-Schalter prüfen.</p>
  </header>

  <div class="wall">{{CARDS}}
  </div>

  <section id="trigger">
    <h2>Kommentar-Trigger einrichten</h2>
    <p>Jedes Reel bittet um den Kommentar „Discord“. Eine automatische Antwort (zum Beispiel die Kommentar-Automatisierung in Instagram oder ManyChat) schickt daraufhin per DM den Einladungslink.</p>
    <ol class="steps">
      <li>Schlüsselwort: <span class="code">Discord</span>, Groß- und Kleinschreibung egal, auch als Teil eines Kommentars.</li>
      <li>Öffentliche Antwort unter dem Kommentar, damit der Trigger sichtbar wird: „Check deine DMs.“</li>
      <li>DM-Text mit dem Link, siehe unten.</li>
    </ol>
    <pre class="post" id="dm">{{DM}}</pre>
    <div><button class="copy" type="button" data-target="dm">DM-Text kopieren</button></div>
    <p class="muted">Einladungslink: <span class="code">{{DISCORD}}</span></p>
  </section>

  <section id="testplan">
    <h2>Testplan</h2>
    <ol class="steps">
      <li>Organisch: ein Reel pro Tag, Reihenfolge 1, 3, 5, 2, 4, 6. Reel 3 fragt zusätzlich nach der eigenen Antwort im Kommentar.</li>
      <li>Werbung: alle sechs mit gleichem Budget in einer Anzeigengruppe, Ziel Interaktion.</li>
      <li>Nach 3 bis 5 Tagen vergleichen: Hook-Rate (3-Sekunden-Aufrufe ÷ Impressionen), durchschnittliche Wiedergabedauer, Kommentare mit „Discord“, DMs und neue Mitglieder im Discord.</li>
      <li>Die drei schwächsten pausieren, für die stärksten neue Hooks bauen. Die Szenen hängen an den gesprochenen Wörtern, ein neuer Hook ist eine neue erste Zeile.</li>
    </ol>
  </section>

  <div class="cols">
    <section>
      <h2>Inhalte</h2>
      <ul>
        <li>Nur Beispieldaten mit erfundenen Namen (Lena W., Malik K., Alex …), auf den Karten als „Beispiel“ markiert. Keine echten Mitglieder, keine echten Zahlen.</li>
        <li>Discord wird genannt, aber ohne Logo und ohne nachgebaute Discord-Oberfläche. Keine andere Fremdmarke.</li>
        <li>Begriffe wie in der App: Anwahlen, Tagesabschluss, Tagesmarke, Serie, Rangliste, Call-Partner, Roleplay. Keine Punkte, kein XP.</li>
      </ul>
    </section>
    <section>
      <h2>Ton und Rechte</h2>
      <ul>
        <li>Musik: Kevin MacLeod über FreePD.com, gemeinfrei (CC0). Goodnightmare, Industrial Matter, Arpent.</li>
        <li>Stimme: Qwen3-TTS (Apache-2.0), dieselbe Stimmfarbe wie in den DealUno-Reels.</li>
        <li>Soundeffekte: Pixabay Content License, kommerziell nutzbar ohne Namensnennung.</li>
        <li>Schrift: Manrope (SIL Open Font License). Lautheit −14 LUFS, Stimme etwa 11 LU vor der Musik.</li>
      </ul>
    </section>
  </div>
</div>

<script>
  document.querySelectorAll(".copy").forEach(function (b) {
    b.addEventListener("click", function () {
      var el = document.getElementById(b.dataset.target);
      var text = el.textContent;
      var done = function () { var t = b.textContent; b.textContent = "Kopiert"; setTimeout(function () { b.textContent = t; }, 1600); };
      var select = function () { var r = document.createRange(); r.selectNodeContents(el); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); b.textContent = "Markiert, jetzt kopieren"; };
      try { navigator.clipboard.writeText(text).then(done, select); } catch (e) { select(); }
    });
  });
  // one reel plays at a time
  document.querySelectorAll("video").forEach(function (v) {
    v.addEventListener("play", function () { document.querySelectorAll("video").forEach(function (o) { if (o !== v) o.pause(); }); });
  });
</script>
"""

if __name__ == "__main__":
    main()
