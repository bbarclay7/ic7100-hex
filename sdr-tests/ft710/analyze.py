import sys, wave, struct, math
import numpy as np
def load(p):
    w = wave.open(p); n = w.getnframes(); fs = w.getframerate()
    return np.array(struct.unpack("<%dh" % n, w.readframes(n)), dtype=float) / 32768, fs
def db(v): return 20 * math.log10(v + 1e-12)
x, fs = load(sys.argv[1]); sec = fs
rms = [np.sqrt((x[i:i+sec//2] ** 2).mean()) for i in range(0, len(x) - sec//2 + 1, sec//2)]
print("level per 0.5 s (dBFS rms): " + " ".join("%d" % db(r) for r in rms))
floor = np.median(rms); act = [i for i, r in enumerate(rms) if r > floor * 3]
if act:
    a, b = act[0] * sec // 2, (act[-1] + 1) * sec // 2; seg = x[a:b]
    print("noise floor %.1f dBFS | signal from %.1f s to %.1f s (%.1f s long)" % (db(floor), a / fs, b / fs, (b - a) / fs))
    print("during signal: rms %.1f dBFS, peak %.1f dBFS, crest %.1f dB, signal-over-noise %.1f dB" % (db(np.sqrt((seg**2).mean())), db(abs(seg).max()), db(abs(seg).max()) - db(np.sqrt((seg**2).mean())), db(np.sqrt((seg**2).mean())) - db(floor)))
    S = np.abs(np.fft.rfft(seg * np.hanning(len(seg)))) ** 2; f = np.fft.rfftfreq(len(seg), 1 / fs)
    tot = S[(f > 100) & (f < 4000)].sum()
    for lo, hi in ((100, 300), (300, 1000), (1000, 2000), (2000, 3000), (3000, 4000)): print("  %4d-%4d Hz: %5.1f%% of energy" % (lo, hi, 100 * S[(f >= lo) & (f < hi)].sum() / tot))
else: print("no signal above the noise found")
