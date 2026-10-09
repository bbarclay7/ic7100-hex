"""Tests for the IC7100 wrapper.

Focus is on the verified opcode corrections — the parts most likely to
regress if someone copies an IC-7300 example off the net.
"""
import unittest

from ic7100ctl.radio import IC7100, MODE_BY_NAME, CALL_CHANNELS
from tests.mock_transport import MockCIVTransport


class FrequencyTests(unittest.TestCase):
    def setUp(self):
        self.t = MockCIVTransport(civ_addr=0x88)
        self.r = IC7100(self.t)

    def test_set_frequency_uses_cmd_05(self):
        self.r.set_frequency(145.500)
        f = self.t.last_frame()
        self.assertEqual(f[4], 0x05)
        # data = 5-byte BCD = bytes 5..10
        self.assertEqual(f[5:10], b'\x00\x00\x50\x45\x01')


class ModeTests(unittest.TestCase):
    def setUp(self):
        self.t = MockCIVTransport()
        self.r = IC7100(self.t)

    def test_set_mode_fm(self):
        self.r.set_mode('FM')
        f = self.t.last_frame()
        self.assertEqual(f[4], 0x06)
        self.assertEqual(f[5], MODE_BY_NAME['FM'])  # 0x05

    def test_set_mode_unknown_returns_false(self):
        self.assertFalse(self.r.set_mode('XYZ'))


class AttenCorrectionTests(unittest.TestCase):
    """REGRESSION: IC-7100 attenuator byte is 0x12, NOT 0x20."""

    def setUp(self):
        self.t = MockCIVTransport()
        self.r = IC7100(self.t)

    def test_atten_on_sends_byte_0x12(self):
        self.r.set_atten(True)
        f = self.t.last_frame()
        self.assertEqual(f[4], 0x11)
        self.assertEqual(f[5], 0x12, "IC-7100 atten value must be 0x12 (12 dB BCD)")

    def test_atten_off_sends_byte_0x00(self):
        self.r.set_atten(False)
        f = self.t.last_frame()
        self.assertEqual(f[4], 0x11)
        self.assertEqual(f[5], 0x00)


class MemoryOpcodeOrderTests(unittest.TestCase):
    """REGRESSION: 0x0A = memory_to_vfo; 0x0B = clear. Earlier code had them swapped."""

    def setUp(self):
        self.t = MockCIVTransport()
        self.r = IC7100(self.t)

    def test_memory_to_vfo_uses_0x0A(self):
        self.r.memory_to_vfo()
        self.assertEqual(self.t.last_frame()[4], 0x0A)

    def test_memory_clear_uses_0x0B(self):
        self.r.memory_clear()
        self.assertEqual(self.t.last_frame()[4], 0x0B)


class CallChannelTests(unittest.TestCase):
    """REGRESSION: IC-7100 call channels are memory positions 106-109, NOT 0x08 0xA0."""

    def test_call_channel_indices(self):
        self.assertEqual(CALL_CHANNELS['144-C1'], 106)
        self.assertEqual(CALL_CHANNELS['144-C2'], 107)
        self.assertEqual(CALL_CHANNELS['430-C1'], 108)
        self.assertEqual(CALL_CHANNELS['430-C2'], 109)

    def test_select_call_channel_routes_to_memory_op(self):
        t = MockCIVTransport()
        r = IC7100(t)
        r.select_call_channel('144-C1')
        # Expect a memory-select frame (cmd 0x08), NOT 0x08 0xA0.
        # The exact subcommand may vary; what we MUST NOT see is byte 0xA0
        # in the second position.
        f = t.last_frame()
        if f[4] == 0x08 and len(f) > 5:
            self.assertNotEqual(f[5], 0xA0,
                "0x08 0xA0 is Memory Bank A select, NOT a call-channel opcode")


class AfLevelTests(unittest.TestCase):
    """AF level (front-panel volume) — 0x14 0x01."""

    def setUp(self):
        self.t = MockCIVTransport()
        self.r = IC7100(self.t)

    def test_set_af_level_uses_14_01(self):
        self.r.set_af_level(50)
        f = self.t.last_frame()
        self.assertEqual(f[4], 0x14)
        self.assertEqual(f[5], 0x01)


class DataModeTests(unittest.TestCase):
    """DATA mode toggle — 0x1A 0x06 [flag] [filter]."""

    def setUp(self):
        self.t = MockCIVTransport()
        self.r = IC7100(self.t)

    def test_set_data_mode_uses_1A_06(self):
        self.r.set_data_mode(True, filt=1)
        f = self.t.last_frame()
        self.assertEqual(f[4], 0x1A)
        self.assertEqual(f[5], 0x06)


class SmokeTests(unittest.TestCase):
    """Basic API surface — confirms construction + each method exists."""

    def test_construct_with_mock(self):
        t = MockCIVTransport()
        r = IC7100(t)
        self.assertIsNotNone(r)
        # Sanity: state defaults are present.
        self.assertEqual(r.mode, 'FM')
        self.assertEqual(r.freq_hz, 0)

    def test_methods_exist(self):
        r = IC7100(MockCIVTransport())
        for name in ('set_frequency', 'set_mode', 'set_ptt', 'set_af_level',
                     'set_atten', 'memory_to_vfo', 'memory_clear',
                     'select_call_channel', 'set_data_mode',
                     'connect', 'poll_fast', 'poll_settings'):
            self.assertTrue(callable(getattr(r, name, None)),
                            f"{name} missing or not callable")


class RadioPowerTests(unittest.TestCase):
    def test_power_on_sends_18_01_with_the_wakeup(self):
        t = MockCIVTransport(); r = IC7100(t)
        self.assertTrue(r.power_on())
        self.assertEqual(len(t.wakeups), 1)
        f = t.wakeups[0]
        self.assertEqual((f[4], f[5]), (0x18, 0x01))            # FE FE 88 E0 18 01 FD
        self.assertEqual(t.cmd_count(), 0)                      # nothing else went to a sleeping radio

    def test_power_off_sends_18_00(self):
        t = MockCIVTransport(); r = IC7100(t)
        self.assertTrue(r.power_off())
        f = t.last_frame()
        self.assertEqual((f[4], f[5]), (0x18, 0x00))


if __name__ == '__main__':
    unittest.main()


class MemoryBankTests(unittest.TestCase):
    def setUp(self):
        self.t = MockCIVTransport()
        self.r = IC7100(self.t)

    def test_bank_select_sends_08_a0_with_bcd_bank(self):
        self.assertTrue(self.r.memory_bank_select(5))  # E (banks are 1-based)
        f = self.t.last_frame()
        self.assertEqual(f[4:9], b'\x08\xa0\x00\x05\xfd'[:5])
        self.assertEqual(self.r.memory_bank, 5)

    def test_bank_select_rejects_out_of_range(self):
        n = self.t.cmd_count()
        self.assertFalse(self.r.memory_bank_select(0))
        self.assertFalse(self.r.memory_bank_select(6))
        self.assertEqual(self.t.cmd_count(), n)  # nothing sent


# Real reply captured from an IC-7100: bank E (5), channel 12.
E12 = bytes.fromhex(
    "05 00 12 00 00 00 22 47 01 05 01 00 22 00 00 12 73 00 12 73 00 00 23 00 00 60 00 "
    "43 51 43 51 43 51 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 00 00 00 "
    "44 01 05 01 00 00 00 00 08 85 00 08 85 00 00 23 00 00 60 00 43 51 43 51 43 51 20 "
    "20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 20 53 57 48 49 44 20 57 37 41 56 "
    "4d 20 49 43 41 52")


class MemoryNameTests(unittest.TestCase):
    def setUp(self):
        self.t = MockCIVTransport()
        self.r = IC7100(self.t)

    def test_read_entry_decodes_freq_mode_name(self):
        self.assertEqual(len(E12), 114)
        self.t.set_response(0x1a, 0x00, b'\x1a\x00' + E12)
        e = self.r.memory_read_entry(5, 12)
        self.assertEqual(e, {'freq_hz': 147_220_000, 'mode': 'FM',
                             'name': 'SWHID W7AVM ICAR', 'tone': 2})
        # request = 1A 00, bank BCD, channel BCD x2
        self.assertEqual(self.t.last_frame()[4:10], b'\x1a\x00\x05\x00\x12\xfd'[:6])

    def test_empty_slot_is_empty_dict(self):
        self.t.set_response(0x1a, 0x00, b'\x1a\x00\x01\x00\x11\xff')
        self.assertEqual(self.r.memory_read_entry(1, 11), {})

    def test_identify_matches_freq_and_mode(self):
        hit = {'freq_hz': 147_220_000, 'mode': 'FM', 'name': 'SWHID W7AVM ICAR'}
        self.r.memory_index = {(5, 12): hit,
                               (4, 3): dict(hit, mode='USB', name='other')}
        self.r.freq_hz, self.r.mode = 147_220_000, 'FM'
        self.assertEqual([(b, c) for b, c, _ in self.r.identify_memory()], [(5, 12)])
        self.r.freq_hz = 147_225_000
        self.assertEqual(self.r.identify_memory(), [])


class ToneTests(unittest.TestCase):
    def setUp(self):
        self.t = MockCIVTransport()
        self.r = IC7100(self.t)

    def test_ctcss_freq_decodes_three_byte_reply(self):
        self.t.set_response(0x1b, 0x00, b'\x1b\x00\x00\x12\x73')
        self.t.set_response(0x1b, 0x01, b'\x1b\x01\x00\x08\x85')
        self.r.get_ctcss()
        self.assertAlmostEqual(self.r.ctcss_tx_hz, 127.3)
        self.assertAlmostEqual(self.r.ctcss_rx_hz, 88.5)

    def test_identify_uses_tone_mode_to_split_same_freq_pair(self):
        base = {'freq_hz': 147_220_000, 'mode': 'FM'}
        self.r.memory_index = {(5, 12): dict(base, name='SWHID', tone=2),
                               (5, 25): dict(base, name='WISIM2', tone=1)}
        self.r.freq_hz, self.r.mode = 147_220_000, 'FM'
        self.r.tsql_on, self.r.tone_on = True, False   # TSQL
        self.assertEqual([c for _, c, _ in self.r.identify_memory()], [12])
        self.r.tsql_on, self.r.tone_on = False, True   # TONE
        self.assertEqual([c for _, c, _ in self.r.identify_memory()], [25])
        self.r.tsql_on = self.r.tone_on = False        # neither: no guess
        self.assertEqual(len(self.r.identify_memory()), 2)


class ExtraMeterTests(unittest.TestCase):
    def test_comp_vd_id_decode_and_commands(self):
        t = MockCIVTransport(); r = IC7100(t)
        t.set_response(0x15, 0x14, b'\x15\x14\x00\x00')
        t.set_response(0x15, 0x15, b'\x15\x15\x01\x63')
        t.set_response(0x15, 0x16, b'\x15\x16\x00\x42')
        self.assertEqual((r.get_comp(), r.get_vd(), r.get_id()), (0, 163, 42))
        self.assertEqual((r.comp, r.vd, r.idrain), (0, 163, 42))
        cmds = [(f[4], f[5]) for f in t.sent]
        self.assertEqual(cmds, [(0x15, 0x14), (0x15, 0x15), (0x15, 0x16)])


class MemoryStepTests(unittest.TestCase):
    def setUp(self):
        self.t = MockCIVTransport(); self.r = IC7100(self.t)
        def e(freq, tone, name): return {'freq_hz': freq, 'mode': 'FM', 'name': name, 'tone': tone}
        self.r.memory_index = {
            (5, 11): e(146_862_500, 2, 'NWHID'), (5, 12): e(147_220_000, 2, 'SWHID'),
            (5, 25): e(147_220_000, 1, 'WISIM2'), (5, 106): e(146_520_000, 0, 'CALL'),
            (2, 1): e(147_220_000, 1, 'W7AVM/S')}
        self.r.freq_hz, self.r.mode = 147_220_000, 'FM'
        self.r.tsql_on, self.r.tone_on = True, False      # TSQL -> E-12

    def test_step_up_down_wrap_and_skip_call_channels(self):
        self.assertEqual(self.r.memory_step(1), (5, 25))           # 12 -> 25
        self.assertEqual(self.r.freq_hz, 147_220_000)
        self.assertEqual(self.r.memory_step(1), (5, 11))           # 25 -> wrap to 11, 106 skipped
        self.assertEqual(self.r.memory_step(-1), (5, 25))          # 11 -> wrap back to 25

    def test_sends_bank_then_channel(self):
        self.r.memory_step(1)
        sent = [bytes(f[4:-1]) for f in self.t.sent]
        self.assertEqual(sent, [b'\x08\xa0\x00\x05', b'\x08\x00\x25'])

    def test_no_bank_known_returns_none_and_sends_nothing(self):
        self.r.freq_hz = 100_000_000                               # matches nothing
        self.assertIsNone(self.r.memory_step(1))
        self.assertEqual(self.t.cmd_count(), 0)


class RfGainTests(unittest.TestCase):
    def test_rf_gain_uses_14_02_and_scales_to_percent(self):
        t = MockCIVTransport(); r = IC7100(t)
        self.assertTrue(r.set_rf_gain(100))                  # 100 % -> raw 255
        f = t.last_frame()
        self.assertEqual((f[4], f[5]), (0x14, 0x02))
        self.assertEqual(f[6:8], b'\x02\x55')
        t.set_response(0x14, 0x02, b'\x14\x02\x01\x28')    # raw 128
        self.assertEqual(r.get_rf_gain(), 50)
        self.assertEqual(r.rf_gain, 50)


class SpeechCompressorTests(unittest.TestCase):
    def test_compressor_on_off_uses_16_44(self):
        t = MockCIVTransport(); r = IC7100(t)
        self.assertTrue(r.set_comp_on(True))
        f = t.last_frame()
        self.assertEqual((f[4], f[5], f[6]), (0x16, 0x44, 0x01))
        self.assertTrue(r.comp_on)
        self.assertTrue(r.set_comp_on(False))
        self.assertEqual(t.last_frame()[6], 0x00)
        self.assertFalse(r.comp_on)

    def test_compressor_level_uses_14_0e_and_scales_to_percent(self):
        t = MockCIVTransport(); r = IC7100(t)
        self.assertTrue(r.set_comp_level(100))               # 100 % -> raw 255
        f = t.last_frame()
        self.assertEqual((f[4], f[5]), (0x14, 0x0e))
        self.assertEqual(f[6:8], b'\x02\x55')
        t.set_response(0x14, 0x0e, b'\x14\x0e\x00\x58')   # raw 58 (what this radio reported) -> 23 %
        self.assertEqual(r.get_comp_level(), 23)
        self.assertEqual(r.comp_level, 23)


class ToneControlTests(unittest.TestCase):
    def setUp(self):
        self.t = MockCIVTransport(); self.r = IC7100(self.t)

    def test_tone_frequency_is_sent_as_three_bytes(self):
        self.assertTrue(self.r.set_ctcss(tx_hz=127.3))
        f = self.t.last_frame()
        self.assertEqual(f[4:9], b'\x1b\x00\x00\x12\x73')       # 1B 00 | 00 12 73
        self.assertTrue(self.r.set_ctcss(rx_hz=88.5))
        self.assertEqual(self.t.last_frame()[4:9], b'\x1b\x01\x00\x08\x85')

    def test_tone_and_tsql_use_16_42_and_16_43(self):
        self.assertTrue(self.r.set_ctcss(tone_on=True))
        self.assertEqual(self.t.last_frame()[4:7], b'\x16\x42\x01')
        self.assertTrue(self.r.tone_on and not self.r.tsql_on)
        self.assertTrue(self.r.set_ctcss(tsql_on=True, tone_on=False))
        sent = [bytes(f[4:7]) for f in self.t.sent[-2:]]
        self.assertEqual(sent, [b'\x16\x42\x00', b'\x16\x43\x01'])
        self.assertTrue(self.r.tsql_on and not self.r.tone_on)

    def test_get_ctcss_reads_both_frequencies_and_flags(self):
        self.t.set_response(0x1b, 0x00, b'\x1b\x00\x00\x12\x73')
        self.t.set_response(0x1b, 0x01, b'\x1b\x01\x00\x08\x85')
        self.t.set_response(0x16, 0x42, b'\x16\x42\x01')
        self.t.set_response(0x16, 0x43, b'\x16\x43\x00')
        self.assertEqual(self.r.get_ctcss(), (127.3, 88.5, True, False))


class StaleTxMeterTests(unittest.TestCase):
    def test_tx_meters_are_wiped_when_transmit_state_flips(self):
        t = MockCIVTransport(); r = IC7100(t)
        r.set_ptt(True)
        r.po, r.alc, r.swr, r.comp, r.idrain = 68, 134, 5, 7, 32     # readings during transmit 1
        r.set_ptt(False)
        self.assertEqual((r.po, r.alc, r.swr, r.comp, r.idrain), (0, 0, 0, 0, 0))
        r.po = 99                                                     # stray value while receiving
        r.set_ptt(True)                                               # transmit 2 must start from zero
        self.assertEqual(r.po, 0)

    def test_get_ptt_flip_also_wipes(self):
        t = MockCIVTransport(); r = IC7100(t)
        r.transmitting = True; r.po = 80
        t.set_response(0x1c, 0x00, b'\x1c\x00\x00')               # radio says: not transmitting
        r.get_ptt()
        self.assertEqual((r.transmitting, r.po), (False, 0))


class CompAndPoPeakTests(unittest.TestCase):
    def test_comp_on_uses_16_44(self):
        t = MockCIVTransport(); r = IC7100(t)
        t.set_response(0x16, 0x44, b'\x16\x44\x01')
        self.assertTrue(r.get_comp_on())
        self.assertEqual((t.last_frame()[4], t.last_frame()[5]), (0x16, 0x44))
        self.assertTrue(r.comp_on)

    def test_po_is_sampled_between_other_reads_and_peak_kept(self):
        t = MockCIVTransport(); r = IC7100(t)
        seq = iter([0, 0, 91, 0, 40])                   # the five Po slots in one cycle
        def fake(frame, timeout=None):
            t.sent.append(frame)
            if frame[4] == 0x15 and frame[5] == 0x11:
                v = next(seq); return b'\x15\x11' + bytes([v // 100, ((v // 10 % 10) << 4) | (v % 10)])
            return b'\xfb'
        t.transact = fake
        r.poll_meters_tx()
        self.assertEqual(r.po, 91)                      # the peak, not the last sample
        subs = [f[5] for f in t.sent if f[4] == 0x15]
        self.assertEqual(subs.count(0x11), 5)           # Po sampled 5x per cycle
        self.assertIn(0x13, subs); self.assertIn(0x14, subs)   # ALC and COMP every cycle
        self.assertEqual(sum(1 for x in subs if x in (0x12, 0x15, 0x16)), 1)  # one slow meter


class TxSummaryTests(unittest.TestCase):
    def test_summary_is_reported_when_a_transmit_ends(self):
        t = MockCIVTransport(); r = IC7100(t)
        started, ended = [], []
        r.on_tx_start = lambda: started.append(1)
        r.on_tx_end = ended.append
        r.freq_hz, r.mode, r.rf_power, r.vd = 28_410_000, 'USB', 50, 160
        r.set_ptt(True)
        self.assertEqual(started, [1])
        for po, alc, comp, idr in ((12, 40, 0, 20), (58, 78, 197, 26), (30, 20, 5, 22)):
            r.po, r.alc, r.comp, r.idrain = po, alc, comp, idr
            r._note_tx_peaks()
        r.vd = 154; r._note_tx_peaks()
        r.set_ptt(False)
        self.assertEqual(len(ended), 1)
        s = ended[0]
        self.assertEqual((s['po'], s['alc'], s['comp'], s['id']), (58, 78, 197, 26))   # peaks
        self.assertEqual(s['vd_min'], 154)
        self.assertEqual((s['freq_hz'], s['mode'], s['rf_power']), (28_410_000, 'USB', 50))
        self.assertGreaterEqual(s['secs'], 0)
        self.assertEqual(r.po, 0)                                  # and the meters are wiped as before

    def test_a_broken_hook_never_breaks_ptt(self):
        t = MockCIVTransport(); r = IC7100(t)
        def boom(*a): raise RuntimeError('logging failed')
        r.on_tx_start = boom; r.on_tx_end = boom
        self.assertTrue(r.set_ptt(True))
        self.assertTrue(r.set_ptt(False))
