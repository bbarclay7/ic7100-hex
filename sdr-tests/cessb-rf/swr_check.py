# usage: swr_check.py FILE.wav MAX_PCT  -- like play_tx.py but also samples SWR
import sys, time, subprocess
from ic7100ctl.civ import CIVTransport
from ic7100ctl.radio import IC7100
wav, maxpct = sys.argv[1], int(sys.argv[2])
t = CIVTransport("/dev/ic7100"); assert t.connect(); r = IC7100(t)
pw, mode, f = r.get_rf_power(), r.get_mode(), r.get_freq()
print(f"radio: {f} MHz {mode} power {pw}%", flush=True)
if mode not in ("LSB","USB") or pw is None or pw > maxpct or abs(f-3.758) > 0.0005:
    t.disconnect(); sys.exit("refusing")
po = alc = swr = 0; s = []
try:
    r.set_ptt(True); time.sleep(0.5)
    p = subprocess.Popen(["aplay","-q","-D","plughw:CARD=CODEC,DEV=0",wav])
    while p.poll() is None:
        po = max(po, r.get_po() or 0); alc = max(alc, r.get_alc() or 0)
        v = r.get_swr(); s.append(v)
        time.sleep(0.1)
finally:
    r.set_ptt(False); time.sleep(0.3)
    print(f"Po {po} ALC {alc} SWR samples {s}; keyed now {r.get_ptt()}", flush=True); t.disconnect()
