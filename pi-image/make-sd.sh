#!/usr/bin/env bash
# Flash Raspberry Pi OS Lite (Trixie, arm64) to an SD card and drop in
# cloud-init config so first boot installs ic7100ctl + Tailscale unattended.
#   ./make-sd.sh /dev/diskN        flash + customize (asks first; needs sudo)
#   ./make-sd.sh --render DIR      only write the boot-partition files to DIR
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
URL=https://downloads.raspberrypi.com/raspios_lite_arm64_latest
IMG_XZ="$HERE/.cache/raspios-lite-arm64.img.xz"

[ -f "$HERE/config.env" ] || { echo "copy config.example to config.env and fill it in"; exit 1; }
. "$HERE/config.env"
: "${PI_HOSTNAME:?}" "${PI_USER:?}" "${PI_SSH_PUBKEY:?}" "${WIFI_SSID:?}" "${WIFI_PSK:?}" \
  "${WIFI_COUNTRY:?}" "${TIMEZONE:?}" "${TS_AUTHKEY:?}" "${LAN_PANEL:=no}"

render() {  # $1 = output dir (the boot partition)
  local d="$1"
  cat > "$d/user-data" <<UD
#cloud-config
hostname: $PI_HOSTNAME
timezone: $TIMEZONE
ssh_pwauth: false
users:
- name: $PI_USER
  groups: [sudo, dialout, audio]
  shell: /bin/bash
  sudo: ALL=(ALL) NOPASSWD:ALL
  lock_passwd: true
  ssh_authorized_keys:
  - $PI_SSH_PUBKEY
runcmd:
- [bash, /boot/firmware/ic7100-firstboot.sh]
UD
  cat > "$d/network-config" <<NC
network:
  version: 2
  wifis:
    wlan0:
      dhcp4: true
      optional: false
      regulatory-domain: $WIFI_COUNTRY
      access-points:
        "$WIFI_SSID":
          password: "$WIFI_PSK"
NC
  cat > "$d/ic7100-firstboot.env" <<EV
PI_USER="$PI_USER"
PI_HOSTNAME="$PI_HOSTNAME"
TS_AUTHKEY="$TS_AUTHKEY"
LAN_PANEL="$LAN_PANEL"
EV
  cp "$HERE/firstboot.sh" "$d/ic7100-firstboot.sh"
  COPYFILE_DISABLE=1 tar czf "$d/ic7100ctl-src.tar.gz" -C "$HERE/../ic7100-remote" \
    --exclude=__pycache__ --exclude=.git --exclude=tests .
}

if [ "${1:-}" = --render ]; then
  mkdir -p "$2"; render "$2"; echo "rendered to $2"; exit 0
fi

DISK="${1:?usage: make-sd.sh /dev/diskN | --render DIR}"
diskutil info "$DISK" | grep -q "Removable Media:.*Removable\|Device Location:.*External" \
  || { echo "$DISK doesn't look external/removable; refusing"; exit 1; }
diskutil list "$DISK"
read -r -p "ERASE $DISK and write the image? type 'yes': " ok
[ "$ok" = yes ] || exit 1

mkdir -p "$HERE/.cache"
[ -f "$IMG_XZ" ] || curl -L -o "$IMG_XZ" "$URL"
diskutil unmountDisk "$DISK"
xz -dc "$IMG_XZ" | sudo dd of="${DISK/disk/rdisk}" bs=4m
sleep 3; diskutil mountDisk "$DISK" >/dev/null
BOOT=/Volumes/bootfs
[ -d "$BOOT" ] || { echo "bootfs didn't mount"; exit 1; }
render "$BOOT"
diskutil eject "$DISK"
echo "Done. Insert in the Pi; first boot takes ~5-10 min, then check your tailnet for '$PI_HOSTNAME'."
