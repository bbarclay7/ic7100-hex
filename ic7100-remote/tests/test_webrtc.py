"""Smoke test the WebRTC offer/answer path.

This validates the aiortc bridge integration end-to-end without actually
playing audio anywhere — we create a minimal browser-side peer
connection in-process and confirm the server accepts the offer and
returns a valid answer SDP.

ALSA capture/playback are pointed at /dev/null devices: arecord/aplay
will fail silently, but the WebRTC machinery (SDP, ICE, peer
connection state) is fully exercised.
"""
import asyncio
import json
import threading
import time
import unittest
import urllib.request

try:
    from aiortc import RTCPeerConnection, RTCSessionDescription
    AIORTC_AVAILABLE = True
except ImportError:
    AIORTC_AVAILABLE = False

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


@unittest.skipUnless(AIORTC_AVAILABLE, "aiortc not installed")
class WebRTCBridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from ic7100ctl.webrtc import WebRTCBridge
        cls.transport = MockCIVTransport()
        cls.radio = IC7100(cls.transport)
        # Use a known-bad device — arecord/aplay will fail to start
        # capturing/playing real audio, but the SDP exchange should
        # still complete.
        cls.bridge = WebRTCBridge(
            capture_device='null', playback_device='null')
        cls.bridge.start()
        cls.port = _free_port()
        cls.server = RadioServer(
            cls.radio, host='127.0.0.1', port=cls.port,
            webrtc_bridge=cls.bridge)
        cls.server.start()
        cls.thread = threading.Thread(
            target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        time.sleep(0.2)
        cls.base = f'http://127.0.0.1:{cls.port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.stop()
        cls.bridge.stop()

    def test_offer_returns_valid_answer(self):
        async def run():
            pc = RTCPeerConnection()
            pc.addTransceiver('audio', direction='sendrecv')
            offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            # Wait for ICE gathering
            for _ in range(20):
                if pc.iceGatheringState == 'complete':
                    break
                await asyncio.sleep(0.1)
            return pc.localDescription

        loop = asyncio.new_event_loop()
        try:
            offer = loop.run_until_complete(run())
        finally:
            loop.close()

        req = urllib.request.Request(
            f'{self.base}/webrtc/offer',
            data=json.dumps({'sdp': offer.sdp, 'type': offer.type}).encode(),
            headers={'Content-Type': 'application/json'},
            method='POST')
        with urllib.request.urlopen(req, timeout=10) as r:
            answer = json.loads(r.read().decode())

        self.assertIn('sdp', answer, f"answer missing sdp: {answer}")
        self.assertIn('type', answer)
        self.assertEqual(answer['type'], 'answer')
        # SDP must contain an audio m-line and Opus payload-type mapping.
        self.assertIn('m=audio', answer['sdp'])
        self.assertIn('opus', answer['sdp'].lower())

    def test_offer_without_bridge_returns_503(self):
        # Spin a fresh server WITHOUT a bridge to verify graceful failure.
        port = _free_port()
        srv = RadioServer(self.radio, host='127.0.0.1', port=port,
                          webrtc_bridge=None)
        srv.start()
        t = threading.Thread(target=srv.serve_forever, daemon=True)
        t.start()
        time.sleep(0.1)
        try:
            req = urllib.request.Request(
                f'http://127.0.0.1:{port}/webrtc/offer',
                data=json.dumps({'sdp': 'v=0', 'type': 'offer'}).encode(),
                headers={'Content-Type': 'application/json'},
                method='POST')
            try:
                urllib.request.urlopen(req, timeout=2)
                self.fail("Expected HTTPError")
            except urllib.error.HTTPError as e:
                self.assertEqual(e.code, 503)
        finally:
            srv.stop()


if __name__ == '__main__':
    unittest.main()


class MicActiveTests(unittest.TestCase):
    def test_mic_active_only_while_frames_are_recent(self):
        import time
        from ic7100ctl import webrtc
        webrtc._TX_STATE['t'] = time.monotonic()
        self.assertTrue(webrtc.WebRTCBridge.mic_active(None))
        webrtc._TX_STATE['t'] = time.monotonic() - 5
        self.assertFalse(webrtc.WebRTCBridge.mic_active(None))


class PlaybackNeverBlocksTests(unittest.TestCase):
    def test_write_frame_returns_immediately_even_if_aplay_is_stuck(self):
        import time
        from unittest import mock
        from ic7100ctl.audio import AlsaPlayback

        class StuckStdin:
            def write(self, b): time.sleep(5)          # aplay not draining
            def close(self): pass
        class FakeProc:
            stdin = StuckStdin()
            def terminate(self): pass
            def wait(self, timeout=None): pass
            def kill(self): pass
        with mock.patch('ic7100ctl.audio.subprocess.Popen', return_value=FakeProc()):
            pb = AlsaPlayback('null'); pb.start()
            t0 = time.monotonic()
            for _ in range(500):                        # far more than the queue holds
                pb.write_frame(b'\x00' * 1920)
            self.assertLess(time.monotonic() - t0, 0.5)
            self.assertLessEqual(pb._q.qsize(), pb.QUEUE_FRAMES)
            pb._stop.set()

    def test_tx_gate_follows_keyed_state(self):
        from ic7100ctl import webrtc
        class R: transmitting = False; _ptt_deadline = None
        b = webrtc.WebRTCBridge.__new__(webrtc.WebRTCBridge); b.radio = R()
        self.assertFalse(b._tx_gate())
        b.radio._ptt_deadline = 123.0                   # hold-to-talk requested, key-up in flight
        self.assertTrue(b._tx_gate())
        b.radio._ptt_deadline = None; b.radio.transmitting = True
        self.assertTrue(b._tx_gate())


class TxPeakTests(unittest.TestCase):
    def test_peak_of_audio_forwarded_to_the_radio_is_tracked(self):
        import asyncio
        try:
            import av
        except ImportError:
            self.skipTest('av not installed')
        import struct
        from ic7100ctl import webrtc

        pcm = [0] * 960; pcm[100] = -12000                               # one loud sample
        frame = av.AudioFrame(format='s16', layout='mono', samples=960); frame.sample_rate = 48000
        frame.planes[0].update(struct.pack('<960h', *pcm))
        class Track:
            def __init__(self): self.n = 0
            async def recv(self):
                self.n += 1
                if self.n > 1: raise RuntimeError('end')
                return frame
        class Sink:
            def write_frame(self, b): pass
        webrtc._TX_STATE['peak'] = 0
        asyncio.run(webrtc._consume_tx_track(Track(), Sink(), asyncio.Event(), gate=lambda: True))
        self.assertEqual(webrtc._TX_STATE['peak'], 12000)
