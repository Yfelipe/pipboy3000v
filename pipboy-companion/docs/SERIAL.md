# Serial protocol notes

Learned from the real device. Read this before changing `public/js/serial/`.

- Each command is one line: `\x10print("< << "+JSON.stringify({requestId,kind,value})+" >> >")`.
  `\x10` turns off echo for that line, and replies are matched to requests by `requestId`.
- **The Pip-Boy sends its output one ~63-byte USB packet per line it runs.** A bare newline
  doesn't run anything. Without a fix, replies arrived late or cut off, and the strict
  request-ID check (correctly) discarded them. The fake device models this with `packetPerLine`.
  - *Release mode (default):* each command is written together with as many `\x10print("")`
    lines (side-effect-free) as its reply needs packets. More are sent every 100 ms until the
    reply is complete.
  - *Timer mode:* right after connecting, a one-off probe checks whether a device timer
    firing also sends a packet. If it does, each command starts a short 2 ms device interval
    that drains the reply. That's about 10× faster on the fake device. The probe result is
    logged ("Wake probe: …").
- Writes go out at full USB speed. The Espruino IDE's 19-byte/50 ms "slow write" is meant for
  Bluetooth LE; pass `new SerialSession({ writeChunk: 19, writePauseMs: 50 })` for a slow link.
- Each completed device operation logs its duration and serial throughput.
- **Sleep:** the Pip-Boy sleeps after `settings.idleTimeout` (2 min on the test device) without a
  knob or button press, and serial traffic doesn't count. Asleep, it only answers slowly
  (release mode) and eventually not at all. While connected, the app calls
  `Pip.kickIdleTimer()` every 30 s (added to a command, or as a keep-alive when idle). It logs
  `Pip-Boy state: sleeping=… USB power=… idleTimeout=…` at connect. **Wake Pip-Boy** calls the
  power-button handler only if the firmware reports it is asleep, because the same handler
  switches an awake Pip-Boy off.
- Release commands are topped up only when a reply has stalled, with a per-transfer cap.
  Topping up on a timer used to snowball on a slow device and flood its input queue.
- Board-check request IDs, stale frames (with the ID that was expected and the one received),
  late replies, and a raw-output snapshot on any failure are written to `data/activity.jsonl`.
