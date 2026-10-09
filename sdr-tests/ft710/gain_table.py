import wave, struct, math, sys
import numpy as np
RUNS = [("30%", "run6_baseline_heil_mic30.wav"), ("45%", "run7_heil_mic45.wav"), ("60%", "run8_heil_mic60.wav"), ("75%", "run9_heil_mic75.wav"), ("99%", "run4_baseline_heil2.wav")]
db = lambda v: 20 * math.log10(v + 1e-12)
print(f"{'mic gain':>8} {'over noise':>11} {'peak':>8} {'peak-avg':>9} {'speech':>7}")
for label, p in RUNS:
    try: w = wave.open(p)
    except Exception: continue
    n = w.getnframes(); fs = w.getframerate(); x = np.array(struct.unpack("<%dh" % n, w.readframes(n)), dtype=float) / 32768
    blk = fs // 20; r = np.array([np.sqrt((x[i:i+blk] ** 2).mean()) for i in range(0, len(x) - blk, blk)])
    noise = np.median(r); act = r > noise * 4
    seg = np.concatenate([x[i*blk:(i+1)*blk] for i in np.where(act)[0]]); rms = np.sqrt((seg ** 2).mean())
    print(f"{label:>8} {db(rms)-db(noise):9.1f} dB {db(abs(seg).max()):6.1f} {db(abs(seg).max())-db(rms):7.1f} dB {act.sum()*0.05:5.1f} s")
