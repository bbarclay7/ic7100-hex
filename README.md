# ic7100-hex

Remote control of an Icom IC-7100 through a browser panel, running on a small Linux computer next to the radio and reached over Tailscale. Mine is an Intel NUC running Debian (called `hex`); the upstream project targets a Raspberry Pi, and this should run on one too, but I have not tried it. It is a customised copy of ukbodypilot's [ic7100-remote](https://github.com/ukbodypilot/ic7100-remote) (the `ic7100ctl` web panel), plus the notes and test scripts from improving it.

The aim is a panel I can trust for working nets from away: the transmit side (mic handling, diagnostics, CESSB, FM pre-emphasis), the receive meters, power on/off, memory channels, and a phone layout.

| Path | What |
|---|---|
| `ic7100-remote/` | The `ic7100ctl` panel, based on upstream v0.2.1 **with local changes** (see [`CHANGES.md`](CHANGES.md)). Fixes that suit upstream are sent there as pull requests ([`UPSTREAM-PLAN.md`](UPSTREAM-PLAN.md)). |
| `sdr-tests/cessb-rf/` | How the CESSB / transmit-distortion tests were done, with scripts: start at [`METHOD.md`](sdr-tests/cessb-rf/METHOD.md). |
| `FINDINGS-2026-10-08.md` | What the RF tests showed (ALC knee, IMD, CESSB gain, no extra splatter found down to about -43 dBc). |
| `FINDINGS-2026-10-17.md` | A bug in the transmit audio path (a 48 Hz gap in every frame) and how it was found. |
| `UI-PHONE-LAYOUT.md` | Requirements and decisions for the phone layout. |
| `WINE_README.md` | Winlink Express and VARA FM under Wine on the same machine (they share the radio with the panel, never at the same time). |
| `pi-image/` | A Raspberry Pi SD-card builder (Wi-Fi, Tailscale, the `ic7100ctl` service). Written but **not tested on hardware**, and not what I run; shelved for now. |
| `radio-set`, `Makefile` | Small helpers for the host. |

## Status

In daily use on one IC-7100. The panel has been used on real nets; the browser transmit path had a bug that made every transmission buzz, fixed 2026-10-17 (upstream pull request [#2](https://github.com/ukbodypilot/ic7100-remote/pull/2)).

## Caveats

- Tested on one radio, one host and a handful of browsers (Firefox on a Mac, Safari on an iPhone). Expect rough edges.
- The measurements are a hobbyist rig (a second receiver on coax-switch leakage), good for comparing settings, not a calibrated lab.
- Private data (Winlink mail backups) is kept out of this repository.

## About how this was made

The work was done with an AI coding assistant (Claude Code), with me at the radios, deciding, listening and keying. Commit messages carry no attribution; this paragraph is the disclosure.

73, Brandon AK6MJ
