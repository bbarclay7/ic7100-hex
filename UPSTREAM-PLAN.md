# Staging the upstream pull requests (plan only; nothing has been forked, pushed or opened)

Upstream: https://github.com/ukbodypilot/ic7100-remote (v0.2.1). Its contributing note welcomes bug fixes, opcode
corrections, docs and UI tightening, IC-7100 only. Strategy: small, evidence-backed, easily reviewed PRs first;
opinionated features only after the earlier ones are accepted. Each PR is a branch **stacked on the previous**
in `~/aiwork/ic7100-remote-upstream` (local clone, identity `Brandon Barclay (AK6MJ) <ak6mj@w7avm.org>`),
with the full test suite green on every branch.

## Order

| # | PR | Contents | Why this order | Evidence |
|---|---|---|---|---|
| 1 | **Opcode fixes + docs** (built: branch `pr1/tone-and-meters`, 4 commits, patches in `patches/pr1/`; the older 5-commit branch `fix/tone-tx-meters-docs` is kept as a backup) | CTCSS tone as 3 BCD bytes (set and get), TONE `16 42` / TSQL `16 43` swapped in code, TX meters only while transmitting, docs: memory banks A-E exist, CTCSS layout. **The Po-peak sampling commit was taken out (2026-10-08): a matched side-by-side did not show a clear improvement; revisit with better evidence.** | Clear bugs, small, verifiable on any IC-7100 | Each verified on the radio (see `CHANGES.md` items 1-5, 8) |
| 2 | **Audio robustness** | `aplay`/`arecord` respawn after a USB unplug (new), non-blocking playback queue + writer thread, mic audio only forwarded while keyed, `input_active` reflects real mic frames, "RX only, NO MIC" warning on http | Real, reproducible faults: silent TX after unplug, garbled/stopped RX audio | `tests/test_audio.py` fails on v0.2.1, passes here; killed processes on hex recovered in <6 s; `FINDINGS-2026-10-08.md` |
| 3 | **TX diagnostics** | One `[tx]` log line per transmission (settings, Po/ALC/SWR peaks, mic frames, mic name and peak level, warning when no audio reached the radio); quiet logging when the radio is off | Needed to debug 1-2 in the field; no behaviour change | Used throughout the session |
| 4 | **Hold-to-talk PTT** | Keepalive PTT with server watchdog, ordered requests, Space bar | Safety-relevant (stuck transmit); needs the careful review it will get after 1-3 | Mock-transport tests; used on the radio |
| 5 | **Memory banks, RF gain, extra meters** | Bank select/read, name labels, active-channel inference, RF gain, COMP/Vd/Id meters with Hamlib calibration, radio speech-compressor controls | Feature work, IC-7100 specific | `CHANGES.md` 2.1, item 16; opcodes verified on the radio |
| 6 | **Head-unit layout** (optional, large) | New `/` layout, old one kept at `/classic` | Biggest and most subjective: offer as an option, not a replacement | Screenshots; headless Chrome checks |
| 7 | **Browser mic chain** (optional) | Level, compressor, soft clip, mic selector with "in use" display, silent-mic warning, CESSB, FM pre-emphasis | Most opinionated; benefits measured at 100 W (+3.3 dB average power) | `FINDINGS-2026-10-08.md` |

Did anything from 2026-10-07/08 belong in PR 1? Not under its scope (opcode, meter and doc fixes). The audio respawn is the strongest
bugfix candidate but is built on PR 2's writer thread, so it goes right after PR 1, not inside it. Small loose items to place:
`Cache-Control: no-cache` on static files (PR 3), `input_active` no longer hard-coded False (PR 2). Possible follow-up: SWR is only sampled
every few TX cycles, so a short transmit can read 0 on a mismatched antenna (seen during the remote-tuner retune); sample it more often.

PRs 1 and 2 are small and easy to review, so they go first. Once 1 has had a response, send 2 and 3 together or one after the other.

## Open decisions already made
- Keep the old status keys as aliases while the new `tone_on`/`tsql_on` names appear (no break for other clients).
- Disclose AI assistance in each PR description (user's choice). No `Co-Authored-By` lines in commit messages (user rule).
- Submit as GitHub user `bbarclay7`; add `ak6mj@w7avm.org` as a verified email on that account first.

## PR 1 verified on the radio (2026-10-08)
The branch's own code (exported with `git archive`, run from a separate folder on hex with the production panel paused) passed on the IC-7100:
tone setter write/read-back (100.0 and 88.5 Hz, 3 BCD bytes), TONE on -> TSQL off, TSQL on, both off, TX meters read 0 while not transmitting,
old status key aliases present; branch unit tests 47 passed, 2 skipped. All 27 radio settings compared before/after: no differences.
Not yet verified on the radio: the Po peak sampling commit (needs a transmission).

## Before any of it goes out (needs the user's explicit go each time)
1. Test the **branch's own code** on the radio (stop the production panel for about five minutes, run the branch on another port), since the working copy has diverged from the branch.
2. Fork `ukbodypilot/ic7100-remote` under `bbarclay7`.
3. Push the branch, open PR 1 with a short description: what was wrong, the hardware evidence, the tests, and the AI-assistance disclosure.

## Work needed to cut PRs 2-7
The working copy (`ic7100-remote/`) is not a git checkout, and `panel.js`/`server.py`/`radio.py` mix several features, so each
PR has to be assembled by hand as a branch on the previous one, running the full tests on each. The Python side
splits cleanly (audio.py, webrtc.py, civ.py are almost entirely PR 2/3 material). The UI files are intertwined
and are the hardest to split, which is another reason to send the UI work last and possibly as a single optional PR.

## Stale-meter evidence (2026-10-08 22:2x)
Voice transmits on 3.758 MHz LSB, sampler at 5 Hz: original v0.2.1 kept ALC=18 after unkey (run A), zeros in a second run (A2); the branch zeros at once both times. Po peak: matched loud runs gave non-zero Po in 8/23 samples (original, max 76) vs 11/25 (branch, max 51): no clear difference, so that commit is deferred.

## PR 2 built locally (2026-10-08 late)
Branch `pr2/audio-robustness` (4 commits stacked on PR 1; patches in `patches/pr2/`, draft in `PR2-DESCRIPTION.md`): non-blocking playback, mic gate while keyed, respawn after codec loss, real `input_active` + 'RX only, NO MIC'. Each new test fails on the previous code. Not pushed. Open it after PR 1 is merged (rebase onto main), or ask the user if they want it earlier as a stacked PR.

## PR 3 built locally and pushed to the fork only (2026-10-08 late)
Branch `pr3/tx-diagnostics` (4 commits stacked on `pr2/audio-robustness`; patches `patches/pr3/`, draft `PR3-DESCRIPTION.md`): `[tx]` log line, mic-audio part of it (DATA mode only), quiet logging + `radio_responding`, `Cache-Control: no-cache`. PR 2 and PR 3 branches are on `bbarclay7/ic7100-remote` (no PRs opened). Only PR 1 is open upstream.

## PR 4 built locally and pushed to the fork only (2026-10-08 late)
Branch `pr4/hold-to-talk` (3 commits stacked on `pr3/tx-diagnostics`; patches `patches/pr4/`, draft `PR4-DESCRIPTION.md`): server hold mode + watchdog, audio gate while held, hold-to-talk button/Space. Page behaviour verified in headless Chrome; NOT yet exercised on the radio (needs a keyed test: watchdog unkey timing).

PR 4 verified on the radio (2026-10-08 late): this exact branch, LSB 3.758 at 10%, DATA on with no audio: hold keys (0.23 s), watchdog unkeys 1.72 s after the key-down with no keepalives, DATA restored, keepalives hold 3 s, release unkeys <0.4 s, a late keepalive does not re-key. Description updated.
