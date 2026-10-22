"""Assemble one reel's voice track from per-line TTS takes and write word timings.

usage: build_voice.py <slug>
reads  scripts.json, voice/raw/<slug>_<n>.wav, voice/raw/cta.wav
writes voice/track/<slug>.wav (48 kHz mono), reels/<slug>/data.js
"""
import json, os, re, subprocess, sys
import numpy as np, soundfile as sf, librosa
from faster_whisper import WhisperModel

SR = 48000
LEAD = 0.10          # first word lands on frame ~3
END_HOLD = 2.6       # end card stays after the CTA line
CFG = {
    # gap after each line (seconds); last entry is the gap before the CTA
    "1-allein": {"gaps": [0.45, 0.32, 0.22, 0.28, 0.30, 0.28, 0.30], "embed": [0, 4, 6]},
    "2-merkt": {"gaps": [0.18, 0.42, 0.30, 0.22, 0.26, 0.26, 0.34], "embed": [0, 1, 2]},
    "3-einwand": {"gaps": [0.25, 1.15, 0.30, 0.28, 0.34], "embed": [0, 1, 2], "phone": [0]},
    "4-pov": {"gaps": [0.15, 0.32, 0.26, 0.30, 0.30, 0.30], "embed": [0, 1, 5]},
    "5-ehrlich": {"gaps": [0.22, 0.42, 0.30, 0.26, 0.26, 0.30], "embed": [0, 1]},
    "6-rollen": {"gaps": [0.20, 0.26, 0.26, 0.22, 0.22, 0.26, 0.30], "embed": [0, 1, 6]},
}

def load(p):
    y, _ = librosa.load(p, sr=SR, mono=True)
    y, _ = librosa.effects.trim(y, top_db=46, frame_length=1024, hop_length=256)
    pad = np.zeros(int(0.02 * SR), np.float32)
    return np.concatenate([pad, y.astype(np.float32), pad])

def phone(y):
    """Telephone band for a prospect line: 300-3400 Hz, a little grit, same loudness."""
    from scipy.signal import butter, sosfilt
    sos = butter(4, [320, 3300], btype="band", fs=SR, output="sos")
    z = sosfilt(sos, y)
    z = np.tanh(z * 2.2) / np.tanh(2.2)
    return (z * (np.sqrt((y ** 2).mean()) / (np.sqrt((z ** 2).mean()) + 1e-9))).astype(np.float32)

def nrm(s):
    return re.sub(r"[^a-zäöüß0-9]", "", s.lower())

def align(script_line, wwords, dur):
    """Map whisper word timings onto the script's own tokens via character position."""
    toks = script_line.split()
    # whisper char spans
    wpos, acc = [], 0
    for w in wwords:
        n = len(nrm(w["w"])) or 1
        wpos.append((acc, acc + n, w["s"], w["e"])); acc += n
    total_w = acc or 1
    tpos, acc = [], 0
    for t in toks:
        n = len(nrm(t)) or 1
        tpos.append((acc, acc + n)); acc += n
    total_t = acc or 1
    def time_at(c, end=False):
        c = c * total_w / total_t
        for a, b, s, e in wpos:
            if (c < b) or (end and c <= b):
                if b == a: return s
                f = (c - a) / (b - a)
                return s + f * (e - s)
        return wpos[-1][3] if wpos else dur
    out = []
    for t, (a, b) in zip(toks, tpos):
        s = time_at(a); e = time_at(b - 0.001, end=True)
        out.append({"w": t, "s": s, "e": max(e, s + 0.05)})
    return out

def main(slug):
    S = json.load(open("scripts.json"))
    reel = next(r for r in S["reels"] if r["slug"] == slug)
    cfg = CFG[slug]
    texts = reel["lines"] + [S["cta"]["text"]]
    files = [f"voice/raw/{slug}_{i+1}.wav" for i in range(len(reel["lines"]))] + ["voice/raw/cta.wav"]
    model = WhisperModel("large-v3", device="cpu", compute_type="int8", cpu_threads=4)
    clips, lines, t = [], [], LEAD
    for i, (txt, f) in enumerate(zip(texts, files)):
        y = load(f)
        if i in cfg.get("phone", []):
            y = phone(y)
        y16 = librosa.resample(y, orig_sr=SR, target_sr=16000)
        segs, _ = model.transcribe(y16, language="de", word_timestamps=True, beam_size=5, initial_prompt=txt)
        ww = [{"w": w.word.strip(), "s": w.start, "e": w.end} for s in segs for w in s.words]
        heard = " ".join(w["w"] for w in ww)
        words = align(txt, ww, len(y) / SR)
        for w in words:
            w["s"] = round(t + w["s"], 3); w["e"] = round(t + w["e"], 3)
        lines.append({"i": i, "s": round(t, 3), "e": round(t + len(y) / SR, 3), "text": txt, "heard": heard, "words": words, "cta": i == len(texts) - 1})
        clips.append((t, y))
        gap = cfg["gaps"][i] if i < len(cfg["gaps"]) else 0.3
        t += len(y) / SR + (gap if i < len(texts) - 1 else 0)
        ok = nrm(heard) == nrm(txt)
        print(f"  {i}: {'OK ' if ok else 'CHK'} {txt!r} -> {heard!r}")
    duration = round(lines[-1]["e"] + END_HOLD, 2)
    track = np.zeros(int((duration + 0.5) * SR), np.float32)
    for st, y in clips:
        a = int(st * SR); track[a:a + len(y)] += y
    os.makedirs("voice/track", exist_ok=True)
    sf.write(f"voice/track/{slug}.wav", track, SR)
    os.makedirs(f"reels/{slug}", exist_ok=True)
    data = {"slug": slug, "duration": duration, "embed": cfg["embed"], "lines": lines}
    open(f"reels/{slug}/data.js", "w").write("window.REEL = " + json.dumps(data, ensure_ascii=False) + ";\n")
    print(slug, "duration", duration)

if __name__ == "__main__":
    for s in sys.argv[1:]:
        main(s)
