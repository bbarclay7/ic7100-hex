"""Adjacent-channel level from two recordings of the same file: A = FT-710 on the carrier, B = FT-710 tuned 3 kHz lower."""
import sys, wave, struct, math
import numpy as np
from scipy import signal
db10 = lambda v: 10 * math.log10(max(v, 1e-30))
def load(p):
    w = wave.open(p); n = w.getnframes(); fs = w.getframerate(); return np.array(struct.unpack("<%dh" % n, w.readframes(n)), dtype=float) / 32768, fs
def bl(x, fs, lo=300, hi=2800): return signal.sosfiltfilt(signal.butter(4, [lo, hi], btype="band", fs=fs, output="sos"), x)
def inband_power(rec, fs):                 # mean power over the 8 s test signal, located by the chirp at the start of every file
    T = 0.3; tt = np.arange(int(fs * T)) / fs; chirp = 0.4 * np.sin(2 * np.pi * (300 * tt + 2200 * tt ** 2 / (2 * T)))
    xc = signal.correlate(bl(rec, fs), chirp, mode="valid", method="fft"); delay = int(np.argmax(np.abs(xc))) - int(0.5 * fs)
    s = delay + int(1.7 * fs); seg = rec[s: s + 8 * fs]; return float(np.mean(seg ** 2)), float(np.mean(rec[: int(2 * fs)] ** 2))
def excess_power(rec, fs, secs=8.0, blk=0.1):
    b = int(blk * fs); p = np.array([np.mean(rec[i:i + b] ** 2) for i in range(0, len(rec) - b, b)]); n = int(2 / blk)
    noise = p[:n].mean(); tail = (p[-n:].mean() - noise) / secs * (n * blk)      # what the quiet tail adds: the measurement's own error
    return float((p[n:] - noise).sum() * blk / secs), float(noise), float(tail)
print(f"{'file':20} {'in-band (A)':>12} {'adjacent (B)':>13} {'splatter':>10}   notes")
for f in sys.argv[1:]:
    a, fs = load(f"rfA_{f}.wav"); b, _ = load(f"rfB_{f}.wav")
    pa, na = inband_power(a, fs); ex, nb, tail = excess_power(b, fs)
    sn = db10(max(ex, 1e-30)) - db10(nb)
    ratio = db10(max(ex, 1e-30)) - db10(pa - na)
    note = "" if ex > 3 * abs(tail) and sn > 0 else "at/below the measurement floor"
    print(f"{f:20} {db10(pa - na):9.1f} dB {db10(max(ex,1e-30)):10.1f} dB {ratio:8.1f} dBc   excess is {sn:5.1f} dB over the noise; tail error {db10(abs(tail)):.1f} dB. {note}")
