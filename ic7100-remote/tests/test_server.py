"""Smoke test the HTTP server with a mock radio.

Starts a RadioServer on an ephemeral port backed by MockCIVTransport
and exercises each route via urllib. No serial hardware required.
"""
import json
import threading
import time
import unittest
import urllib.request
from urllib.error import HTTPError

from ic7100ctl.radio import IC7100
from ic7100ctl.server import RadioServer
from tests.mock_transport import MockCIVTransport


def _free_port() -> int:
    import socket
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port


class ServerSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.transport = MockCIVTransport(civ_addr=0x88)
        cls.radio = IC7100(cls.transport)
        cls.port = _free_port()
        cls.server = RadioServer(cls.radio, host='127.0.0.1', port=cls.port)
        cls.server.start()
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        # Give the server a tick to bind.
        time.sleep(0.1)
        cls.base = f'http://127.0.0.1:{cls.port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()

    def _get_json(self, path):
        with urllib.request.urlopen(f'{self.base}{path}', timeout=2) as r:
            self.assertEqual(r.status, 200)
            return json.loads(r.read().decode())

    def _post_json(self, path, payload):
        req = urllib.request.Request(
            f'{self.base}{path}',
            data=json.dumps(payload).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST')
        with urllib.request.urlopen(req, timeout=2) as r:
            self.assertEqual(r.status, 200)
            return json.loads(r.read().decode())

    def test_status_endpoint_returns_json(self):
        s = self._get_json('/ic7100/status')
        self.assertIsInstance(s, dict)
        # Expected core fields:
        for k in ('mode', 'freq_hz'):
            self.assertIn(k, s, f"/status missing key {k!r}; got keys={list(s.keys())[:30]}")

    def test_root_serves_html_or_404_gracefully(self):
        try:
            with urllib.request.urlopen(f'{self.base}/', timeout=2) as r:
                self.assertIn(r.status, (200, 404))
                body = r.read()
                self.assertTrue(len(body) > 0)
        except HTTPError as e:
            # Inline fallback page or 404 — either is acceptable.
            self.assertIn(e.code, (404,))

    def test_post_freq(self):
        r = self._post_json('/ic7100cmd', {'cmd': 'freq', 'hz': 145_500_000})
        self.assertIn('ok', r)
        self.assertTrue(r['ok'])
        # Mock should have received an 0x05 frame.
        cmds = [f[4] for f in self.transport.sent]
        self.assertIn(0x05, cmds)

    def test_post_atten(self):
        before = self.transport.cmd_count()
        r = self._post_json('/ic7100cmd', {'cmd': 'atten', 'on': True})
        self.assertTrue(r['ok'])
        # Find an 0x11 frame after `before`.
        atten_frames = [f for f in self.transport.sent[before:] if f[4] == 0x11]
        self.assertGreaterEqual(len(atten_frames), 1)
        # Critical: byte 5 must be 0x12 (the IC-7100 correction).
        self.assertEqual(atten_frames[0][5], 0x12,
                         "Atten on must send 0x11 0x12, not 0x11 0x20")

    def test_post_memory_bank(self):
        before = self.transport.cmd_count()
        r = self._post_json('/ic7100cmd', {'cmd': 'memory_bank', 'bank': 'e'})
        self.assertTrue(r['ok'])
        f = [f for f in self.transport.sent[before:] if f[4] == 0x08][0]
        self.assertEqual(f[5:8], b'\xa0\x00\x05')
        self.assertEqual(self._get_json('/ic7100/status')['memory_bank'], 'E')

    def test_memory_list_and_pick(self):
        self.radio.memory_index = {(5, 12): {'freq_hz': 147_220_000, 'mode': 'FM', 'name': 'SWHID'},
                                   (5, 106): {'freq_hz': 146_520_000, 'mode': 'FM', 'name': 'CALL'},
                                   (2, 1): {'freq_hz': 3_758_000, 'mode': 'LSB', 'name': 'NET'}}
        r = self._post_json('/ic7100cmd', {'cmd': 'memory_list'})
        self.assertEqual([(c['bank'], c['ch'], c['name']) for c in r['channels']],
                         [('B', 1, 'NET'), ('E', 12, 'SWHID')])      # 106 (call/scan edge) left out
        before = self.transport.cmd_count()
        r = self._post_json('/ic7100cmd', {'cmd': 'memory_pick', 'bank': 'e', 'ch': 12})
        self.assertTrue(r['ok'])
        f = [f for f in self.transport.sent[before:] if f[4] == 0x08]
        self.assertEqual(f[0][5:8], b'\xa0\x00\x05')             # bank E first
        self.assertEqual(f[1][5:7], b'\x00\x12')                  # then channel 12
        self.assertFalse(self._post_json('/ic7100cmd', {'cmd': 'memory_pick', 'bank': 'F', 'ch': 1})['ok'])

    def test_post_memory_bank_rejects_bad_bank(self):
        r = self._post_json('/ic7100cmd', {'cmd': 'memory_bank', 'bank': 'F'})
        self.assertFalse(r['ok'])

    def test_late_keepalive_does_not_rekey(self):
        def key_frames():
            return [f for f in self.transport.sent
                    if f[4] == 0x1c and f[5] == 0x00 and f[6] == 0x01]
        self.assertFalse(self.radio.transmitting)
        n = len(key_frames())
        r = self._post_json('/ic7100cmd', {'cmd': 'ptt', 'state': True, 'hold': True, 'keepalive': True})
        self.assertTrue(r['ok'])
        self.assertFalse(self.radio.transmitting)
        self.assertEqual(len(key_frames()), n)   # nothing was sent to key the radio

    def test_ptt_hold_unkeys_when_keepalives_stop(self):
        def ptt_frames():
            # key/unkey frames carry a data byte; the poller's reads (1c 00 FD) don't
            return [f for f in self.transport.sent
                    if f[4] == 0x1c and f[5] == 0x00 and f[6] in (0x00, 0x01)]
        n = len(ptt_frames())
        self._post_json('/ic7100cmd', {'cmd': 'ptt', 'state': True, 'hold': True})
        self._post_json('/ic7100cmd', {'cmd': 'ptt', 'state': True, 'hold': True})
        self.assertTrue(self.radio.transmitting)
        self.assertEqual(len(ptt_frames()) - n, 1)  # keepalive does not re-key
        time.sleep(2.2)  # PTT_HOLD_TIMEOUT 1.5 s + watchdog tick
        self.assertFalse(self.radio.transmitting)
        self.assertEqual(len(ptt_frames()) - n, 2)  # key + auto-unkey

    def test_tx_meters_read_zero_when_not_transmitting(self):
        self.radio.po, self.radio.swr, self.radio.alc = 227, 40, 30
        self.assertFalse(self.radio.transmitting)
        st = self._get_json('/ic7100/status')
        self.assertEqual((st['po'], st['swr'], st['alc']), (0, 0, 0))

    def test_post_rf_gain_and_status(self):
        r = self._post_json('/ic7100cmd', {'cmd': 'rf_gain', 'pct': 40})
        self.assertTrue(r['ok'])
        self.assertEqual(self._get_json('/ic7100/status')['rf_gain'], 40)

    def test_squelch_type_drives_tsql_not_tone(self):
        self.radio.tone_on = True            # TONE stays as it was
        self._post_json('/ic7100cmd', {'cmd': 'squelch_type', 'type': 'tsql'})
        st = self._get_json('/ic7100/status')
        self.assertTrue(st['tsql_on'])
        self.assertTrue(st['tone_on'])
        self.assertEqual(st['squelch_type'], 'tsql')
        self._post_json('/ic7100cmd', {'cmd': 'squelch_type', 'type': 'noise'})
        st = self._get_json('/ic7100/status')
        self.assertFalse(st['tsql_on'])
        self.assertTrue(st['tone_on'])

    def test_ctcss_command_sets_tone_on(self):
        before = self.transport.cmd_count()
        r = self._post_json('/ic7100cmd', {'cmd': 'ctcss', 'tx_hz': 100.0, 'tone_on': True})
        self.assertTrue(r['ok'])
        sent = [bytes(f[4:9]) for f in self.transport.sent[before:] if f[4] in (0x1b, 0x16)]
        self.assertIn(b'\x1b\x00\x00\x10\x00', sent)

    def test_status_says_whether_the_radio_is_answering(self):
        self.assertTrue(self._get_json('/ic7100/status')['radio_responding'])
        self.transport.consecutive_timeouts = 9          # radio switched off
        try:
            self.server._refresh_state()
            self.assertFalse(self._get_json('/ic7100/status')['radio_responding'])
        finally:
            del self.transport.consecutive_timeouts
            self.server._refresh_state()

    def test_mic_info_and_tx_line_report_mic_and_peak(self):
        import io, contextlib
        from ic7100ctl import webrtc
        r = self._post_json('/ic7100cmd', {'cmd': 'mic_info', 'label': "EarPods\x00 mic"})
        self.assertTrue(r['ok'])
        s = dict(secs=1.0, freq_hz=14_005_000, mode='USB', data_mode=True, rf_power=1,
                 po=0, alc=14, comp=0, id=31, swr=0, vd_min=157)
        out = io.StringIO()
        self.server._tx_started()
        webrtc._TX_STATE['peak'] = 16384        # half scale = -6 dBFS
        with contextlib.redirect_stdout(out):
            self.server._tx_ended(s)
        line = out.getvalue()
        self.assertIn("mic 'EarPods mic' peak -6 dBFS", line)
        self.server._tx_started()               # nothing forwarded this time
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            self.server._tx_ended(s)
        self.assertIn('SILENT', out.getvalue())
        self.assertIn('WARNING: no mic audio reached the radio', out.getvalue())

    def test_compressor_commands_and_status(self):
        before = self.transport.cmd_count()
        self.assertTrue(self._post_json('/ic7100cmd', {'cmd': 'comp_on', 'on': True})['ok'])
        self.assertTrue(self._post_json('/ic7100cmd', {'cmd': 'comp_level', 'pct': 60})['ok'])
        sent = [bytes(f[4:7]) for f in self.transport.sent[before:] if f[4] in (0x14, 0x16)]
        self.assertIn(b'\x16\x44\x01', sent)
        self.assertTrue(any(x[:2] == b'\x14\x0e' for x in sent))
        st = self._get_json('/ic7100/status')
        self.assertTrue(st['comp_on'])
        self.assertEqual(st['comp_level'], 60)
        self._post_json('/ic7100cmd', {'cmd': 'comp_on', 'on': False})


    def test_radio_power_command(self):
        before = len(getattr(self.transport, 'wakeups', []))
        self.assertTrue(self._post_json('/ic7100cmd', {'cmd': 'radio_power', 'on': True})['ok'])
        self.assertEqual(len(self.transport.wakeups), before + 1)
        n = self.transport.cmd_count()
        self.assertTrue(self._post_json('/ic7100cmd', {'cmd': 'radio_power', 'on': False})['ok'])
        f = self.transport.sent[n:][0]
        self.assertEqual((f[4], f[5]), (0x18, 0x00))

    def test_post_mode(self):
        r = self._post_json('/ic7100cmd', {'cmd': 'mode', 'mode': 'FM'})
        self.assertTrue(r['ok'])

    def test_post_af_level(self):
        r = self._post_json('/ic7100cmd', {'cmd': 'af_level', 'level': 50})
        self.assertTrue(r['ok'])
        # Find a 0x14 0x01 frame.
        af_frames = [f for f in self.transport.sent
                     if f[4] == 0x14 and len(f) > 5 and f[5] == 0x01]
        self.assertGreaterEqual(len(af_frames), 1)

    def test_post_unknown_command_does_not_500(self):
        try:
            r = self._post_json('/ic7100cmd', {'cmd': 'nonexistent_xyz'})
            # Either ok:false or some error structure, but no 500.
            self.assertIn('ok', r)
        except HTTPError as e:
            self.assertLess(e.code, 500, "unknown cmd should not 500")


if __name__ == '__main__':
    unittest.main()
