import sys, json, numpy as np, librosa, warnings
warnings.filterwarnings('ignore')
for p in sys.argv[1:]:
    y, sr = librosa.load(p, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    rms = librosa.feature.rms(y=y, hop_length=sr//2)[0]  # 0.5s frames
    cent = librosa.feature.spectral_centroid(y=y, sr=sr, hop_length=sr//2)[0]
    dur = len(y)/sr
    # energy per 5s block
    blocks = [round(float(rms[i*10:(i+1)*10].mean()),3) for i in range(int(dur//5))]
    print(f"{p.split('/')[-1]:28s} dur {dur:6.1f}s tempo {float(np.atleast_1d(tempo)[0]):6.1f} meanRMS {rms.mean():.3f} cent {cent.mean():5.0f}")
    print('   5s-blocks', blocks[:40])
