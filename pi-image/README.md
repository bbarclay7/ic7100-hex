# Turnkey Raspberry Pi SD card

Builds an SD card for a Pi (Zero 2 W or better) that, on first boot, joins your
Wi-Fi and tailnet and runs `ic7100ctl serve --host 0.0.0.0 --audio` as a
systemd service. Built on a Mac; based on Raspberry Pi OS Lite arm64 (Trixie)
with cloud-init.

## Use it

1. `cp config.example config.env` and fill it in: SSH public key, Wi-Fi SSID and
   password, and a Tailscale auth key (admin console → Settings → Keys:
   single-use, short expiry).
2. Insert the SD card, find its disk with `diskutil list`, then run
   `./make-sd.sh /dev/diskN`. It refuses non-removable disks and asks you to type
   `yes` before erasing. Needs sudo for `dd`.
3. Put the card in the Pi and power it up. First boot takes ~5–10 min and needs
   working Wi-Fi (apt, pip and Tailscale all download). Then `ic7100` appears in
   your tailnet.
4. Browse to `https://ic7100.<tailnet>.ts.net/` (or `http://<pi-ip>:8080/` on the LAN).

`./make-sd.sh --render DIR` writes just the boot-partition files, for inspection.

## What first boot does

Joins Wi-Fi (power save off, to avoid audio jitter), creates your user (SSH key
only), installs the app into `/opt/ic7100ctl/venv`, enables the `ic7100ctl`
service (restarts every 5 s, so a radio that's off at boot is fine), installs
Tailscale with Tailscale SSH, runs `tailscale serve --bg 8080` (HTTPS, required
for browser mic/PTT), and enables ufw. Log: `/var/log/ic7100-firstboot.log`.

HTTPS must be enabled in the Tailscale admin console; if `tailscale serve`
failed, enable it and run `sudo tailscale serve --bg 8080`.

## Decisions made

- **LAN access: on** (`LAN_PANEL=yes`). The panel has no auth and can key the
  transmitter, so anyone on your Wi-Fi can use it. Set `LAN_PANEL=no` in
  `config.env` for tailnet-only (ufw then allows only SSH and `tailscale0`).
- **Serial port: autodetect.** Uses `/dev/ic7100` if the udev rule matches the
  radio's USB bridge, else `/dev/ttyUSB0`. The rule is unverified against a real
  IC-7100. If the service can't open the radio, check
  `journalctl -u ic7100ctl` and `lsusb`, and adjust `/etc/udev/rules.d/99-ic7100.rules`.
- **Recovery: re-flash.** If first boot fails (typically a wrong Wi-Fi password,
  so nothing installs), fix `config.env` and re-run `make-sd.sh`. Editing the
  card in place doesn't work once cloud-init has run.
- **Wi-Fi password stays in cleartext** in `network-config` on the card's boot
  partition. Accepted: anyone with physical access to the Pi can get it anyway.
  A lost or discarded card leaks it, so use a Wi-Fi password you don't reuse.
  The Tailscale auth key and source tarball are deleted after first boot.

`config.env` and `.cache/` are gitignored.
