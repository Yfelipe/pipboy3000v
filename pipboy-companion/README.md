# Pip-Boy Companion

A local companion station for the **Pip-Boy 3000 Mark V**. Connect the Pip-Boy over USB (Web
Serial) to install apps in one click, manage Storage and SD-card files, back up and restore, and
make complete copies for the emulator. It also keeps radio presets, a settings profile, workspace
files and an activity log on your computer.

No dependencies: plain Node.js on the backend, plain ES modules in the browser, no build step.

## Quick start

Requirements: **Node.js 22+**. To connect a Pip-Boy, **Chrome or Edge**.

```bash
npm start            # http://localhost:8077
npm run dev          # same, restarts when server files change
npm run vendor       # optional: keep the icon library on this computer instead of a CDN
```

Open <http://localhost:8077>. Web Serial needs a secure context, and `localhost` counts as one,
so connecting works without HTTPS.

| Setting | Default | Env var |
| --- | --- | --- |
| Port | `8077` | `PORT` |
| Bind address | `127.0.0.1` (this machine only) | `HOST` |
| Data folder | `./data` | `PIPBOY_DATA_DIR` |

## Where your data lives

Everything is plain files in `data/` (git-ignored). Copy the folder to back it up.

```
data/
├── records.json      apps, FM presets, settings profile (atomic writes)
├── activity.jsonl    activity log, newest 5,000 entries
├── workspace/        SD-card staging files, kept between sessions
└── dumps/<id>/       full device dumps (see below)
```

## Full device dumps (for emulation and local dev)

**Backup & restore → Complete copy** saves a byte-exact snapshot of the Pip-Boy:

```
data/dumps/pipboy-2026-11-08-01-30-00-ab12/
├── device.json       process.env, version, memory, flags, Storage stats, and
│                     globalShapes: every global with its methods / prototype methods
├── storage/          every Storage file, including system files; names that aren't
│                     filesystem-safe are %-encoded (".boot0" -> "%2Eboot0", "log\x01" -> "log%01")
├── sd/               the SD card tree, with files up to the size limit
└── manifest.json     written last: index of everything, sizes, checksums, skipped
                      large SD files, and errors. No manifest means the dump is incomplete.
```

Serial runs at about 3 KB/s, so large SD media is listed in the manifest (`skipped`) rather than
downloaded. Copy those files from the card with a card reader into `sd/` at the same paths.

To run a dump, open the **Emulator** (`/emulator/`, see [emulator/README.md](emulator/README.md)):
it boots the device's own firmware from the dump in a WebAssembly build of Espruino.

Long dumps can be interrupted. `manifest.json` is always written, with `complete: false` and an
`aborted` reason if the dump stopped. **Resume** in the dump list continues from there and skips
files that are already saved. If a transfer times out, the app checks the Pip-Boy is still
answering: it retries the file once if so, and stops (rather than timing out file after file) if not.
Files that operating systems put on the card (`.DS_Store`, `._*`, `System Volume Information`, …)
are skipped and listed under `sd.osJunkSkipped`.

If `records.json` is ever unreadable, it's renamed to `records.json.corrupt-<timestamp>` and
a fresh one is started. Nothing is silently thrown away.

## Pip-Boy Storage space

The Pip-Boy keeps Storage in a single 128 KB flash page, and the stock firmware's `.bootcde`
fills about 103 KB of it. Deleting a file only marks its space as unused: Espruino can only
compact Storage with a buffer the size of the page, which the Pip-Boy doesn't have while the
firmware is installed. So after deleting or replacing an app, writes fail with
`Unable to find or create file` even though the file list looks smaller.

**Free up space** (Home, Files › Storage, or Backup & restore) gets that space back:

1. It backs up every file with checksums, downloads the backup and keeps a copy in the workspace
   (listed on the Backup page for one-click restore).
2. It stops the firmware with `reset()`, because the firmware runs straight from Storage.
3. It erases Storage and writes every file back, checking each one.
4. It restarts the Pip-Boy and reconnects.

Installing an app does this by itself when there isn't room (after asking). **Restore** works the
same way. `test/storage-rebuild.test.js` runs this against the firmware build in the emulator,
which reproduces the device's single-page Storage.

## Using the dashboard

The sidebar has three groups: **Pip-Boy** (needs the device), **Companion** (works offline) and
**Help & tools**. The top bar always shows the connection, with Connect / Disconnect (and Wake
when the Pip-Boy is asleep). Any button that needs the Pip-Boy connects first if necessary.

Each device task runs as one job: a panel lists its steps with progress, it can be cancelled
between steps, and a failure is explained in plain words (with the technical detail one click
away). Deleting, overwriting, erasing and restoring always ask first.

- **Apps**: the catalog in `apps/index.json`. **Install** copies the app to Storage, adds its
  launcher to `USER/` on the SD card so it shows in **INV › APPS**, frees up space first if
  needed, and offers to restart. **Remove** deletes both. **Try in emulator** opens
  `/emulator/?app=<id>`. You can also install your own `.js` file the same way. Both apps also
  have the extensions' features (FM radio presets, INV › REMOTE, DATA › NOTES and INBOX, message
  pop-ups) in a small extras file that goes on the SD card with them and runs from RAM, so it
  costs no Storage: with Pip-OS 1.33 only about 33 KB of Storage is left for everything else.
  **Open at power-on** (on any installed app) writes a small `.bootPowerOn` so the app opens
  instead of the stock interface whenever the Pip-Boy powers on or restarts. `.bootPowerOn` only
  runs on a real start, not on `load()`, so the apps' power button and *Return to stock UI*
  (both `load()`) reach the stock interface. Holding the torch button while it starts skips the
  app. A `.bootPowerOn` the dashboard didn't write is left alone.
- **Files**: Storage and SD card tabs. Every row has its own Download / Delete; uploads start as
  soon as you pick the files.
- **ID, lists & notes** (Pip-OS 1.33): make the INV › ID card (our own card design, with your
  photo), edit the DATA › LISTS checklists (loading first keeps what was ticked on the Pip-Boy;
  sending asks before replacing lists that changed there), and turn any picture into the
  DATA › FEEDS user image. Files go to `USER/` on the SD card in the firmware's formats
  (raw 2 bit greyscale `IDCARD.img` 400×300 and `USERIMG.img` 400×248, `customLists.json`).
  **Notes** loads the `NOTES` folder, edits, renames (the title is the file name) and deletes
  notes for the Notes extension.
- **Pip-Boy settings**: the firmware's own `settings.json`: who it's assigned to, screen
  timeout, 12/24-hour clock, time zone, what the mode dial does between positions
  (`fallbackMode`, Pip-OS 1.32), the clock calibration (1.33), and setting the clock to the
  computer's time. Saved live through the firmware's `saveSettings()` when the stock interface runs.
- **Extensions** (on the Apps page): add screens to the stock Pip-OS instead of replacing it.
  Each is a Storage file `ext.<id>.js`, run by a small loader the dashboard installs as `.boot0`
  (`apps/extensions/loader.js`): Espruino runs `.boot0` before Pip-OS, and the loader runs the
  extensions from the `init` event once Pip-OS has loaded (Pip-OS clears timers when it starts).
  Holding the torch button while the Pip-Boy starts skips them. A Pip-OS update erases Storage,
  extensions included. The catalog:
  - **Media remote** (INV › REMOTE): the Pip-Boy becomes USB media keys for the computer it's
    plugged into. Wheel: volume; wheel press: play/pause; thumbwheel: previous/next track;
    PLAY: mute. It's a USB keyboard + consumer-control device next to the serial port, so the
    dashboard keeps working, and the stock EXT TERMINAL shares its keyboard part. The computer
    only sees it after the USB cable is unplugged and plugged back in, and the screen says so.
  - **Radio presets** (RADIO): the stations saved on the Radio presets page
    (`companion-radio.json` in Storage) appear in the radio menu and tune with one press.
  - **Notes** (DATA › NOTES): reads `NOTES/*.txt` on the SD card, with a scrolling viewer.
    Write and edit them on **ID, lists & notes**.
  - **Inbox** (STAT › INBOX): the messages sent from Home.

  The dashboard installs minified copies (`apps/extensions/min/`, made by `npm run apps:build`
  with the apps). Loader 2 also scrolls the tab header when extensions add more entries than fit. When an older
  loader is on the Pip-Boy the Apps page offers to update it.
- **Messages** (Home): pop up over whatever the stock interface shows, and are kept in
  `USER/MESSAGES.json` for the Inbox. The Pip-Boy's fonts are ASCII, so accents and smart quotes
  are folded first.
- **Display colour** (Pip-Boy settings): presets or any colour for the stock interface, with a
  scanline preview. The palettes are computed on the device exactly as DATA › MAINTENANCE ›
  Display color does, and Mojave UI and PIP-OS X follow them with their PIP-BOY theme.
- **Clock sync**: each time the Pip-Boy connects, its clock is set to the computer's if it's more
  than 3 seconds out (can be turned off on the Pip-Boy settings page).
- **SD card space** on Files › SD card (Espruino 2v29's `fs.getFree`).
- **Dashboard theme** (the palette button in the top bar): Fallout themes (Pip-Boy 3000 Mk V
  green, Fallout 4, Fallout: New Vegas, The Glow, Vault-Tec, Nuka-Cola, Nuka-Cola Quantum,
  Institute, Brotherhood of Steel), your own colour (every shade is mixed from it), or your
  Pip-Boy's screen colour once the Pip-Boy settings page has read it, and scanlines on or off.
  Kept in this browser; the emulator page follows it. Themes are CSS (`public/css/themes.css`):
  a theme sets a few base colours and the rest are mixed from them with `color-mix()`.
- **Backup & restore**: back up now, restore from the list or a file, free up space, complete
  copies, and the companion data export/import.
- **Diagnostics**: port choice, connection test, console recovery, raw serial output and the
  live status JSON for automation.

## Project layout

```
server/                 Node HTTP server (no framework)
  index.js              entry point
  app.js                routes, security headers, Host/Origin checks
  static.js             static files with path-traversal protection
  storage/records.js    record store (validation, limits, atomic import)
  storage/files.js      workspace file store (streamed uploads, size limit)
  storage/activity.js   bounded JSON-lines activity log
shared/validate.js      validation rules used by both browser and server
public/                 frontend (served as-is)
  index.html, css/app.css
  js/main.js            navigation + page wiring
  js/api.js             fetch client
  js/records.js         record cache
  js/activity.js        bounded log, batched to the server
  js/pages/*.js         one module per page
  js/serial/protocol.js REPL framing, error detection, device expressions (pure)
  js/serial/session.js  Web Serial session: reader, serialized writer, transactions
  js/serial/device-ops.js Storage / SD operations with checksums
test/                   node:test suites + a fake Espruino device
apps/                   Pip-Boy apps (apps/index.json lists them for the emulator)
  mojave/               Mojave UI: a season 2 / New Vegas style interface — see apps/mojave/README.md
  pipos-x/              PIP-OS X: a futuristic concept interface — see apps/pipos-x/README.md
  contact-sheet.mjs     renders every page of an app in the emulator into one PNG
emulator/               Espruino in WebAssembly (generic + Pip-Boy) — see emulator/README.md
  index.html, web/      the emulator page, served at /emulator/
  runtime/              host: Espruino class, WASI on an in-memory SD card, board profiles
  dist/                 prebuilt firmware (.wasm); rebuild with emulator/build.sh
  espruino/             board files, target code and patches applied to the Espruino source
  cli.js                REPL in a terminal: node emulator/cli.js
```

## API

All JSON unless noted. Writes require `Content-Type: application/json` (except file uploads).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | server status |
| GET | `/api/records[?kind=app\|radio\|settings]` | list records |
| POST | `/api/records` | create app / radio preset |
| PATCH | `/api/records/:id` | rename / change payload |
| DELETE | `/api/records/:id` | remove |
| GET / PUT | `/api/settings` | read / upsert the single settings profile |
| GET | `/api/backup` | download a backup (v2) |
| POST | `/api/backup/preview` | validate a backup and summarise it |
| POST | `/api/backup/import` | import (all-or-nothing) |
| GET | `/api/files` | list workspace files |
| PUT | `/api/files/:name[?overwrite=1]` | upload raw bytes |
| GET / DELETE | `/api/files/:name` | download / delete |
| GET / POST / DELETE | `/api/logs` | read / append / clear the activity log |
| GET / POST | `/api/dumps` | list dumps / start a new dump folder |
| PUT / GET | `/api/dumps/:id/files/<path>` | write / read a file inside a dump (segments URL-encoded) |
| DELETE | `/api/dumps/:id` | delete a dump |

## Tests

```bash
npm test             # unit + integration + emulator (≈150 tests, a few seconds)
npm run test:e2e     # browser tests (needs Playwright, skipped if missing)
npm run test:all
```

To enable the browser tests: `npm i -D playwright && npx playwright install chromium`.

`test/support/fake-espruino.js` is a fake Pip-Boy that evaluates the exact REPL lines the app
sends against a model of Espruino `Storage` (including its "size is fixed by the first write"
rule) and `fs`. That's how the serial code is tested without hardware. The browser tests inject
a similar fake as `navigator.serial`.

## Serial protocol notes (learned from the real device)

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

## Security notes

- The server binds to `127.0.0.1` and only answers requests whose `Host` is `localhost`,
  `127.0.0.1` or `::1`. That blocks DNS-rebinding attacks from websites you visit.
- Cross-origin writes are refused: the `Origin` header must match, and a browser's
  `Sec-Fetch-Site` must say `same-origin`. Every write also needs a JSON or explicit content
  type, which triggers a CORS preflight.
- There's no authentication. Don't set `HOST=0.0.0.0` on a network you don't trust.
- The CSP allows scripts only from this server and one pinned version of the lucide icon
  library on its CDN, which is used only until `npm run vendor` saves a local copy
  (`public/vendor/`, git-ignored). That keeps third-party code off a page that can reach the
  Pip-Boy over USB. Fonts and icons are optional, and the app works offline.
- Names that end up in code on the Pip-Boy (Storage names in `.bootPowerOn`, paths and text in
  REPL commands) are validated or passed as JSON strings, never pasted in raw.
- An app's SD card extras (`USER/*.EXT`) are code, like the `USER/*.JS` launchers next to
  them: anyone who can write to the SD card can already change what the Pip-Boy runs.

## Changes from the original single-file dashboard

Fixed:

1. **Records didn't work locally.** They depended on a hosted `/_sdk/data_sdk.js`. They now
   use the local server and survive restarts.
2. **The "Espruino Storage files" panel listed the SD card** (`fs.readdirSync`), so
   *Back up Storage* read the wrong names. It now uses `require("Storage").list()`.
3. **Storage writes over 192 bytes failed.** The first `Storage.write` didn't declare the total
   size, so later chunks overflowed the file. It now does.
4. **Non-ASCII text was corrupted** when writing to Storage. Files are now sent as raw bytes
   (base64) with byte checksums, and verification reads the file once instead of twice.
5. **False low-memory safe mode.** `/\bMEMORY\b/i` matched any output, including a file named
   `MEMORY.TXT`. Only Espruino error lines outside response frames count now.
6. **Frame parsing broke** if a file contained `>> >`. The device now escapes `>` inside frames.
7. **Unbounded log** re-rendered on every entry, which froze the page during large transfers.
   It's now bounded, batched and render-throttled.
8. **A blocked icon CDN stopped the whole app** (`lucide.createIcons()` threw on startup).
9. **Restore** could create duplicate settings profiles, mis-counted the record limit and
   imported duplicate frequencies. Import is now validated up front and atomic on the server.
10. A device "Uncaught" error now fails the transaction straight away instead of waiting out
    the timeout. SD read/write handles are closed without hiding the original error.
11. Cleanup: removed dead code (`inFlight`, `transactionReader`, a never-enabled echo button),
    a leftover debugging note on the dashboard, and the vertical-centering layout bug.

New:

- The workspace keeps real files between sessions. Any file can be copied to the SD card, and
  SD files can be kept in it.
- Storage backups are downloaded and also kept in the workspace. The backup format is v2
  (base64, binary-safe), and v1 backups still restore.
- The activity log is kept between sessions, with an optional per-transaction device trace.
