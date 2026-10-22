# usage: tts.py jobs.json   jobs = [{"id":..., "text":..., "seed":int}] -> voice/raw/<id>.wav
import sys, json, os, time, torch, soundfile as sf
torch.set_num_threads(4)
from qwen_tts import Qwen3TTSModel
REF_AUDIO = os.environ.get('REF_AUDIO', 'voice/ref/neu-b2.wav')
REF_TEXT = os.environ.get('REF_TEXT', 'Dein Claude sucht im Lead-Radar passende Firmen raus. Mit Website, Entscheider und Nummer.')
MODEL = os.environ.get('TTS_MODEL', 'Qwen/Qwen3-TTS-12Hz-1.7B-Base')
jobs = json.load(open(sys.argv[1]))
os.makedirs('voice/raw', exist_ok=True)
t0=time.time()
model = Qwen3TTSModel.from_pretrained(MODEL, device_map='cpu', dtype=torch.float32)
prompt = model.create_voice_clone_prompt(ref_audio=REF_AUDIO, ref_text=REF_TEXT, x_vector_only_mode=False)
print('loaded', round(time.time()-t0,1), flush=True)
for j in jobs:
    out = f"voice/raw/{j['id']}.wav"
    if os.path.exists(out) and not j.get('force'): continue
    torch.manual_seed(j.get('seed', 7))
    t=time.time()
    wavs, sr = model.generate_voice_clone(text=j['text'], language='German', voice_clone_prompt=prompt, **j.get('gen', {}))
    sf.write(out, wavs[0], sr)
    print(j['id'], 'dur', round(len(wavs[0])/sr,2), 'took', round(time.time()-t,1), flush=True)
