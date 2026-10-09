# PR 2 draft (not opened). Stacked on PR 1: open it after PR 1 is merged (rebase onto main first). Branch: `pr2/audio-robustness` (4 commits)

**Title:** Audio: don't block the event loop on aplay, respawn arecord/aplay after the codec disappears, and report whether the mic is really there

---

Follow-up to #1. Four small commits about the audio path, found while using the panel with an IC-7100:

1. **Never block the event loop on an `aplay` write.** `write_frame()` wrote straight into aplay's stdin from the WebRTC
   asyncio loop; when aplay stopped draining, the loop blocked, and with it the RX audio and the peer connection.
   RX audio garbled and then stopped as soon as the browser's mic stream was on. `write_frame()` now only queues
   (bounded, oldest dropped) and a writer thread does the blocking write.
2. **Only play the browser's mic audio while the radio is keyed.** Otherwise it piles up in the codec's playback buffer.
   (I found this together with 1 and did not measure its effect separately.)
3. **Respawn `arecord`/`aplay` when the sound card disappears.** The module docstring says the pipes respawn "on next
   `start()`", but nothing calls `start()` again and `start()` returned early for a dead process. After the radio was
   unplugged and replugged, the panel kept running with silent RX and the mic audio going into a dead pipe, until the
   service was restarted. Each pipe now respawns itself every 2 s and logs the loss and recovery once.
4. **`input_active` reports the real mic stream** (it was hard-coded `False`), and the page says **"RX only, NO MIC"**
   (with the reason in a tooltip) when the browser refuses the microphone, e.g. over plain http. Before, it said
   "streaming", PTT keyed the radio, and nothing modulated it.

## How I checked it

- Every new test **fails against the previous code and passes now** (confirmed by running them on the commit before).
  The mic-gate frame test needs PyAV; I ran it on the radio host where it is installed.
- On an IC-7100 (Debian host): with the service running, I killed `arecord` and `aplay` by hand and both were back
  within 6 s. I have **not** repeated this with a physical unplug after the change.
- Item 4's page text was checked in headless Chrome against this branch's own files (no mic, mic present).
- `pytest`: 53 passed, 3 skipped (existing/new tests that need `aiortc` or PyAV).

## A note on how this was made

I used an AI coding assistant (Claude Code) to help investigate, write and test these changes. I ran every check on
my own radio and reviewed the code myself, but you should know that AI assistance was part of it.

73, Brandon AK6MJ
