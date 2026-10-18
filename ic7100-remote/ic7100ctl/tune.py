"""Remote tune: put out a steady carrier at reduced power while an automatic ATU settles.

For a tuner that senses RF and tunes itself (e.g. an ATU-100): save the radio's state, go to FM with
DATA on (the radio then takes audio only from the USB codec, which stays silent, so the carrier is
pure), set a low RF power, key, watch the SWR meter until it has been good for a few readings in a row
(or a time limit passes), unkey, and put everything back. The unkey and the restore always run,
whatever happens in between.

Used by the `radio-tune` command and the panel's REMOTE TUNE button.
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Tuple

# FT8 dial frequencies (USB) in MHz, by band.
BANDS = {
    '160m': 1.840, '80m': 3.573, '60m': 5.357, '40m': 7.074, '30m': 10.136, '20m': 14.074,
    '17m': 18.100, '15m': 21.074, '12m': 24.915, '10m': 28.074, '6m': 50.313,
}
MAX_TUNE_MHZ = 54.0          # HF and 6 m only: the external tuner does not cover VHF/UHF

# SWR meter raw (0-255) to VSWR ratio: the IC-7100's meter breakpoints, as used by the panel.
SWR_CAL = [(0, 1.0), (48, 1.5), (80, 2.0), (120, 3.0), (240, 6.0)]


class TuneError(Exception):
    pass


def swr_ratio(raw: int) -> float:
    if raw <= SWR_CAL[0][0]:
        return SWR_CAL[0][1]
    for (r0, v0), (r1, v1) in zip(SWR_CAL, SWR_CAL[1:]):
        if raw <= r1:
            return v0 + (v1 - v0) * (raw - r0) / (r1 - r0)
    return SWR_CAL[-1][1]


def trace(samples) -> str:
    """One character per reading: a high mark for a bad match, `_` for a good one."""
    levels = ' _.,:-=+*#'
    return ''.join(levels[int(round((len(levels) - 1) * min(1.0, (ratio - 1.0) / 5.0)))]
                   for _, _, ratio in samples)


def parse_target(text: str) -> float:
    """'40m' -> its FT8 dial frequency; a plain number is MHz."""
    t = text.strip().lower()
    if t in BANDS:
        return BANDS[t]
    try:
        return float(t)
    except ValueError:
        raise TuneError(f'unknown band or frequency {text!r} (bands: {", ".join(BANDS)})')


@dataclass
class TuneResult:
    settled: bool = False
    reason: str = ''                 # settled | timeout | no-response
    final_ratio: Optional[float] = None
    seconds: float = 0.0
    samples: List[Tuple[float, int, float]] = field(default_factory=list)   # (t, raw, ratio)


def tune(r, mhz: Optional[float] = None, power: int = 15, limit: float = 10.0,
         target: float = 1.5, hold: int = 3, end: str = 'restore',
         on_sample: Optional[Callable[[float, int, float], None]] = None,
         abort: Optional[threading.Event] = None,
         sleep: Callable[[float], None] = time.sleep,
         now: Callable[[], float] = time.monotonic) -> TuneResult:
    """Run one tune on radio `r`. end='restore' puts back the original frequency/mode/DATA/power;
    end='ft8' leaves it on the target frequency in USB with DATA on (ready for FT8), at the power
    that band had before. Raises TuneError before keying if it cannot start."""
    if r.transmitting:
        raise TuneError('the radio is already transmitting')
    orig = (r.get_freq(), r.get_mode(), r.get_data_mode())
    if None in orig:
        raise TuneError('the radio is not answering')
    if mhz is not None and not r.set_frequency(mhz):
        raise TuneError('could not set the frequency')
    freq = r.get_freq()
    if freq is None or not 0.1 <= freq <= MAX_TUNE_MHZ:
        raise TuneError(f'{freq} MHz is not an HF/6 m frequency; the tuner does not cover it')
    band_power = r.get_rf_power()          # power is per band: read it on the band we tune on
    if band_power is None:
        raise TuneError('the radio is not answering')

    res = TuneResult()
    t0 = now()
    r.tuning = True                       # keeps browser mic audio and the PTT button out of it
    good = misses = 0
    keyed = False
    try:
        if not (r.set_mode('FM') and r.set_data_mode(True) and r.set_rf_power(power)):
            raise TuneError('could not set FM-D and the tune power')
        if not r.set_ptt(True):
            raise TuneError('the radio did not key')
        keyed = True
        r._ptt_deadline = time.monotonic() + limit + 3    # the server watchdog unkeys if this thread dies
        res.reason = 'timeout'
        while now() - t0 < limit:
            if abort is not None and abort.is_set():
                res.reason = 'cancelled'
                break
            raw = r.get_swr()
            t = now() - t0
            if raw is None:
                misses += 1
                if misses >= 3:
                    res.reason = 'no-response'
                    break
                sleep(0.1)
                continue
            misses = 0
            ratio = swr_ratio(raw)
            res.samples.append((t, raw, ratio))
            res.final_ratio = ratio
            if on_sample:
                on_sample(t, raw, ratio)
            good = good + 1 if ratio <= target else 0
            if good >= hold:
                res.settled, res.reason = True, 'settled'
                break
            sleep(0.12)
    finally:
        # Unkey first, always; then put the settings back. Never raise from here: a failed
        # restore must not hide the original error, and the unkey must be attempted.
        for _ in range(3):
            try:
                if r.set_ptt(False):
                    keyed = False
                    break
            except Exception:
                pass
        if end == 'ft8':
            steps = [lambda: r.set_rf_power(band_power),
                     lambda: r.set_mode('USB'), lambda: r.set_data_mode(True)]
        else:                              # power while still on the tuned band, then move back
            steps = [lambda: r.set_rf_power(band_power)]
            if mhz is not None:
                steps.append(lambda: r.set_frequency(orig[0]))
            steps += [lambda: r.set_mode(orig[1]), lambda: r.set_data_mode(orig[2])]
        for step in steps:
            try:
                step()
            except Exception:
                pass
        r._ptt_deadline = None
        r.tuning = False
        res.seconds = now() - t0
    if keyed:
        raise TuneError('WARNING: could not confirm the radio unkeyed; check it now')
    return res
