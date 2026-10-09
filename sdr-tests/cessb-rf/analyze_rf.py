"""Compare what was sent (reference WAV) with what the FT-710 demodulated (recording).
usage: analyze_rf.py REFERENCE.wav RECORDING.wav"""
import sys, wave, struct, math
import numpy as np
from scipy import signal

def load(p):
    w = wave.open(p); n = w.getnframes(); fs = w.getframerate()
    return np.array(struct.unpack("<%dh" % n, w.readframes(n)), dtype=float) / 32768, fs
db = lambda v: 20 * math.log10(v + 1e-15)
def blocks(x, fs, ms=20):
    b = int(fs * ms / 1000); return np.array([np.sqrt((x[i:i+b] ** 2).mean()) for i in range(0, len(x) - b, b)]), b
def active(x, fs):
    r, b = blocks(x, fs); floor = np.percentile(r, 10); idx = np.where(r > max(floor * 4, 1e-5))[0]   # quietest 10% = noise floor
    return floor, idx[0] * b, (idx[-1] + 1) * b
def bandlimit(x, fs, lo=300, hi=2800):
    sos = signal.butter(4, [lo, hi], btype="band", fs=fs, output="sos"); return signal.sosfiltfilt(sos, x)
def env1k(x, fs):
    e = np.abs(signal.hilbert(bandlimit(x, fs))); k = fs // 1000; return e[: len(e) // k * k].reshape(-1, k).mean(1)

ref, fs = load(sys.argv[1]); rec, fs2 = load(sys.argv[2]); assert fs == fs2
PRE = 1.7                                   # seconds of preamble in every test file (silence, chirp, pilot)
nf_rec = np.percentile(blocks(rec, fs)[0], 10)
# 1. lock on the chirp (matched filter): sample-accurate delay between the file and the recording
T = 0.3; tt = np.arange(int(fs * T)) / fs; chirp = 0.4 * np.sin(2 * np.pi * (300 * tt + (2500 - 300) * tt ** 2 / (2 * T)))
xc = signal.correlate(bandlimit(rec, fs), chirp, mode="valid", method="fft"); t_rec = int(np.argmax(np.abs(xc)))
delay = t_rec - int(0.5 * fs)               # recording sample at which the file's sample 0 arrives
# 2. pilot tone: frequency offset between the two radios
p0 = delay + int(1.0 * fs); pil = rec[p0 + int(0.1 * fs): p0 + int(0.4 * fs)]
spec = np.abs(np.fft.rfft(pil * np.hanning(len(pil)), 1 << 18)); fpil = np.argmax(spec) * fs / (1 << 18); offs = fpil - 1000.0
# 3. the test signal in the file and in the recording (same length)
L = len(ref) - int(PRE * fs) - int(0.5 * fs)
seg_ref = ref[int(PRE * fs): int(PRE * fs) + L]; seg_rec = rec[delay + int(PRE * fs): delay + int(PRE * fs) + L]
if abs(offs) > 0.2:                          # remove the offset so the comparison is not smeared
    an = signal.hilbert(seg_rec); seg_rec = np.real(an * np.exp(-2j * np.pi * offs * np.arange(len(an)) / fs))
drift_ppm = 0.0
c_seg = seg_rec; r_seg = seg_ref; ca = cb = 0
nf_ref = 0.0; d = 0; lag = delay
# crest and level
def crest(x): return db(np.abs(x).max()) - db(np.sqrt((x ** 2).mean()))
over_noise = db(np.sqrt((c_seg ** 2).mean())) - db(nf_rec)
print(f"sent      : {len(r_seg)/fs:.1f} s | peak {db(np.abs(r_seg).max()):.1f} dBFS | crest {crest(r_seg):.1f} dB (as sent), {crest(bandlimit(r_seg, fs, 300, 2700)):.1f} dB after the radio's ~300-2700 Hz passband")
print(f"recorded  : active {len(c_seg)/fs:.1f} s | peak {db(np.abs(c_seg).max()):.1f} dBFS | crest {crest(c_seg):.1f} dB | {over_noise:.1f} dB over its noise floor ({db(nf_rec):.1f} dBFS)")
print(f"alignment : delay {delay/fs*1000:.1f} ms (chirp lock) | pilot {fpil:.2f} Hz -> radio-to-radio offset {offs:+.2f} Hz (removed)")
# spectrum: share of energy in bands, recorded vs sent
f1, P1 = signal.welch(seg_ref, fs, nperseg=4096); f2, P2 = signal.welch(seg_rec, fs, nperseg=4096)
bands = [(0, 300), (300, 2800), (2800, 3500), (3500, 5000)]
print("band energy relative to 300-2800 Hz (dB):   sent    recorded   change")
base1 = P1[(f1 >= 300) & (f1 < 2800)].sum(); base2 = P2[(f2 >= 300) & (f2 < 2800)].sum()
for lo, hi in bands[:1] + bands[2:]:
    s1 = 10 * math.log10(P1[(f1 >= lo) & (f1 < hi)].sum() / base1 + 1e-15); s2 = 10 * math.log10(P2[(f2 >= lo) & (f2 < hi)].sum() / base2 + 1e-15)
    print(f"   {lo:>4}-{hi:<4} Hz                           {s1:6.1f}   {s2:6.1f}   {s2 - s1:+5.1f}")
_f, _Pn = signal.welch(rec[: int(0.4 * fs)], fs, nperseg=4096)            # recording's own noise (silence before the signal)
_snr = 10 * math.log10(P2[(f2 >= 300) & (f2 < 2700)].sum() / max(_Pn[(_f >= 300) & (_f < 2700)].sum(), 1e-30))
print(f"noise     : in-band signal-to-noise {_snr:.1f} dB")
# how faithfully was the waveform reproduced? Each 0.2 s block is aligned on its own (the two sound devices have separate
# clocks), then compared by normalised correlation. rho^2 = share of the received waveform explained by the sent one.
A_, B_ = bandlimit(seg_ref, fs, 300, 2700), bandlimit(seg_rec, fs, 300, 2700); n_ = int(0.2 * fs); w_ = int(0.006 * fs)
num = den_a = 0.0; rhos = []; wts = []
for s_ in range(w_, len(A_) - n_ - w_, n_):
    a_ = A_[s_:s_ + n_]; ea = float(np.dot(a_, a_))
    if ea < 1e-4: continue
    win = B_[s_ - w_: s_ + n_ + w_]; xc_ = signal.correlate(win, a_, mode="valid", method="fft")
    cs = np.concatenate([[0], np.cumsum(win ** 2)]); eb = cs[n_:n_ + 2 * w_ + 1] - cs[:2 * w_ + 1]
    rho = np.max(np.abs(xc_) / np.sqrt(ea * np.maximum(eb, 1e-30))); rhos.append(rho ** 2); wts.append(ea)
g2 = float(np.average(rhos, weights=wts)); sdr = 10 * math.log10(g2 / max(1 - g2, 1e-9))
print(f"waveform  : rho^2 {g2:.3f} (1.000 = perfect copy) -> signal-to-error {sdr:.1f} dB, vs {_snr:.1f} dB the receiver's noise alone allows")
