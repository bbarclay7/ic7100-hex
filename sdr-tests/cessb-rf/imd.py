"""Two-tone IMD: tones at 900 and 1400 Hz were sent. usage: imd.py RECORDING.wav"""
import sys, wave, struct, math
import numpy as np
from scipy import signal
w = wave.open(sys.argv[1]); n = w.getnframes(); fs = w.getframerate()
x = np.array(struct.unpack("<%dh" % n, w.readframes(n)), dtype=float) / 32768
# lock on the chirp that starts every test file, then measure only the two-tone part (1.7 s after the file start, 4 s long)
T = 0.3; tt = np.arange(int(fs * T)) / fs; chirp = 0.4 * np.sin(2 * np.pi * (300 * tt + (2500 - 300) * tt ** 2 / (2 * T)))
sos = signal.butter(4, [300, 2800], btype="band", fs=fs, output="sos")
xc = signal.correlate(signal.sosfiltfilt(sos, x), chirp, mode="valid", method="fft"); delay = int(np.argmax(np.abs(xc))) - int(0.5 * fs)
seg = x[delay + int(1.7 * fs) + int(0.25 * fs): delay + int(1.7 * fs) + int(3.75 * fs)]          # 3.5 s, clear of the edges
f, P = signal.welch(seg, fs, nperseg=fs, window="blackmanharris")                # 1 Hz bins
def line(f0, half=3):
    k = int(round(f0)); return 10 * math.log10(P[k - half: k + half + 1].sum() + 1e-30)
off = 0
pk1 = f[np.argmax(P[850:950]) + 850]; pk2 = f[np.argmax(P[1350:1450]) + 1350]            # find the actual tone frequencies
t1, t2 = line(pk1), line(pk2); ref = (t1 + t2) / 2
print(f"tones found at {pk1:.0f} and {pk2:.0f} Hz | levels {t1:.1f} and {t2:.1f} dB (difference {t1 - t2:+.1f} dB)")
for name, fr in (("IMD3  2f1-f2", 2 * pk1 - pk2), ("IMD3  2f2-f1", 2 * pk2 - pk1), ("IMD5  3f1-2f2", 3 * pk1 - 2 * pk2), ("IMD5  3f2-2f1", 3 * pk2 - 2 * pk1), ("HD2   2f1", 2 * pk1), ("HD2   f1+f2", pk1 + pk2)):
    print(f"   {name:14s} {fr:6.0f} Hz : {line(fr) - ref:6.1f} dBc" + ("   (outside the radio's ~300-2700 Hz passband)" if fr < 300 or fr > 2700 else ""))
floor = 10 * math.log10(np.median(P[200:3500]) * 7 + 1e-30)
print(f"   noise floor in a 7 Hz window: {floor - ref:.1f} dBc")
