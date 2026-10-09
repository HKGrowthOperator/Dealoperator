"""Mix voice + ducked music bed + SFX cues for one reel, loudness-normalised to -14 LUFS.

usage: mix.py <slug>
reads  voice/track/<slug>.wav, reels/<slug>/cues.json, reels/<slug>/data.js, MUSIC config below
writes audio/<slug>.wav (48 kHz stereo)
"""
import json, os, subprocess, sys
import numpy as np, soundfile as sf, librosa, pyloudnorm as pyln

SR = 48000
# bundled HyperFrames SFX (Pixabay Content License); point SFX_DIR at a checkout of heygen-com/hyperframes
SFX_DIR = os.environ.get("SFX_DIR", "/home/user/hyperframes/skills/media-use/audio/assets/sfx")
MUSIC = {
    # file, start offset in the track (s, snapped to a beat), bed gain
    "1-allein": ("music/Goodnightmare.mp3", 34.0, 0.55),
    "2-merkt": ("music/Industrial Matter.mp3", 21.0, 0.33),
    "3-einwand": ("music/Industrial Matter.mp3", 64.0, 0.36),
    "4-pov": ("music/Goodnightmare.mp3", 96.0, 0.55),
    "5-ehrlich": ("music/Arpent.mp3", 40.0, 0.7),
    "6-rollen": ("music/Arpent.mp3", 131.0, 0.6),
}
SFX_MASTER = 0.5

def dec(path, ch=2, start=0.0, dur=None):
    cmd = ["ffmpeg", "-v", "error", "-ss", str(start), "-i", path]
    if dur: cmd += ["-t", str(dur)]
    cmd += ["-ac", str(ch), "-ar", str(SR), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch).copy()

def voice_chain(path):
    # gentle broadcast chain: rumble cut, warmth trim, presence, level control
    af = ("highpass=f=75,equalizer=f=220:t=q:w=1.1:g=-1.5,equalizer=f=3300:t=q:w=1.3:g=2.5,"
          "equalizer=f=9000:t=h:w=1:g=1.5,acompressor=threshold=-20dB:ratio=3:attack=4:release=90:makeup=3")
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-af", af, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()

def envelope(x, attack=0.03, release=0.45):
    win = int(0.02 * SR)
    p = np.sqrt(np.convolve(x ** 2, np.ones(win) / win, mode="same"))
    act = (p > 0.02).astype(np.float32)
    out = np.zeros_like(act); a = np.exp(-1 / (attack * SR)); r = np.exp(-1 / (release * SR)); v = 0.0
    for i in range(len(act)):  # one-pole attack/release follower
        c = a if act[i] > v else r
        v = c * v + (1 - c) * act[i]
        out[i] = v
    return out

def beat_snap(path, t):
    y, sr = librosa.load(path, sr=22050, mono=True, offset=max(0, t - 4), duration=8)
    _, beats = librosa.beat.beat_track(y=y, sr=sr)
    bt = librosa.frames_to_time(beats, sr=sr) + max(0, t - 4)
    return float(bt[np.argmin(np.abs(bt - t))]) if len(bt) else t

def onset(y):
    a = np.abs(y).max(axis=1)
    idx = np.argmax(a > a.max() * 0.08)
    return idx / SR

def main(slug):
    data = open(f"reels/{slug}/data.js").read()
    R = json.loads(data[data.index("{"):data.rindex("}") + 1])
    D = R["duration"]; N = int(D * SR)
    vo = voice_chain(f"voice/track/{slug}.wav")[:N]
    vo = np.pad(vo, (0, N - len(vo)))
    env = envelope(vo)
    # music bed: beat-snapped start, ducked under the voice, lifted on the end card, faded out
    mf, mstart, mgain = MUSIC[slug]
    mstart = beat_snap(mf, mstart)
    mu = dec(mf, 2, mstart, D + 1)[:N]
    mu = np.pad(mu, ((0, N - len(mu)), (0, 0)))
    duck = 1 - 0.62 * env                         # about -8.5 dB under speech
    t = np.arange(N) / SR
    vo_end = R["lines"][-1]["e"]
    lift = 1 + 0.35 * np.clip((t - vo_end) / 0.6, 0, 1)
    fade = np.clip((D - t) / 1.4, 0, 1) ** 1.5
    fin = np.clip(t / 0.05, 0, 1)
    mu *= (mgain * duck * lift * fade * fin)[:, None]
    # sfx
    fx = np.zeros((N, 2), np.float32)
    cache = {}
    for c in json.load(open(f"reels/{slug}/cues.json")):
        name = c["name"]
        if name not in cache:
            y = dec(f"{SFX_DIR}/{name}.mp3", 2)
            pre = onset(y)
            if name in ("impact-bass-2", "riser"):
                pre = np.argmax(np.abs(y).max(axis=1)) / SR  # align the peak, not the swell
            cache[name] = (y, pre)
        y, pre = cache[name]
        a = int((c["t"] - pre) * SR)
        if a < 0: y = y[-a:]; a = 0
        b = min(N, a + len(y))
        if b > a: fx[a:b] += y[: b - a] * c["gain"]
    mix = np.stack([vo, vo], 1) * 1.0 + mu + fx * SFX_MASTER
    # loudness to -14 LUFS, then a soft ceiling at -1 dBTP
    meter = pyln.Meter(SR)
    lufs = meter.integrated_loudness(mix)
    mix *= 10 ** ((-14 - lufs) / 20)
    ceil = 10 ** (-1.8 / 20)
    over = np.abs(mix) > ceil * 0.8
    mix = np.where(over, np.sign(mix) * (ceil * 0.8 + (ceil * 0.2) * np.tanh((np.abs(mix) - ceil * 0.8) / (ceil * 0.2))), mix)
    os.makedirs("audio", exist_ok=True)
    sf.write(f"audio/{slug}.wav", mix.astype(np.float32), SR, subtype="PCM_24")
    print(slug, f"music@{mstart:.2f}s", "in", round(lufs, 1), "-> out", round(meter.integrated_loudness(mix), 1), "LUFS peak", round(20 * np.log10(np.abs(mix).max()), 2), "dBFS")

if __name__ == "__main__":
    for s in sys.argv[1:]:
        main(s)
