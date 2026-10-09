# How the CESSB / transmit-distortion tests were done (reproduction guide)

Tests run 2026-10-08 to 2026-10-09 on an IC-7100 driven from the ic7100ctl panel. Results are in
`../../FINDINGS-2026-10-08.md`; this file says how to repeat them and why each choice was made. Numbers quoted here are from those runs.
The test rig, scripts and analysis were built and driven with an AI coding assistant (Claude Code), with the operator at the radios.

## 1. Question and approach

Does the panel's browser-side CESSB (controlled-envelope SSB) speech processor help, and does it make the transmitted signal dirtier?
The CESSB reference (rf.guru "What is CESSB") says the proof is a before-and-after test **at the RF output**, same final peak, with an
IMD and occupied-bandwidth comparison, and warns that a downstream ALC can undo the processor's work. So the tests send **known synthetic
audio** into the radio's USB codec, receive the RF on a **second radio**, record its demodulated audio, and compare with what was sent.

Listening tests and the radio's ALC bar were not enough on their own: the ALC reading and the average power say nothing about distortion,
and an on-air signal report changes with band conditions from one take to the next. A repeatable bench measurement was needed first.

## 2. Terms

- **dBFS**: decibels below the digital maximum of an audio file (0 dBFS = full scale). "Peak -11.4 dBFS" is the largest sample.
- **dBc**: decibels relative to the wanted signal (or tone). -30 dBc means 1/1000 of its power. More negative is cleaner.
- **IMD3 / IM5**: intermodulation products of two tones f1, f2 at 2f1-f2 and 2f2-f1 (third order) and 3f1-2f2, 3f2-2f1 (fifth order). With
  900 and 1400 Hz: IMD3 at 400 and 1900 Hz, IM5 at 100 Hz (below the passband) and 2400 Hz.
- **Crest factor**: peak level minus average (RMS) level, dB. CESSB lowers it so the average can rise at the same peak. Here the average is the
  mean-square over the whole 8 s test signal (pauses included), so the figures are consistent between versions but a few dB higher than a
  crest factor over active speech only.
- **Received peak**: the peak of the recording made at the monitor radio, not of the file sent. Equal digital peak is not equal RF peak
  (the radio's transmit filter shaves plain speech's sharp peaks), so versions are compared at equal *received* peak.

## 3. Equipment and setup

| Item | Detail |
|---|---|
| Transmitter | IC-7100 on hex (NUC, Debian). CI-V over USB (`/dev/ic7100`), audio into the radio's USB codec (card `CODEC`), power set by CI-V |
| Dummy load | 50 W load in place of the HF antenna for stages 1-3 (power capped at 40%). Stage 4 (100 W) used the real antenna, SWR 1:1 |
| Monitor | FT-710 on hamtop1 (Windows + WSL); audio recorded with portable `ffmpeg.exe` (dshow device "FT710 Microphone (USB Audio Device)", 48 kHz mono) |
| Coupling | Both radios are on the same 3-way coax switch; the FT-710 hears the IC-7100 through the switch's port-to-port leakage. Isolation about 105 dB (estimated from the S-meter, not measured) |
| Frequency | 3.758 MHz LSB on both radios. Frequency checked clear; callsign and the experiment announced before the 100 W series |
| Monitor settings | AGC **off**, RF gain lowered (about 2 o'clock in stage 4; position not recorded for stages 1-3), front end AMP1 (stages 1-3) / IPO (stage 4), LSB. Windows input level for the USB audio device left untouched within a series |
| Panel | Paused during tests (`ssh hex radio-mode digital`); restored with `radio-mode voice` |

Why a second radio on switch leakage: it is cheap and keeps the monitor linear (roughly -55 dBm at the receiver at 100 W, if the isolation
estimate is right). It sets a measurement floor of about -42 to -47 dBc for adjacent-band energy and about -35 to -40 dBc for IMD, so anything
cleaner than that cannot be shown. The recorder is not calibrated: every dB figure is relative to another recording made with the same settings.

Monitor checks that matter: AGC off (otherwise the receiver flattens level differences); do not move the RF gain or front-end switch within a
series; confirm it is not overloading (section 7).

## 4. Test signals (`gen.js`)

`node gen.js` (needs the repo's `ic7100ctl/web/cessb.js`; `NOPRE=1` writes `np_*` files with no preamble). 48 kHz mono 16-bit WAV.

- **Speech-like**: pulse train (105 Hz, +/-25 Hz vibrato) through formant resonators at 650/1150/2450 Hz, syllable envelope 3.7 Hz, plosive-like
  bursts; 8 s. Seeded random generator, so it is reproducible. Chosen because real speech varies run to run; this gives identical audio for
  every version. Caveat: it is a model of speech, not speech.
- **Three versions of the same audio**: plain (scaled to a peak of 0.85), CESSB booster +12 dB, CESSB +18 dB, each produced by the panel's own
  `CessbCore` (so the test uses the shipped code) and then scaled to a stated peak: **-25.4 dBFS** (radio in its linear region at 40%),
  **-11.4 dBFS** (at the knee) and **hot** (-1.4 dBFS, the level the panel actually runs).
- **Two-tone**: 900 + 1400 Hz, 4 s, peaks from -4.4 to -37.4 dBFS (steps of 3 dB, with 6 dB at the low end). Two tones are the standard IMD test.
- The first stage used a preamble (silence, 0.3 s chirp 300-2500 Hz, 1 kHz pilot) for time and frequency alignment. It turned out to leak into
  the adjacent-band totals and drive the ALC readings, so the later `np_*` files have only 0.5 s of leading silence.

## 5. Procedure

1. Stop the panel, set the radio: 3.758 MHz LSB, power (10/40/100%). Check `radio-get`. `play_tx.py` refuses to key unless the frequency is
   3.758 LSB and the power is at or below a ceiling argument.
2. Dummy-load stages: antenna disconnected, load in place. 100 W stage: antenna on, short tone steps at 10%, 50%, 100% while reading SWR
   (`swr_check.py`; raw 0 = 1:1, confirmed on the radio's own meter) before any test signal.
3. Copy the WAVs to hex `/tmp`.
4. For each file: start the recorder on hamtop1, wait 3 s, key the radio and play the file (`play_tx.py`, which keys by CI-V `1C 00`, plays
   with `aplay -D plughw:CARD=CODEC,DEV=0`, samples Po/ALC, unkeys), then wait for the recorder to finish **before copying the recording**
   (copying early gave truncated files). `run_series.sh TAG SECS NAME...` does this.
5. Adjacent-band: repeat each file with the FT-710 retuned to **3.755 MHz LSB** (batch B) after the in-band recording at 3.758 (batch A).
   With its roughly 0.3-2.7 kHz passband the FT-710 then covers 3.7523-3.7547 MHz: 3.3-5.8 kHz below the carrier, 0.6-3.1 kHz beyond the
   lower edge of the transmitted signal (3.7553-3.7577). Only the low side was measured. The operator watched the waterfall (span
   3750-3760 kHz) during the 100 W batch.
   Timing: the recorder starts 3 s before keying, `play_tx.py` waits 0.5 s after keying, and each file has 0.5 s of leading silence, so the first
   2 s of every recording are receiver noise; the analysis uses them as the noise reference.
6. Restore: panel back, radio back to its previous state.

Power was capped at 40% into the 50 W load; the frequency was checked clear and the callsign given before transmitting.

## 6. Analysis (`np_analyze.py`, `imd.py`, `analyze_rf.py`)

`uv run --with numpy --with scipy python np_analyze.py twotone|speech TAG` and `adj TAGA TAGB`.

- **Two-tone IMD**: FFT of the steady part (Hann window), power summed within +/-8 Hz of each line (absorbs the ~1.4 Hz carrier offset between the
  radios), products relative to the mean of the two tones.
- **Average level**: total recorded power above the recording's own noise (first 2 s), summed over the recording and divided by the 8 s test.
  No time alignment is needed, which is why this replaced the earlier correlation approach.
- **Adjacent-band ratio**: the same total-excess power at 3.755 (B) minus at 3.758 (A), in dB. The tail noise (last 2 s) is reported as an
  error estimate; the ratio is only meaningful when B is above it.
- **Compare at equal received peak**: the received peak per version differs by up to 0.6 dB, so differences are corrected by that amount.
- Mean-square level, not RMS of a short window, is used so the result does not depend on how the speech envelope lines up.

## 7. Controls and checks done

- **Floor**: the FT-710 leakage floor was measured with the two-tone control; adjacent-band results below it are not claimed.
- **Receiver overload (stage 4)**: RF gain lowered by about a third; the received tone fell 17.4 dB and IMD3 stayed within 0.2 dB (-27.2 vs -27.0
  dBc). A front end generating the products would have improved by about 35 dB, so the products are the transmitter's.
- **Clocks**: the two radios' carriers differ by about 1.4 Hz and the two sound devices' clocks by about -190 ppm. The window-based analysis
  tolerates both; the earlier correlation-based metric did not.
- **ALC and Po readings from CI-V** are sampled sparsely (about 5 per second) and are indicative only.

## 8. Results in brief (details in the findings file)

- Radio transmit passband about 281-2719 Hz. At saturation the radio's own IMD3 is about -28 to -30 dBc regardless of input; the knee (where
  output stops rising) is at about -11 to -13 dBFS drive at both 40% and 100% power.
- CESSB average level at equal received peak: +12 dB: +2.1 dB, +18 dB: +3.8 to +4.5 dB over unprocessed speech (40% and 100% agree within 0.7 dB).
- Adjacent band: at least 43 dB below the in-band level for every version; a slight tail ending about 4 kHz below the carrier is visible on the
  waterfall at 100 W and matches the radio's own IMD3. No version is clearly worse. Single takes, +/-1 dB.

## 9. Pitfalls found (and how they were handled)

1. Periodic synthetic speech makes envelope alignment ambiguous: use a chirp+pilot preamble, or (better) a method that needs no alignment.
2. A global clock-drift fit across the file is noisy; avoid.
3. A per-block waveform-correlation metric measures the radio's filter phase, not distortion. Discarded.
4. Equal digital peak is not equal RF peak; compare at equal received peak.
5. The preamble leaks into adjacent-band totals and sets the ALC readings, so the no-preamble `np_` files exist.
6. The FT-710 leakage floor (two-tone control about -54 dBc, scaling 1:1) limits what can be shown.
7. A receiver front end (AMP1) or RF gain changed between stages makes cross-stage absolute levels incomparable. Record the settings.
8. A nearby SWL radio feeds back; the FT-710 on switch leakage is the monitor instead.

## 10. Limits of what these tests show

Single recordings per cell (+/-1 dB); synthetic speech; one monitor radio on a leakage path; FT-710 floor limits IMD/spill claims to
about -35 to -47 dBc; 80 m only, one antenna; no calibrated spectrum analyser or wide RF capture; no listening test and no on-air A/B yet. To do
better: a notched-noise or transfer-function-compensated distortion test, a wide SDR capture of the RF output, repeat takes with a spread, and
listener reports on handset vs +12 vs +18.

## Where the files live

- **This write-up, the scripts and the test-signal generator**: `sdr-tests/cessb-rf/` in https://github.com/bbarclay7/ic7100-hex. The recordings are not in git (156 MB of WAV); the test signals regenerate from `gen.js`.
- **The panel being tested** (`ic7100ctl`, including the CESSB processor `ic7100ctl/web/cessb.js` that `gen.js` imports): the working copy
  `ic7100-remote/` in the same repo. It is a fork of **ukbodypilot/ic7100-remote** v0.2.1, https://github.com/ukbodypilot/ic7100-remote
  (MIT). Fixes are being sent upstream from https://github.com/bbarclay7/ic7100-remote.
- **CESSB reference** quoted in section 1: https://shop.rf.guru/pages/what-is-cessb. The all-pass Hilbert pair in `cessb.js` follows Olli
  Niemitalo's design (http://yehar.com/blog/?p=368).
- **Public KiwiSDR tools** used for earlier on-air listening (not part of this series): https://github.com/jks-prv/kiwiclient.

## Files

`gen.js` (signals), `play_tx.py` (key + play, on hex), `swr_check.py` (SWR/Po/ALC on a tone), `run_series.sh` (record + play), `np_analyze.py`
(analysis), `imd.py`, `analyze_rf.py`, `splatter.py` (first-stage analysis with chirp lock; superseded), recordings `h100_*`, `h100A_*`,
`h100B_*`, `lowg_*` (stage 4), `npA_*`, `npB_*` (stage 3), `rf*_`, `rf40_*` (stages 1-2).
