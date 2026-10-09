import sys, numpy as np, librosa, warnings
warnings.filterwarnings('ignore')
for p in sys.argv[1:]:
    y, sr = librosa.load(p, sr=22050, mono=True)
    H, P = librosa.effects.hpss(y)
    oenv = librosa.onset.onset_strength(y=y, sr=sr)
    tempo, beats = librosa.beat.beat_track(onset_envelope=oenv, sr=sr)
    tempo=float(np.atleast_1d(tempo)[0])
    # pulse clarity: autocorrelation peak at beat lag
    ac = librosa.autocorrelate(oenv - oenv.mean()); ac /= ac[0]
    lag = int(round(60/tempo*sr/512)); pc = ac[max(1,lag-2):lag+3].max()
    S = np.abs(librosa.stft(y)); f = librosa.fft_frequencies(sr=sr)
    low = S[f<150].sum()/S.sum(); mid = S[(f>300)&(f<3000)].sum()/S.sum()
    print(f"{p.split('/')[-1]:24s} tempo {tempo:6.1f} perc/harm {np.sqrt((P**2).mean()/(H**2).mean()):.2f} pulse {pc:.2f} low {low:.2f} mid {mid:.2f} dur {len(y)/sr:.0f}")
