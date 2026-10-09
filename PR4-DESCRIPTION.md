# PR 4 draft (not opened). Stacked on PR 3 -> PR 2 -> PR 1: open after those are merged, then rebase onto main. Branch: `pr4/hold-to-talk` (3 commits)

**Title:** PTT: hold-to-talk with a server watchdog, so the radio can never stay keyed

---

Follow-up to the earlier PRs. The panel's PTT button toggles the transmitter on each click, so a missed second click, a
closed tab or a dropped Wi-Fi link leaves the radio keyed. This makes PTT hold-to-talk, with a safety net on the server.
Three commits:

1. **Server: hold mode and a watchdog.** `{"cmd":"ptt","state":true,"hold":true}` keys the radio and sets a 1.5 s deadline.
   The page re-sends it every ~500 ms while the button is held; each one pushes the deadline out. A watchdog thread unkeys
   the radio if the deadline passes. Two details: a keepalive that arrives *after* the release never re-keys the radio,
   and a keepalive for an already-keyed radio sends nothing to it. A `ptt` command without `hold` behaves as before.
2. **Audio gate:** the browser's mic audio also flows while a hold-to-talk key is held (the key-down is a moment ahead of the
   radio reporting "transmitting"; a precaution I have not measured).
3. **Page:** the PTT button and the Space bar are hold-to-talk. Pointer up/cancel, losing pointer capture, window blur and a
   hidden tab all release. Requests go out strictly in order so a release cannot overtake the key-down. Space is ignored
   while typing in a field, auto-repeat is ignored, and it no longer scrolls the page. If the browser has no microphone it
   says why instead of keying a carrier with nothing on it.

## How I checked it

- Tests with the mock transport: a late keepalive sends no key frame; two hold commands send one key frame and the watchdog sends
  the unkey after the timeout; the gate follows the pending deadline. The new tests fail against the previous code.
- The page, in headless Chrome against this branch's files and a mock radio, logging what it sends: button held 1.3 s = one
  key-down, two keepalives, one release, then nothing; Space with auto-repeat = one key-down, keepalives, one release; window blur
  while keyed releases; Space inside a text field sends nothing.
- `pytest`: 67 passed, 4 skipped (tests that need `aiortc` or PyAV).
- **On the radio** (IC-7100, this exact branch, 3.758 MHz LSB at 10% power, DATA on with no audio so almost no RF goes out; each
  check keyed the transmitter for a few seconds): the hold command keyed the radio; with no keepalives the watchdog unkeyed it
  1.72 s after the key-down (timeout 1.5 s plus the 0.25 s tick); DATA mode was back to off afterwards; keepalives held it keyed
  for 3 s; the release unkeyed it within 0.4 s; and a late keepalive after the release did not re-key it.

## A note on how this was made

I used an AI coding assistant (Claude Code) to help investigate, write and test these changes. I ran every check on my own radio
and reviewed the code myself, but you should know that AI assistance was part of it.

73, Brandon AK6MJ
