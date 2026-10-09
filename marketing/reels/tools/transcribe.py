import sys, json, subprocess, numpy as np
from faster_whisper import WhisperModel
def load(p):
    raw = subprocess.run(['ffmpeg','-v','error','-i',p,'-ac','1','-ar','16000','-f','f32le','-'],capture_output=True,check=True).stdout
    return np.frombuffer(raw, np.float32)
m = WhisperModel('large-v3', device='cpu', compute_type='int8', cpu_threads=4)
prompt = None
args = sys.argv[1:]
if args and args[0].startswith('--prompt='):
    prompt = args[0][9:]; args = args[1:]
for p in args:
    segs, info = m.transcribe(load(p), language='de', word_timestamps=True, beam_size=5, initial_prompt=prompt)
    words=[]; text=[]
    for s in segs:
        text.append(s.text.strip())
        for w in s.words: words.append({'w':w.word.strip(),'s':round(w.start,3),'e':round(w.end,3),'p':round(w.probability,3)})
    print(json.dumps({'file':p,'text':' '.join(text),'words':words}, ensure_ascii=False), flush=True)
