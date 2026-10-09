# ic7100-remote (local workspace)

Remote control of an Icom IC-7100 from a Raspberry Pi at the radio, over Tailscale.

| Dir | What |
|---|---|
| `ic7100-remote/` | Upstream clone of <https://github.com/ukbodypilot/ic7100-remote> (the `ic7100ctl` web panel). Unmodified. |
| `pi-image/` | Ours. Builds a turnkey SD card (Wi-Fi, Tailscale, `ic7100ctl` service) from a Mac. See [`pi-image/README.md`](pi-image/README.md). |
| `sd-build/` | Scratch: a downloaded Pi OS image. Safe to delete. |

Quick start: `cd pi-image && cp config.example config.env`, edit it, then
`./make-sd.sh /dev/diskN`. Details and design decisions are in `pi-image/README.md`.

Hardware choice: a Pi Zero 2 W is enough (CI-V plus one Opus stream each way, no
DSP). Use 5 GHz Wi-Fi or a Pi 4 if the 2.4 GHz link is marginal.
