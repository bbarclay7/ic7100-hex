# Phone layout: requirements gathered 2026-10-09 (from a real net check-in on an iPhone, Safari, AirPods)

Built 2026-10-09 (working copy only, NOT deployed, not yet tried on a real phone): `web/phone.js` + CSS appended to `panel.css`;
server commands `memory_list` and `memory_pick` (tests added). Checked in headless Chrome at 390 px against a mock radio.

## Ready-to-talk strip (bottom of screen, always visible)
1. Frequency, mode, S-meter (Po/SWR while keyed)
2. Receive: NR lamp button (tap = on/off, level elsewhere), RF gain slider (tick at 100%)
3. Transmit: Mic name + level **meter only** (no slider; level is set rarely), CESSB and PRE-EMPH buttons
4. HOLD TO TALK, full width

## HF tuning (agreed)
- Searching is about 1 kHz/s; fine control needed after a bump.
- **Lock**: manual only; freezes wheel and digit controls.
- **Return**: jumps to an anchor frequency (set by typing + Set, picking a memory/channel, or a Mark button).
  Show anchor and drift on screen, e.g. `Set 3.758.000 (now 3.759.320, +1.3 kHz)`. Not an undo history.

## Edge-on tuning wheel (phone, replaces the big dial; built, checked headless, not yet on a real phone)
- A strip about 56 px tall, full width, showing the knurled rim of a wheel from the side; ridges slide under the finger.
- Horizontal drag only (does not scroll the page). Dims and ignores touches while Lock is on.
- One ridge in every n is a different colour or texture, so rotation is visible even when the others look alike.
- Step size per ridge: selectable buttons 1 kHz / 250 Hz / 100 Hz / 10 Hz.
- A **snap** control rounds the current frequency to the nearest 1 kHz.
- Value readout sits above the wheel. The same component (`makeEdgeWheel` in phone.js) can be reused for RF gain, squelch, volume, power.
- Layout question for review: the wheel scrolls with the page while the top bar is sticky; consider putting the wheel inside the sticky bar.

## VHF (not yet specified)
- Selects the radio's memory channels (bank E for the Sunday/Monday nets; knows names by heart).
- A **Channel** button opens a full-screen, scrollable table: channel number, label. **Bank select always visible.** No digit tuning.
- Picking a channel also sets the Return anchor.
- The channel number and name already show next to the frequency in the sticky bar (updateMini); nothing to build there.
- Quick press on a row: tune and stay open. Long press: tune and close.

## Open
- (decided: hold-to-talk only, no latch)
- (decided: keyed = strip tinted red, S-meter swaps to Po/SWR, thin red border around the whole screen)
- (decided: portrait first; landscape second, laid out like the real control head)
- phone-only vs desktop.
- Transmit noise gate for far mics (not built); log CESSB/Level state in the [tx] line (not built).

## Built and deployed 2026-10-11 (feedback from first real use)
- Mode selector `VFO A | VFO B | MEMO` with lit state; separate CHANNEL button; wheel steps channels in memory mode.
- Channel table: tapped row flashes and a "Tuned: ..." line confirms (no listening needed).
- Strip: S-meter, NR, RF, SQL, Mic name + meter, COMP, PRE, CESSB, PTT. PTT ignores touches in the bottom 40 px (iOS address-bar
  swipe keyed the transmitter) and sits 44 px above the screen bottom.
- Compression precedes CESSB in the mic chain (Level, compressor, makeup, pre-emphasis, CESSB/clipper).
- Operating principle: feedback comes from using it; collect items as they appear and fix in batches.
- Not yet: landscape, transmit noise gate, `[tx]` logging of CESSB/Level/COMP state, hint that the page scrolls.
