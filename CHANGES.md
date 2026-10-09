# Changes against upstream ic7100ctl v0.2.1

Base: https://github.com/ukbodypilot/ic7100-remote at tag `v0.2.1` (commit e060ac7).
Working copy: `ic7100-remote/` (not a git checkout). About 1,300 lines differ.
Upstream's contributing note welcomes bug fixes, opcode corrections, docs and UI
tightening, IC-7100 only. Everything below was run against a real IC-7100 unless
marked **not verified on hardware**.

Tests: 64 pass (upstream's suite plus ~25 new tests).

## 1. Bug fixes and opcode corrections (best upstream candidates)

| # | Problem in v0.2.1 | Fix | Verified |
|---|---|---|---|
| 1 | CTCSS **tone setter sends 2 BCD bytes**; the radio uses 3 (`00 12 73`), as Hamlib's `icom_set_ctcss_tone` does. "Apply" never worked. | `tone_to_bcd3`; `1B 00` (TONE freq) and `1B 01` (TSQL freq) now send 3 bytes. | Write, read-back and restore on the radio. |
| 2 | **Tone getter decodes the wrong bytes** (127.3 Hz reads as 1.2 Hz), so the tone dropdowns were blank. | Decode bytes 3-4 of the 5-byte reply. | Reads 127.3 and 88.5 correctly. |
| 3 | **TONE and TSQL swapped**: code treats `16 43` as "TX tone" and `16 42` as "RX tone squelch". On the radio `16 42` = TONE and `16 43` = TSQL (Hamlib `S_FUNC_TONE`/`S_FUNC_TSQL`). The card's "on" box toggled TSQL, and the FM Squelch card's TSQL button toggled TONE. | Renamed to `tone_on` / `tsql_on` end to end (radio, server status, page, tests). | Toggled both on the radio; head unit labels matched. |
| 4 | **TX meters (Po/ALC/SWR) stay frozen** at the last transmit value after unkeying, and flash the previous transmit's values at the start of the next. | Report zero when not transmitting; wipe the TX meters whenever the TX state flips. | Seen on the radio, fixed. |
| 5 | **Po reads 0 in SSB**: one read per cycle lands between syllables. | Read Po 5x per TX cycle and report the peak; ALC and COMP every cycle, SWR/Id/Vd rotated. | Po peaks now register. |
| 6 | **RX audio garbles / stops** once the mic stream is on: `AlsaPlayback.write_frame` does a blocking pipe write on the asyncio loop that also serves RX audio and keeps the peer connection alive. | Non-blocking queue + writer thread (drops oldest on overflow). Mic audio is only forwarded to the radio while keyed (or a hold-to-talk key-up is in flight). | Garble and spontaneous stops gone on the radio. |
| 7 | **Mic silently unavailable** on plain `http://` (browsers block it); keying then sends a carrier with nothing to modulate. `input_active` was hardcoded `False`, and `audio_rx` only meant "server has audio". | Page shows "RX only, NO MIC" with the reason, warns on key-up without a mic; `input_active` now reflects mic frames actually arriving. | Seen on the radio. |
| 8 | **Docs/code claim the IC-7100 has no memory banks** (`docs/protocol.md`, a comment in `radio.py`). It has banks A-E. | See 2.1. Doc fix still to do: bare `08 A0` returns NG (it is not "Bank A select"). | Banks selected on the radio. |
| 9 | Panel **VOL knob does nothing** (server no-ops it and the page snaps it back to 100%); AF only changes the head unit's own speaker, not the stream. | Removed in the new layout. Classic layout unchanged. | Confirmed by the user. |
| 10 | HTTP caching: edits did not show on a normal reload. | `Cache-Control: no-cache` on static files. | |

## 2. Enhancements

### 2.1 CI-V features (generic)
- **Memory banks A-E**: `08 A0 [2-byte BCD bank]`, banks numbered from **1** (sending 4 selects D). Selector buttons.
- **Memory read** (`1A 00 [bank BCD1][ch BCD2]`): 114-byte reply, frequency bytes 4-8, mode byte 9, tone-mode nibble in byte 12, 16-character name in bytes 98-113. Empty slot = short reply ending `FF`. Background scan (about 26 s) caches all channels.
- **Active memory inferred** from live frequency + mode (+ TONE/TSQL to split repeater pairs). The radio cannot report its bank, channel or VFO/MEM state (bare `08 A0` returns NG). Ambiguous matches show nothing. Name label, `MEMO E25` block, prev/next channel stepping within a bank (skips empty slots and 100-109).
- **RF gain** (`14 02`), **speech compressor on/off** (`16 44`, read-only annunciator).
- **Extra meters**: COMP (`15 14`), Vd (`15 15`), Id (`15 16`), all raw 0-255.
- **Meter calibration** (from Hamlib's IC-7100 tables): S, Po (W), SWR, ALC, COMP (dB), Vd (V), Id (A). **S9 anchored at raw 124** (Hamlib has 120; measured on this unit), S-units to S9, then S9+10/20/...
- **Hold-to-talk PTT** (button and Spacebar): keepalives every 500 ms, server watchdog unkeys after 1.5 s without one, requests strictly ordered, late keepalives never re-key, lamp/button follow the operator. Space auto-repeat no longer scrolls the page.

### 2.2 UI (larger; optional for upstream)
- **Head-unit style layout** at `/` (old layout kept at `/classic`): mode/filter pick menus, TONE/TSQL indicator, annunciators (`P.AMP AGC-F NB NR COMP...`), tappable MEMO/VFO block, TX/RX lamp, SQL/RF/PWR knobs left, big VFO knob right, scaled meter bars with tick labels, peak-hold marker with hold time and a `pk` readout (for net signal reports).
- Trackpad-friendly input: scroll accumulation (25 px/step) on knobs and frequency digits; straight-line drag option for the tuning knobs (`?knob=circular` restores the old drag).
- The HF Controls card's **MIC gain** is a slider like the others (the radio's own mic gain, hand mic only), instead of a lone knob.
- **Audio health line** (packets lost, jitter, concealed audio, which address the stream uses).
- **Browser mic processing** (Web Audio): level, compressor (amount slider), makeup gain, soft clipper. The radio's own compressor does not act on USB/DATA audio. The COMP bar shows this compressor's gain reduction while sending browser audio. **Not verified on hardware with real voice.**

## 3. Local only (not for upstream)
- `hex` deployment: systemd unit, udev rule pinned to the CP2102 serial ending "A" (this radio exposes two CP2102 ports, A and B, and upstream's rule matches both), Tailscale + `tailscale serve` HTTPS (needed for the mic), ufw, Wi-Fi power-save off, passwordless sudo, JetKVM.
- Parent-directory tooling: `Makefile`, `README.md`, `backup/` (read-only dump of all five memory banks), `pi-image/` (Pi SD-card builder, **shelved, untested on hardware**).

## 4. Not verified on hardware / known limits
- Memory stepping and bank-number fix: unit-tested, not re-confirmed on the radio by the operator.
- RF gain knob: command and read tested against a mock; value not cross-checked with the head unit.
- Software compressor: tested with Chrome's fake microphone only.
- Po watts come from Hamlib's table and may be HF-scaled; SWR/COMP/ALC scales unchecked against an external meter.
- TONE and TSQL are mutually exclusive on the radio (selecting one clears the other).
- Active bank, memory channel and VFO/MEM state are inferred, never reported.

## 5. Suggested PR split (if upstreamed)
1. Opcode/bug fixes: items 1-5 (small, high confidence, easy to review).
2. Audio robustness: items 6-7.
3. Memory banks + names + `docs/protocol.md` correction (item 8, 2.1).
4. Extra meters, calibration, RF gain, COMP indicator.
5. Hold-to-talk PTT.
6. Head-unit layout and input niceties (large; offer as optional / separate).
7. Browser mic processing (optional).

## 6. Added 2026-10-07/08 (after the tier-1 split above)

| # | Change | Verified |
|---|---|---|
| 11 | **Audio pipes respawn after the codec disappears.** `AlsaCapture`/`AlsaPlayback` never restarted `arecord`/`aplay` after a USB unplug, so browser audio went into a dead pipe until the service was restarted. Now retried every 2 s, logged once. `tests/test_audio.py`. | Killed both processes on hex: both back within 6 s. Tests fail on the old code. |
| 12 | **CESSB** (controlled-envelope SSB) in the browser mic chain (`web/cessb.js`, AudioWorklet): button (default on, SSB-only), booster slider 0..+18 dB, clip-depth readout. `tests/cessb_test.js`. | Chrome + FT-710 at 100 W: +3.3 dB average level over the handset, +0.7..1.5 dB over the plain panel. Spectral purity (IMD, occupied bandwidth) NOT yet measured; see FINDINGS. |
| 13 | **Mic selector on the Audio line**, remembered by id and name, shows the device actually in use (fixes the dropdown showing a saved choice while Chrome fell back to the default), level bar, "Mic is SILENT" warning on key-down, optional dead-mic check (default off), reconnect when the OS ends the mic stream. | Chrome with fake devices; AirPods/Jabra on the radio. |
| 14 | **`[tx]` log line** per transmission: frequency/mode, DATA, power set, Po/ALC/SWR/Vd peaks, mic frames received/sent, mic name and peak dBFS, warning when no audio reached the radio. `mic_info` command. | Used all session. |
| 15 | Panel layout: RF Gain label, painted TX/RX legend over the lamp, Write/Clear next to MEM. | Rendered in headless Chrome. |

See `FINDINGS-2026-10-08.md` for the measurements behind 11-14.
| 16 | **Radio speech compressor controls** (on/off `16 44`, level `14 0E`, hand mic only) in the HF controls; status `comp_level`. Tests in `test_radio.py`/`test_server.py`. | Set and read back on the radio; handset +2.0 dB at 100 W. |
| 17 | **FM pre-emphasis** option in the browser mic chain (`PRE-EMPH` button, default on, FM only): +0.7 dB at 300 Hz, +4.6 dB at 1 kHz, +11 dB at 3 kHz, ahead of the soft clipper. First-guess curve, to be tuned by ear: the radio's data input is believed to be flat. | Filter response measured in Chrome; routing tested by mode; not yet judged on the air. |
| 18 | **Remote power on/off**: CI-V `18 01` preceded by 25 wake-up bytes switches the radio on from standby (its USB port stays alive while off), `18 00` switches it off. Panel `POWER` button with a lamp (green = on and answering, blinking amber = starting, dark = off), confirm before off, 20 s start timeout; the instrument cluster dims while the radio is not answering. Tests in `test_radio.py`/`test_server.py`. | Off then on through the panel on the real IC-7100 (stopped answering within 8 s; answering again after about 4 s). |
| 19 | **VFO row**: the active VFO stays lit when the radio's frequency merely matches a stored memory (a guess: the radio does not report VFO vs MEM); it shows with a dashed outline and a tooltip. Only the panel's own memory mode unlights the VFOs. The redundant `VFO:` item was removed from the top bar so it no longer wraps. | Four cases checked in headless Chrome. |
