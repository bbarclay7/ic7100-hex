"""Analysis of the no-preamble (np_) series. usage: np_analyze.py TAG   (TAG = h100, h100A/h100B, npA/npB ...)
Two-tone: IMD3/IM5 in dBc from the active part of each recording. Speech: in-band average (total power above the noise, over 8 s) and,
if TAGA and TAGB are given, the adjacent-band ratio B-A.  usage: np_analyze.py twotone TAG | speech TAG | adj TAGA TAGB"""
import sys, wave, struct, math
import numpy as np
db = lambda v: 10 * math.log10(max(v, 1e-30))
def load(p):
    w = wave.open(p); n = w.getnframes(); return np.array(struct.unpack("<%dh" % n, w.readframes(n)), float) / 32768, w.getframerate()
def blocks(x, fs): b = int(.1 * fs); return b, np.array([np.mean(x[i:i + b] ** 2) for i in range(0, len(x) - b, b)])
def excess(x, fs):                                   # total power above the noise (first 2 s), averaged over the 8 s test, plus tail-noise error
    b, p = blocks(x, fs); noise = p[:20].mean(); return (p[20:] - noise).clip(0).sum() * .1 / 8, (p[-20:].mean() - noise) * 2 / 8
mode = sys.argv[1]
if mode == "twotone":
    for lvl in ("37p4", "31p4", "25p4", "19p4", "13p4", "10p4", "7p4", "4p4"):
        x, fs = load(f"{sys.argv[2]}_np_twotone_{lvl}.wav"); b, p = blocks(x, fs); act = np.where(p > np.median(p[:20]) * 4)[0]
        if len(act) < 10: print(lvl, "no signal"); continue
        s = x[act[0] * b + fs // 2: act[-1] * b]; S = np.abs(np.fft.rfft(s * np.hanning(len(s)))) ** 2; f = np.fft.rfftfreq(len(s), 1 / fs)
        pk = lambda c, d=8: S[(f > c - d) & (f < c + d)].sum(); ref = (pk(900) + pk(1400)) / 2
        print(f"{lvl:5} tone {db(ref):5.1f} dB  IM3 400 {db(pk(400) / ref):6.1f}  IM3 1900 {db(pk(1900) / ref):6.1f}  IM5 2400 {db(pk(2400) / ref):6.1f} dBc")
elif mode == "speech":
    for lvl in ("_m25", "_m11", ""):
        for v in ("plain", "cessb12", "cessb18"):
            x, fs = load(f"{sys.argv[2]}_np_speech_{v}{lvl}.wav"); e, _ = excess(x, fs); pkv = np.abs(x[2 * fs:]).max()
            print(f"{lvl or '_hot':5} {v:8} in-band avg {db(e):6.1f} dB  received peak {20 * math.log10(pkv):6.1f} dBFS  crest {20 * math.log10(pkv) - db(e) / 1:6.1f}")
else:                                                # adj TAGA TAGB
    for lvl in ("_m25", "_m11", ""):
        for v in ("plain", "cessb12", "cessb18"):
            a, _ = excess(*load(f"{sys.argv[2]}_np_speech_{v}{lvl}.wav")); b, t = excess(*load(f"{sys.argv[3]}_np_speech_{v}{lvl}.wav"))
            print(f"{lvl or '_hot':5} {v:8} A {db(a):6.1f}  B {db(b):6.1f}  B-A {db(b) - db(a):6.1f} dB   ({db(abs(b)) - db(abs(t)):.1f} dB over tail error)")
