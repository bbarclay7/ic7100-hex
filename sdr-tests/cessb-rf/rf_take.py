"""Level of one FT-710 recording of a take: total power over the noise (like np_analyze), received peak, crest.  usage: rf_take.py FILE.wav..."""
import sys, wave, numpy as np, math
db=lambda v:10*math.log10(max(v,1e-30))
for p in sys.argv[1:]:
    w=wave.open(p); x=np.frombuffer(w.readframes(w.getnframes()),"<i2").astype(float)/32768; fs=w.getframerate()
    b=int(.1*fs); pw=np.array([np.mean(x[i:i+b]**2) for i in range(0,len(x)-b,b)])
    noise=np.median(pw[:15]); act=np.where(pw>noise*6)[0]; a0,a1=act[0],act[-1]+1
    ex=(pw[a0:a1]-noise).clip(0); avg=ex.mean(); pk=np.abs(x[a0*b:a1*b]).max()
    print(f"{p}: active {(a1-a0)*.1:.1f}s noise {db(noise):.1f} dB  avg-over-noise {db(avg):.1f} dB  received peak {20*math.log10(pk):.1f} dBFS  avg-to-peak {20*math.log10(pk)-db(avg):.1f} dB")
