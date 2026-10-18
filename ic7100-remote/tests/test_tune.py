"""Remote tune: settle logic, the unkey-and-restore guarantee, and refusals. No radio needed."""
import unittest

from ic7100ctl import tune as T


class FakeRadio:
    def __init__(self, swr_seq, freq=7.074, mode='USB', data=True, power=80, fail_key=False):
        self.transmitting = False
        self.freq, self.mode, self.data, self.power = freq, mode, data, power
        self.swr_seq = list(swr_seq)
        self.fail_key = fail_key
        self.log = []

    def get_freq(self): return self.freq
    def get_mode(self): return self.mode
    def get_data_mode(self): return self.data
    def get_rf_power(self): return self.power
    def set_frequency(self, mhz): self.freq = mhz; self.log.append(('freq', mhz)); return True
    def set_mode(self, m): self.mode = m; self.log.append(('mode', m)); return True
    def set_data_mode(self, on): self.data = on; self.log.append(('data', on)); return True
    def set_rf_power(self, p): self.power = p; self.log.append(('power', p)); return True
    def set_ptt(self, on):
        self.log.append(('ptt', on))
        if on and self.fail_key:
            return False
        self.transmitting = on
        return True
    def get_swr(self):
        return self.swr_seq.pop(0) if self.swr_seq else self.swr_seq_default

    swr_seq_default = 200


def run(r, **kw):
    clock = [0.0]
    def now(): return clock[0]
    def sleep(s): clock[0] += s
    return T.tune(r, sleep=sleep, now=now, **kw)


class TuneTests(unittest.TestCase):
    def test_settles_when_swr_good_three_times(self):
        r = FakeRadio([200, 150, 100, 40, 30, 20, 10])
        res = run(r)
        self.assertTrue(res.settled)
        self.assertEqual(res.reason, 'settled')
        self.assertLessEqual(res.final_ratio, 1.5)
        self.assertEqual(len(res.samples), 6)           # stops on the third good reading
        self.assertFalse(r.transmitting)

    def test_a_bad_reading_resets_the_count(self):
        r = FakeRadio([40, 40, 150, 40, 40, 40])
        res = run(r)
        self.assertTrue(res.settled)
        self.assertEqual(len(res.samples), 6)

    def test_times_out_and_still_restores(self):
        r = FakeRadio([], freq=7.074, mode='USB', data=True, power=80)   # SWR stays high
        res = run(r, limit=2.0)
        self.assertFalse(res.settled)
        self.assertEqual(res.reason, 'timeout')
        self.assertFalse(r.transmitting)
        self.assertEqual((r.mode, r.data, r.power), ('USB', True, 80))

    def test_tune_power_and_mode_are_set_before_keying_and_unkey_comes_first(self):
        r = FakeRadio([10, 10, 10])
        run(r, power=15)
        i_key = r.log.index(('ptt', True))
        self.assertIn(('power', 15), r.log[:i_key])
        self.assertIn(('mode', 'FM'), r.log[:i_key])
        self.assertIn(('data', True), r.log[:i_key])
        i_off = r.log.index(('ptt', False))
        self.assertGreater(i_off, i_key)
        self.assertIn(('power', 80), r.log[i_off:])     # power restored only after unkeying

    def test_no_response_aborts_and_unkeys(self):
        r = FakeRadio([])
        r.get_swr = lambda: None
        res = run(r)
        self.assertEqual(res.reason, 'no-response')
        self.assertFalse(r.transmitting)

    def test_exception_in_the_callback_still_unkeys_and_restores(self):
        r = FakeRadio([100, 100])
        def boom(*a): raise RuntimeError('display closed')
        with self.assertRaises(RuntimeError):
            run(r, on_sample=boom)
        self.assertFalse(r.transmitting)
        self.assertEqual((r.mode, r.data, r.power), ('USB', True, 80))

    def test_refuses_when_already_transmitting(self):
        r = FakeRadio([10]); r.transmitting = True
        with self.assertRaises(T.TuneError):
            run(r)
        self.assertNotIn(('ptt', True), r.log)

    def test_refuses_vhf(self):
        r = FakeRadio([10], freq=145.0)
        with self.assertRaises(T.TuneError):
            run(r)
        self.assertNotIn(('ptt', True), r.log)

    def test_key_failure_raises_and_restores(self):
        r = FakeRadio([10], fail_key=True)
        with self.assertRaises(T.TuneError):
            run(r)
        self.assertEqual((r.mode, r.data, r.power), ('USB', True, 80))

    def test_band_target_ends_on_ft8_usb_data_at_that_bands_power(self):
        r = FakeRadio([10, 10, 10], freq=14.2, mode='LSB', data=False, power=50)
        res = run(r, mhz=T.parse_target('40m'), end='ft8')
        self.assertTrue(res.settled)
        self.assertEqual((r.freq, r.mode, r.data), (7.074, 'USB', True))

    def test_restore_returns_to_the_original_frequency_and_mode(self):
        r = FakeRadio([10, 10, 10], freq=14.2, mode='LSB', data=False, power=50)
        run(r, mhz=7.074)
        self.assertEqual((r.freq, r.mode, r.data), (14.2, 'LSB', False))

    def test_parse_target_and_swr_scale(self):
        self.assertEqual(T.parse_target('20M'), 14.074)
        self.assertEqual(T.parse_target('7.1'), 7.1)
        with self.assertRaises(T.TuneError):
            T.parse_target('banana')
        self.assertEqual(T.swr_ratio(0), 1.0)
        self.assertEqual(T.swr_ratio(48), 1.5)
        self.assertAlmostEqual(T.swr_ratio(64), 1.75)


if __name__ == '__main__':
    unittest.main()
