"""Mic A/B look at one FT-710 recording: active span, level, band split, crest, spectrogram PNG.  usage: mic_analyze.py FILE.wav [more.wav ...]"""
import sys, wave, struct, math
import numpy as np
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
db = lambda v: 10 * math.log10(max(v, 1e-30))
def load(p):
    w = wave.open(p); n = w.getnframes(); return np.array(struct.unpack("<%dh" % n, w.readframes(n)), float) / 32768, w.getframerate()
for p in sys.argv[1:]:
    x, fs = load(p); b = int(.05 * fs); pw = np.array([np.mean(x[i:i + b] ** 2) for i in range(0, len(x) - b, b)])
    noise = np.median(pw[:30]); act = np.where(pw > noise * 6)[0]; a0, a1 = act[0] * b, (act[-1] + 1) * b
    s = x[a0:a1]; S = np.abs(np.fft.rfft(s * np.hanning(len(s)))) ** 2; f = np.fft.rfftfreq(len(s), 1 / fs)
    N = np.abs(np.fft.rfft(x[:len(s)] * np.hanning(len(s)))) ** 2 if len(x) >= 2 * len(s) else np.zeros_like(S)
    band = lambda lo, hi: S[(f >= lo) & (f < hi)].sum()
    tot = band(0, 6000); cum = np.cumsum(S[f < 6000]) / tot
    pk = np.abs(s).max(); rms = math.sqrt(np.mean(s ** 2))
    print(f"{p}: active {len(s)/fs:.1f}s ({a0/fs:.1f}-{a1/fs:.1f}s)  noise {db(noise):.1f} dB  speech rms {db(rms**2):.1f} dBFS  peak {20*math.log10(pk):.1f} dBFS  crest {20*math.log10(pk/rms):.1f} dB")
    print("  band share dB re total:", "  ".join(f"{lo}-{hi}:{db(band(lo,hi)/tot):.1f}" for lo, hi in [(0,300),(300,700),(700,1500),(1500,2700),(2700,6000)]),
          f" | 5%-95% energy {f[np.searchsorted(cum,.05)]:.0f}-{f[np.searchsorted(cum,.95)]:.0f} Hz")
    # envelope modulation depth: dips between syllables (hallway/reverb fills the dips)
    env = np.sqrt(pw[act[0]:act[-1] + 1]); lo, hi = np.percentile(env, 10), np.percentile(env, 90)
    print(f"  envelope 10th/90th percentile ratio {20*math.log10(hi/max(lo,1e-9)):.1f} dB (small = dips filled in)")
    fig, ax = plt.subplots(figsize=(10, 4)); ax.specgram(x[max(0,a0-fs//2):a1+fs//2], NFFT=1024, Fs=fs, noverlap=768, cmap="magma", vmin=-110, vmax=-40); ax.set_ylim(0, 4000)
    ax.set_title(p); fig.tight_layout(); fig.savefig(p.replace(".wav", ".png"), dpi=90)
