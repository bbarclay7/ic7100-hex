#!/bin/bash
# Runs once as root from cloud-init. Log: /var/log/ic7100-firstboot.log
set -euxo pipefail
exec > >(tee -a /var/log/ic7100-firstboot.log) 2>&1
B=/boot/firmware
. $B/ic7100-firstboot.env
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y python3-venv alsa-utils ufw curl

# App
mkdir -p /opt/ic7100ctl
tar xzf $B/ic7100ctl-src.tar.gz -C /opt/ic7100ctl
python3 -m venv /opt/ic7100ctl/venv
/opt/ic7100ctl/venv/bin/pip install "/opt/ic7100ctl[audio]"
cp /opt/ic7100ctl/udev/99-ic7100.rules /etc/udev/rules.d/
udevadm control --reload

cat > /etc/systemd/system/ic7100ctl.service <<UNIT
[Unit]
Description=IC-7100 web control panel
After=network-online.target sound.target

[Service]
User=$PI_USER
SupplementaryGroups=dialout audio
ExecStart=/opt/ic7100ctl/venv/bin/ic7100ctl serve --host 0.0.0.0 --port 8080 --audio
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now ic7100ctl

# Wi-Fi power save causes audio jitter
cat > /etc/NetworkManager/conf.d/wifi-powersave.conf <<NM
[connection]
wifi.powersave = 2
NM

# Tailscale (+ HTTPS front, needed for browser mic access)
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey="$TS_AUTHKEY" --hostname="$PI_HOSTNAME" --ssh
tailscale serve --bg 8080 || echo "tailscale serve failed: enable HTTPS in the tailnet admin console, then run: sudo tailscale serve --bg 8080"

# Firewall: ssh + tailnet always; panel on LAN only if asked
ufw default deny incoming
ufw allow 22/tcp
ufw allow in on tailscale0
[ "$LAN_PANEL" = yes ] && ufw allow 8080/tcp
ufw --force enable

# Scrub secrets from the (world-readable) FAT partition
rm -f $B/ic7100-firstboot.env $B/ic7100ctl-src.tar.gz
echo "ic7100 firstboot done"
