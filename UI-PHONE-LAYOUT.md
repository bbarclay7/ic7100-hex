# Phone layout: requirements gathered 2026-10-09 (from a real net check-in on an iPhone, Safari, AirPods)

Built so far: sticky top bar shows `Mic: <input name>` (working copy only, not deployed).

## Ready-to-talk strip (bottom of screen, always visible)
1. Frequency, mode, S-meter (Po/SWR while keyed)
2. Receive: NR lamp button (tap = on/off, level elsewhere), RF gain slider (tick at 100%)
3. Transmit: Mic name + level meter, CESSB and PRE-EMPH buttons
4. HOLD TO TALK, full width

## HF tuning (agreed)
- Searching is about 1 kHz/s; fine control needed after a bump.
- **Lock**: manual only; freezes wheel and digit controls.
- **Return**: jumps to an anchor frequency (set by typing + Set, picking a memory/channel, or a Mark button).
  Show anchor and drift on screen, e.g. `Set 3.758.000 (now 3.759.320, +1.3 kHz)`. Not an undo history.

## VHF (not yet specified)
- Selects channels; wants a big channel up/down and a memory picker, no digit tuning.

## Open
- Mic-level slider in the strip or meter only; hold vs latch PTT; phone-only vs desktop; keyed state styling; landscape.
- Transmit noise gate for far mics (not built); log CESSB/Level state in the [tx] line (not built).
