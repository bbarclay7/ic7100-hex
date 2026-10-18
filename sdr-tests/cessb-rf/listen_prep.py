"""Make a WAV from a tap .raw and print level stats; level-matched copy for listening.  usage: listen_prep.py RAW NAME"""
import sys, wave, numpy as np, math
def save(p,x):
    w=wave.open(p,"wb"); w.setnchannels(1); w.setsampwidth(2); w.setframerate(48000); w.writeframes((np.clip(x,-1,1)*32767).astype("<i2").tobytes()); w.close()
def env(x):
    X=np.fft.fft(x); h=np.zeros(len(x)); h[0]=1; h[1:len(x)//2]=2; h[len(x)//2]=1; return np.abs(np.fft.ifft(X*h))
db=lambda v:20*math.log10(max(v,1e-9))
raw=np.fromfile(sys.argv[1],"<i2").astype(float)/32768; name=sys.argv[2]
save(f"listen/{name}.wav",raw); e=env(raw); r=math.sqrt(np.mean(raw[e>0.01]**2))
d=np.abs(np.diff(raw*32768)); loc=np.convolve(d,np.ones(480)/480,"same")+1; idx=np.where(d/loc>12)[0]; ev=[]
for i in idx:
    if not ev or i-ev[-1]>96: ev.append(i)
print(f"{name}: {len(raw)/48000:.1f}s peak {db(abs(raw).max()):.1f} envpeak {db(e.max()):.1f} rms(active) {db(r):.1f} jumps {len(ev)}")
save(f"listen/{name}_level_matched.wav",raw*(0.1/r))
