# PR 3 draft (not opened). Stacked on PR 2 (which is stacked on PR 1): open after those are merged, then rebase onto main. Branch: `pr3/tx-diagnostics` (4 commits)

**Title:** Diagnostics: one log line per transmission, say whether mic audio reached the radio, and stop flooding the log when the radio is off

---

Follow-up to #1 and the audio PR. No behaviour change to how the radio is driven: logging, one status flag and a cache header.
Four small commits:

1. **One `[tx]` line per transmission:** duration, frequency/mode, DATA on/off, the power setting, and the highest Po / ALC / SWR
   seen. `radio.on_tx_start` / `on_tx_end` hooks fire when the TX state flips; a hook that raises never breaks CI-V.

       [tx] 2.7 s on 3.7580 MHz LSB (DATA on, power set 10%) | peaks raw: Po 40 ALC 155 SWR 3

2. **...and whether the browser's mic audio reached the radio** (DATA-mode transmissions only): frames received and played,
   the peak level of what was played (dBFS or SILENT), and a warning when nothing audible got through. Hand-mic transmissions
   get no mic section, so no false warnings. This is what showed a headset streaming frames of digital silence.
3. **A switched-off radio no longer floods the log.** One line for the first timeout, one when five in a row show it is not
   answering, one when it answers again. Polling slows to every 2 s meanwhile, and the status JSON gains `radio_responding`.
4. **`Cache-Control: no-cache` on the static files**, so a redeploy shows up on a plain reload.

## How I checked it

- Every new test fails against the code before its commit (I ran each against the previous source). The PyAV peak test needs
  PyAV; I ran it on the radio host.
- This exact branch, run against an IC-7100 without transmitting: `radio_responding` true, correct frequency and mode,
  meters at 0 in receive, `Cache-Control: no-cache` on `panel.js`.
- The `[tx]` line itself (with these fields) was seen on the radio through my working copy of the same code over many transmissions;
  I have not keyed the radio with this exact branch.
- I have not re-run commit 3 against a switched-off radio; it is covered by tests with a fake serial port.
- `pytest`: 64 passed, 4 skipped (tests that need `aiortc` or PyAV).

## A note on how this was made

I used an AI coding assistant (Claude Code) to help investigate, write and test these changes. I ran every check on my own radio
and reviewed the code myself, but you should know that AI assistance was part of it.

73, Brandon AK6MJ
