# Key the radio, play a WAV into its codec, unkey. Panel must be paused. usage: play_tx.py FILE.wav MAX_POWER_PCT
import sys, time, subprocess
from ic7100ctl.civ import CIVTransport
from ic7100ctl.radio import IC7100
wav, maxpct = sys.argv[1], int(sys.argv[2])
t = CIVTransport("/dev/ic7100"); assert t.connect(); r = IC7100(t)
pw = r.get_rf_power(); mode = r.get_mode(); f = r.get_freq()
print(f"radio: {f} MHz {mode} power {pw}%", flush=True)
if mode not in ("LSB", "USB") or pw is None or pw > maxpct or abs(f - 3.758) > 0.0005:
    t.disconnect(); sys.exit(f"refusing: need LSB 3.758 MHz and power <= {maxpct}%")
alc = po = 0
try:
    r.set_ptt(True); time.sleep(0.5)
    p = subprocess.Popen(["aplay", "-q", "-D", "plughw:CARD=CODEC,DEV=0", wav])
    while p.poll() is None:
        po = max(po, r.get_po() or 0); alc = max(alc, r.get_alc() or 0); time.sleep(0.2)
    time.sleep(0.3)
finally:
    r.set_ptt(False); time.sleep(0.3)
    print(f"done: ALC peak {alc}, Po peak {po} (sparse samples), keyed now: {r.get_ptt()}, DATA: {r.get_data_mode()}", flush=True)
    t.disconnect()
