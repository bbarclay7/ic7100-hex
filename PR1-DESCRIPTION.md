# PR 1 draft (not opened). Target: ukbodypilot/ic7100-remote `main` (v0.2.1). Branch: `pr1/tone-and-meters` (4 commits)

**Title:** Fix CTCSS tone read/write, TONE/TSQL opcodes and stale TX meters; document the memory banks

---

Hi, and thanks for ic7100ctl. This is a small set of bug fixes, opcode corrections and doc fixes found while
using the panel with my own IC-7100. They are all in the "bug fixes, opcode corrections, documentation" scope
from the README. Four commits, each on its own and each with a test.

## What changes

1. **CTCSS tone frequency is three BCD bytes** (`1B 00`, `1B 01`; 127.3 Hz is `00 12 73`). `set_ctcss()` sent two bytes
   and `get_ctcss()` read the first two of three, so 127.3 Hz read back as 1.2 Hz and the tone dropdowns never matched
   the radio. Adds `tone_to_bcd3()` and tests for both directions.
2. **TONE is `16 42` and TSQL is `16 43`**, not the other way round (Hamlib: `S_FUNC_TONE` 0x42, `S_FUNC_TSQL` 0x43).
   Before this, the CTCSS card's "on" box switched TSQL and the FM Squelch card's TSQL button switched TONE. The
   flags are now `tone_on` / `tsql_on`; the old `ctcss_tx_on` / `ctcss_rx_on` names stay as aliases with the meaning
   their names implied, so existing clients of the status JSON and the `ctcss` command keep working.
3. **Po / SWR / ALC are shown only while transmitting.** They are only read while keyed, so after unkeying the status
   kept the last transmit's values (the panel's bars stayed stuck) and the next key-up briefly showed them again.
4. **Docs:** CTCSS layout, the TONE/TSQL opcodes, and that the IC-7100 *does* have memory banks A-E (`08 A0` with a 2-byte
   BCD bank counted from 1; a bare `08 A0` answers NG). `docs/protocol.md` and two comments in `radio.py` said otherwise.

## How I checked it

Everything above was checked against a real IC-7100 (Debian host, CP2102 USB, direct CI-V):

- **Tone setter and getter:** wrote several tones (100.0, 123.0 and 88.5 Hz), read each back through the radio, and
  restored the original.
- **TONE/TSQL:** the head unit shows TONE when `16 42` reads 1 and TSQL when `16 43` reads 1; the radio treats them as
  exclusive (turning TSQL on turns TONE off).
- **Stale meters:** I sampled the status at 5 Hz around a voice transmission with v0.2.1 and with this change. v0.2.1
  kept ALC at 18 for every sample after release; with this change Po/ALC/SWR read 0 straight away. (A second v0.2.1 run
  read 0 as well, because the stale value is simply whatever the last read happened to be, so it does not always show.)
- I also re-ran the non-transmit checks above against **this branch's own code** on the radio, and all passed.
- `pytest`: 46 passed, 2 skipped (the two skips are existing WebRTC tests that need `aiortc`).

## A note on how this was made

I used an AI coding assistant (Claude Code) to help investigate, write and test these changes. I ran every
check on my own radio and reviewed the code myself, but you should know that AI assistance was part of it.

73, Brandon AK6MJ
