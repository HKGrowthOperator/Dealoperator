# Deal Operator Community-Reels

Sechs 9:16-Reels (1080 × 1920, 30 fps, 22–27 s) für die Sales-Community. Jedes endet mit dem Kommentar-Trigger „Schreib Discord in die Kommentare, und ich schick dir den Link.“

| Reel | Hook | Musik |
| --- | --- | --- |
| `1-allein` | Callen alleine ist brutal. | Goodnightmare |
| `2-merkt` | Du hörst nicht wegen der Absagen auf. | Industrial Matter |
| `3-einwand` | „Schicken Sie mir einfach mal Infos per Mail.“ | Industrial Matter |
| `4-pov` | Es ist 8:59. Gleich startet die Call-Session. | Goodnightmare |
| `5-ehrlich` | Wie viele Anwahlen hast du diese Woche gemacht? | Arpent |
| `6-rollen` | Opener. Setter. Closer. Selbstständig. | Arpent |

Die fertigen Videos liegen nicht im Repository.

## Aufbau

- `scripts.json`: Sprechertexte je Reel, eine Zeile je Satz, dazu die gemeinsame CTA-Zeile.
- `shared/`: Bühne, Marke, App-Karten, Untertitel und Bewegungshelfer (`lib.js`, `brand.css`) sowie GSAP. Manrope kommt aus `public/fonts` der App.
- `reels/<slug>/reel.js`: die Choreografie eines Reels. Alle Zeiten hängen an den gesprochenen Wörtern (`H.at(zeile, "wort")`), nicht an festen Sekunden.
- `tools/`: Pipeline von der Stimme bis zum fertigen Mix.

## Pipeline

Alle Befehle laufen in `marketing/reels/`. Voraussetzungen: Python 3.12+ mit `qwen-tts`, `faster-whisper`, `librosa`, `soundfile`, `scipy`, `pyloudnorm`, `playwright`; Node 22; ffmpeg; Chromium.

0. **Musik**: `tools/fetch_music.sh` lädt die drei CC0-Stücke. **Jobs**: `tools/make_jobs.py` erzeugt `voice/jobs.json` aus `scripts.json`.
1. **Stimme**: `tools/tts.py voice/jobs.json` erzeugt jede Zeile mit Qwen3-TTS 1.7B (Voice-Clone, gleiche Stimmfarbe wie die DealUno-Reels).
2. **Timing**: `tools/build_voice.py <slug>` schneidet die Zeilen, setzt die Pausen, prüft jede Zeile mit Whisper large-v3 gegen den Text und schreibt `reels/<slug>/data.js` mit Wortzeiten. Die Interessenten-Zeile in Reel 3 läuft durch einen Telefon-Bandpass.
3. **Komposition**: `tools/assemble.py <slug>` baut `index.html` (HyperFrames) aus `data.js`, `reel.js` und `shared/`.
4. **Prüfen**: `npx hyperframes lint`, `tools/snap.sh <slug>` für Standbilder je Satz.
5. **Effekte**: `tools/cues.py <slug>` liest die Sound-Cues, die die Animation registriert (`H.sfx`).
6. **Mix**: `tools/mix.py <slug>` Stimme mit Sprach-EQ und Kompressor, Musik unter der Stimme geduckt (etwa 11 LU Abstand), Effekte, normalisiert auf −14 LUFS bei maximal −1,2 dBFS.
7. **Render**: `tools/render_all.sh <slugs…>` rendert mit HyperFrames 0.8.143, `tools/finalize.sh <slugs…>` legt den Ton an, erzeugt eine leichtere Web-Fassung und ein Vorschaubild.
8. **Übergabeseite**: `tools/page.py` baut die Seite mit Playern, Texten und Testplan.

Pfade zu Chromium (`PRODUCER_HEADLESS_SHELL_PATH`) und zur SFX-Bibliothek (`SFX_DIR` in `tools/mix.py`) sind auf die Arbeitsumgebung gesetzt und vor einem neuen Lauf anzupassen.

## Inhalte und Rechte

- Nur Beispieldaten mit erfundenen Namen (Lena W., Malik K., Alex …), auf den Karten als „Beispiel“ oder „Beispieldaten“ markiert. Keine echten Mitglieder, keine echten Zahlen.
- Discord wird nur genannt, kein Discord-Logo und keine nachgebaute Discord-Oberfläche.
- Musik: Kevin MacLeod über FreePD.com, gemeinfrei (CC0). FreePD ist geschlossen, die Dateien stammen aus der Archiv-Kopie auf archive.org (`freepd`).
- Stimme: Qwen3-TTS (Apache-2.0).
- Soundeffekte: HyperFrames-SFX-Bibliothek, Pixabay Content License (kommerziell ohne Namensnennung nutzbar).
- Schrift: Manrope (SIL Open Font License), GSAP (Standard-Lizenz, kostenfrei).
