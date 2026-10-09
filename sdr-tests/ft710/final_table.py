import wave, struct, math, os
import numpy as np
RUNS = [("A  handset, mic gain 40%", "final_A_handset40_100w.wav"), ("B  panel, CESSB on (+12 dB)", "final_B_panel_cessb_on_100w.wav"), ("C  panel, CESSB off", "final_C_panel_cessb_off_100w.wav"), ("D  handset, radio comp 50%", "final_D_handset_comp50_100w.wav")]
db = lambda v: 20 * math.log10(v + 1e-12)
print(f"{'run (all at 100% power)':30} {'noise':>7} {'over noise':>11} {'peak':>7} {'peak-avg':>9} {'speech':>7} {'clipped?':>9}")
for label, p in RUNS:
    if not os.path.exists(p): continue
    w = wave.open(p); n = w.getnframes(); fs = w.getframerate(); x = np.array(struct.unpack("<%dh" % n, w.readframes(n)), dtype=float) / 32768
    blk = fs // 20; r = np.array([np.sqrt((x[i:i+blk] ** 2).mean()) for i in range(0, len(x) - blk, blk)])
    noise = np.median(r); act = r > noise * 4
    seg = np.concatenate([x[i*blk:(i+1)*blk] for i in np.where(act)[0]]); rms = np.sqrt((seg ** 2).mean()); pk = abs(seg).max()
    print(f"{label:30} {db(noise):7.1f} {db(rms)-db(noise):9.1f} dB {db(pk):6.1f} {db(pk)-db(rms):7.1f} dB {act.sum()*0.05:5.1f} s {'YES' if pk > 0.98 else 'no':>9}")
