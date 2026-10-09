import sys, wave, struct, math
import numpy as np
def load(p):
    w = wave.open(p); n = w.getnframes(); return np.array(struct.unpack("<%dh" % n, w.readframes(n)), dtype=float) / 32768, w.getframerate()
db = lambda v: 20 * math.log10(v + 1e-12)
print(f"{'run':34} {'noise':>7} {'active rms':>11} {'over noise':>11} {'peak':>7} {'peak-avg':>9}  active")
for name, p in (("run1 baseline Heil (handset)", "run1_baseline_heil.wav"), ("run2c panel, CESSB off", "run2c_panel_cessb_off.wav"), ("run3 panel, CESSB on", "run3_panel_cessb_on.wav"), ("run4 baseline Heil again", "run4_baseline_heil2.wav"), ("run5 panel, CESSB on, +18 dB", "run5_panel_cessb_on_plus18.wav"), ("run6 Heil, mic gain 30%", "run6_baseline_heil_mic30.wav")):
    x, fs = load(p); blk = fs // 20                     # 50 ms blocks
    r = np.array([np.sqrt((x[i:i+blk] ** 2).mean()) for i in range(0, len(x) - blk, blk)])
    noise = np.median(r); act = r > noise * 4            # blocks well above the noise
    seg = np.concatenate([x[i*blk:(i+1)*blk] for i in np.where(act)[0]])
    rms = np.sqrt((seg ** 2).mean()); pk = abs(seg).max()
    print(f"{name:34} {db(noise):7.1f} {db(rms):11.1f} {db(rms)-db(noise):9.1f} dB {db(pk):7.1f} {db(pk)-db(rms):7.1f} dB  {act.sum()*0.05:.1f} s")
