#!/bin/bash
# Record one transmission: FT-710 recorder on hamtop1 (Windows ffmpeg, dshow) + keyed playback on hex.
# usage: run_series.sh TAG SECONDS NAME...   (NAME = file /tmp/NAME.wav on hex; MAX_PCT env = power ceiling, default 40)
# Output: ./TAG_NAME.wav. Panel on hex must be paused first: ssh hex radio-mode digital
tag=$1; secs=$2; shift 2; MAX=${MAX_PCT:-40}
for name in "$@"; do
 (ssh -o BatchMode=yes hamtop1 "cd /mnt/c/Users/admin/hamtools && ./ffmpeg.exe -hide_banner -loglevel error -y -f dshow -i \"audio=FT710 Microphone (USB Audio Device)\" -t $secs -ac 1 -ar 48000 ${tag}_$name.wav" < /dev/null &)
 sleep 3
 echo "$name: $(ssh -o BatchMode=yes bb@192.168.8.183 "/opt/ic7100ctl/venv/bin/python /tmp/play_tx.py /tmp/$name.wav $MAX 2>&1 | grep -E 'done:|refusing|No such'" < /dev/null)"
 sleep $((secs - 3))
done
sleep 6   # let the last recording finish BEFORE copying (copying early gives a truncated file)
scp -q "hamtop1:/mnt/c/Users/admin/hamtools/${tag}_*.wav" .
