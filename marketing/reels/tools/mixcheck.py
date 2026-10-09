import sys, json, numpy as np, pyloudnorm as pyln
sys.argv=[sys.argv[0]]+sys.argv[1:]
import importlib.util
spec=importlib.util.spec_from_file_location('mix','tools/mix.py'); m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
slug=sys.argv[1]
data=open(f"reels/{slug}/data.js").read(); R=json.loads(data[data.index("{"):data.rindex("}")+1]); D=R['duration']; N=int(D*m.SR)
vo=m.voice_chain(f"voice/track/{slug}.wav")[:N]; vo=np.pad(vo,(0,N-len(vo)))
mf,ms,mg=m.MUSIC[slug]; mu=m.dec(mf,2,m.beat_snap(mf,ms),D+1)[:N]; mu=np.pad(mu,((0,N-len(mu)),(0,0)))
env=m.envelope(vo); mu*= (mg*(1-0.62*env))[:,None]
meter=pyln.Meter(m.SR)
sp=env>0.5
lv=meter.integrated_loudness(np.stack([vo,vo],1)[sp]); lm=meter.integrated_loudness(mu[sp]); lmo=meter.integrated_loudness(mu[~sp])
print(slug,'voice',round(lv,1),'music under voice',round(lm,1),'diff',round(lv-lm,1),'music in gaps',round(lmo,1))
