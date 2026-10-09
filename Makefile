.DEFAULT_GOAL := help
.PHONY: help config render disks sd clean

help:
	@echo "Build a turnkey Raspberry Pi SD card for ic7100ctl (run from a Mac)."
	@echo
	@echo "First time:"
	@echo "  1. make config     create pi-image/config.env from the example"
	@echo "  2. edit pi-image/config.env (SSH pubkey, Wi-Fi, Tailscale auth key)"
	@echo "  3. make render     optional dry run: write the boot files to ./build, flash nothing"
	@echo "  4. make disks      list external disks; find your SD card (/dev/diskN)"
	@echo "  5. make sd DISK=/dev/diskN   ERASE the card, flash Pi OS, add our config"
	@echo
	@echo "Other:"
	@echo "  make clean         delete ./build, ./sd-build and the cached OS image"
	@echo
	@echo "Re-flash after any config change or failed first boot. See pi-image/README.md."

config:
	@test -f pi-image/config.env && echo "pi-image/config.env already exists" \
	  || { cp pi-image/config.example pi-image/config.env; \
	       echo "created pi-image/config.env: edit it before 'make render' or 'make sd'"; }

render:
	pi-image/make-sd.sh --render build

disks:
	diskutil list external physical

sd:
	@test -n "$(DISK)" || { echo "usage: make sd DISK=/dev/diskN  (see 'make disks')"; exit 1; }
	pi-image/make-sd.sh $(DISK)

clean:
	rm -rf build sd-build pi-image/.cache
