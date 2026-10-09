# Winlink Express + VARA FM on hex (Wine)

Notes for running Winlink Express and VARA FM on `hex` (Debian 13) under Wine.
Status as of 2026-10-07: install in progress, **nothing tested on the radio yet**.
Items marked (untested) have not been tried.

## Glossary

- **Wine**: runs Windows programs on Linux. It is not a virtual machine.
- **Prefix** (`WINEPREFIX`): the folder holding one fake Windows installation.
  Ours is `~/.wine-winlink` on hex. It contains the `C:` drive (`drive_c`), a
  fake registry (settings, license entries) and the Windows runtimes installed
  into it (.NET 4.8, VB6 runtime, VC++ runtime, fonts). Prefixes are
  independent, so a broken one can be deleted and rebuilt without touching
  anything else. Backing one up means copying its folder.
- **winetricks**: helper that installs Windows runtimes into a prefix.
- **32-bit prefix** (`WINEARCH=win32`): used because VARA and Winlink Express
  are 32-bit programs.

## Where things are

| What | Where |
|---|---|
| Prefix | `hex:~/.wine-winlink` |
| Winlink Express installer | `hamtop1` Downloads `Winlink_Express_install.exe`, copy on hex `/tmp/` |
| VARA FM installer | `VARA FM v4.4.0 setup.zip`, unzipped on hex in `/tmp/varafm/` |
| Install script and log | `hex:/tmp/wl-setup.sh`, `/tmp/wl-setup.log` (lost on reboot) |
| Existing Winlink mail (Windows host) | `hamtop1:/mnt/c/RMS Express/AK6MJ/` |
| Copy of that mail on the Mac | `backup/winlink-AK6MJ-20261007/` (private, never commit) |

Windows originals live in `C:\RMS Express`, `C:\VARA`, `C:\VARA FM` on the
Windows host, reached via `ssh hamtop1` (WSL).

## What was done on hex

1. `dpkg --add-architecture i386`; enabled Debian `contrib` in
   `/etc/apt/sources.list` (winetricks lives there).
2. `apt install wine wine32 winetricks cabextract` (Wine 10.0).
3. Created the prefix: `WINEPREFIX=~/.wine-winlink WINEARCH=win32 wineboot -i`.
4. Install script (needs a logged-in desktop, `DISPLAY=:0`):
   `winetricks -q corefonts vb6run vcrun2015 dotnet48`, then the silent
   Winlink Express install (`/VERYSILENT`), then VARA FM (`/SILENT`).
   `winetricks -q` is silent, so no windows appear. The .NET step is slow
   (10 to 20+ minutes).

## Running things

Always point Wine at the prefix:

    export WINEPREFIX=$HOME/.wine-winlink WINEARCH=win32 DISPLAY=:0
    wine "C:\\RMS Express\\RMS Express.exe"     # path to be confirmed after install
    wine "C:\\VARA FM\\VARAFM.exe"              # path to be confirmed after install

## Sharing the radio with the web panel

The panel (`ic7100ctl`) and Winlink cannot both own the CAT serial port and
the USB audio codec. Existing switch (it just stops/starts the service):

    radio-mode digital     # stops ic7100ctl, frees the radio for Wine
    radio-mode voice       # starts ic7100ctl again

Do not key the radio from Wine until the receive-only test below passes.

## VARA FM license

Enter your paid license in VARA FM yourself (do not paste the key into chat or
notes). To get the key into a field on hex: use the JetKVM "Paste text" button,
or connect with xrdp from Microsoft Remote Desktop over Tailscale (two-way
clipboard).

## udev and serial ports (for reproduction)

The radio exposes two CP2102 serial ports (vendor 10c4, product ea60), serials
`IC-7100 22001171 A` (CAT) and `... B` (spare). Their `ttyUSB` numbers are not
stable, so both get named symlinks in `/etc/udev/rules.d/99-ic7100.rules`:

    # CAT port: used by ic7100ctl (--device /dev/ic7100)
    SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", ATTRS{serial}=="IC-7100 22001171 A", SYMLINK+="ic7100", GROUP="dialout", MODE="0660"
    # B port: free for RTS/DTR keying from Wine/VARA, never used for CAT
    SUBSYSTEM=="tty", ATTRS{idVendor}=="10c4", ATTRS{idProduct}=="ea60", ATTRS{serial}=="IC-7100 22001171 B", SYMLINK+="ic7100-b", GROUP="dialout", MODE="0660"

Reload: `sudo udevadm control --reload && sudo udevadm trigger --subsystem-match=tty --action=add`
(the trigger does not restart `ic7100ctl`). The serial strings are specific to
this radio; read yours with `udevadm info -q property -n /dev/ttyUSB0 | grep ID_SERIAL`.
User `bb` was NOT in `dialout` until 2026-10-07 (`sudo usermod -aG dialout bb`); the
group applies from the next login. Without it Wine gets permission denied on the COM ports.

Wine COM ports (in the prefix, `~/.wine-winlink/dosdevices/`):

    com5 -> /dev/ic7100      # CAT (A)
    com6 -> /dev/ic7100-b    # spare (B), intended for RTS/DTR PTT
    (Wine auto-created these pointing at ttyUSB0/1; re-pointed 2026-10-07)

    ln -sfn /dev/ic7100 com5 && ln -sfn /dev/ic7100-b com6

Only one program may open the CAT port: stop the panel first with
`radio-mode digital` (stops `ic7100ctl`; user ran this at 00:46 on
2026-10-07); `radio-mode voice` restarts it.

PTT method for VARA FM: **CAT** (VARA FM, PTT dialog: CAT, COM5, Icom, IC-7100,
19200, CI-V address 88, RTS/DTR unchecked; VARA has the IC-7100 built in, no
command bytes to enter). Tested 2026-10-07 at radio power 1% on a clear 145 MHz
frequency: VARA FM's Tune button keyed the radio. COM6 (B port) not needed.

## Audio levels (field reference)

Wine reaches the codec through PulseAudio. `aumix` is obsolete (OSS) and does
not apply. In VARA FM's SoundCard window pick **PCM2901 Audio Codec Analog
Ster(eo)** for input and output. Avoid the "Monitor of ..." entries (output
loopbacks, flat) and the built-in sound chip.

The codec's Pulse names (confirm with `pactl list short sources` / `sinks`;
they can change if the codec is re-enumerated):

    SRC=alsa_input.usb-Burr-Brown_from_TI_USB_Audio_CODEC-00.analog-stereo
    SNK=alsa_output.usb-Burr-Brown_from_TI_USB_Audio_CODEC-00.analog-stereo

    pactl get-source-volume $SRC          # RX level (radio -> VARA)
    pactl set-source-volume $SRC 30%
    pactl set-sink-volume   $SNK 50%      # TX level (VARA -> radio)

Graphical: `pavucontrol` (Input Devices tab; may need `apt install pavucontrol`),
or `alsamixer -c N` for raw ALSA controls (card number can change).

Three places set levels; check them in this order when the VARA meter is
pegged or flat:
1. Radio: USB audio output level in the IC-7100 menu (name not confirmed).
2. hex: Pulse source volume (above). It started at 100% and pegged VARA FM's
   input meter on 2026-10-07; 30% was set as a first guess, not measured.
   hex runs PulseAudio with module-device-restore, so the level should be
   remembered across reboot/replug (not yet confirmed by a reboot test).
3. VARA FM: its own drive level in the SoundCard window.

Aim for the input meter peaking mid-scale with no clipping on strong signals.

## Winlink Express quirks and mail import (2026-10-07)

- **Toolbar wraps in a narrow window.** The "Open Session" pulldown (e.g.
  "Vara FM Winlink") drops to the second row at the left, leaving a gap beside
  the label. Widen or maximize the main window and it moves back.
- **VARA FM window can open black.** Winlink launches the VARA FM TNC itself
  (`C:\VARA FM\VaraFM.exe`, port 8300). The window may not repaint, but it
  works.
- **First on-air result:** a VARA FM Winlink session received mail from the
  RMS, so CAT PTT, audio and the session path work end to end.
- **Copy/paste:** Ctrl+C / Ctrl+V inside Wine apps; Wine shares the normal X
  clipboard, not the select-to-copy "primary" selection.
- **Mail import from the Windows host** (`hamtop1`, `C:\RMS Express\AK6MJ`):
  messages are plain `.mime` files in `Messages/` and `MessagesBackup/` with no
  folder index. Copy them additively with Winlink closed (`cp -n`), merge
  `Data/Mids Seen.txt` (so old mail is not re-downloaded), and do not copy
  settings or the registry. Beware macOS `._*` files when tarring from the Mac.
  A safety copy of the pre-import data is `~/winlink-AK6MJ-before-import.tgz` on hex.
  Backed-up mail is in `backup/winlink-AK6MJ-20261007/` (private).

## Test plan (before keying anything)

1. Winlink Express launches. (untested)
2. VARA FM starts. License accepted. (untested)
3. In VARA FM and Winlink: audio device = the USB codec ("USB Audio CODEC",
   08bb:2901), CAT serial = `/dev/ic7100` mapped to a Wine COM port. (untested)
4. Receive-only: listen to the radio's audio in VARA FM, check the waterfall. (untested)
5. Only with explicit go, on an agreed frequency: key briefly. (untested)

## Updates

- Winlink Express offers an update check on connect (untested under Wine).
  Otherwise run the new installer over the existing install; mail and
  settings stay.
- VARA FM has no auto-update. Run the new setup over the old one. License
  should persist.
- Back up the prefix before any update, and restore it if something breaks:

      tar czf ~/wine-winlink-$(date +%F).tgz -C ~ .wine-winlink
      # restore: rm -rf ~/.wine-winlink && tar xzf ~/wine-winlink-DATE.tgz -C ~

- Pin it like an appliance. Update only when Winlink requires a newer version
  to connect.

## Known noise

- `setupapi ... Unsupported style(s) 0x10` on first run, and
  `ifproxy_release_public_refs ... 0x800706be` during the .NET install, are
  harmless Wine messages.
- `no driver could be loaded` means there is no logged-in desktop. Log in at
  hex's screen first (it sits at the login greeter after a reboot).

## If it goes wrong

Delete and rebuild: `rm -rf ~/.wine-winlink`, then redo the steps above. The
fallback if Wine proves flaky is a Windows VM (QEMU/KVM with USB
passthrough), which handles frequent updates better but needs a Windows
license.
