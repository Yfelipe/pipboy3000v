# Pip-Boy 3000 Mark V

`pipboy3000v` contains the decoded Pip-Boy firmware and a local companion dashboard for working with a physical Pip-Boy 3000 Mark V.

The companion connects over USB Web Serial, manages Pip-Boy apps and files, maintains local records, creates and restores backups, runs diagnostics, and provides a browser-based emulator. It uses Node.js on the server and standard ES modules in the browser—no build step is needed for normal use.

## Contents

| Path | Description |
| --- | --- |
| [`.bootcde.js`](./.bootcde.js) | Decoded device-side firmware artifact. |
| [`pipboy-companion/`](./pipboy-companion/) | Local dashboard, serial tools, apps, emulator, tests, and development tooling. |

## Quick start

The companion requires **Node.js 22 or later**. Connecting to a physical device requires Chrome or Edge because the dashboard uses Web Serial. `localhost` is a secure context, so local HTTPS is not required.

```bash
cd pipboy-companion
npm start
```

Open <http://localhost:8077> in Chrome or Edge. For development, use `npm run dev` to restart the server when server files change.

| Setting | Default | Environment variable |
| --- | --- | --- |
| Port | `8077` | `PORT` |
| Bind address | `127.0.0.1` | `HOST` |
| Data directory | `./data` | `PIPBOY_DATA_DIR` |

## Dashboard capabilities

### Apps and extensions

The app catalog lives in [`pipboy-companion/apps/index.json`](./pipboy-companion/apps/index.json). The dashboard can:

- Install or remove catalogued apps, or install a user-supplied `.js` file.
- Copy apps to Pip-Boy Storage and add launchers under `USER/` on the SD card.
- Free and rebuild Storage automatically when necessary.
- Open an app in the emulator at `/emulator/?app=<id>`.
- Choose an installed app to open at power-on.

Extensions add screens to the stock Pip-OS rather than replacing it. Available extensions include Media remote, Radio presets, Notes, and Inbox. Hold the torch button while starting the Pip-Boy to skip extensions. A Pip-OS update erases Storage, including installed extensions.

Minified extension copies used by the dashboard are in `pipboy-companion/apps/extensions/min/`. Rebuild them with:

```bash
npm run apps:build
```

### Files, backups, and device copies

The Files page distinguishes Pip-Boy Storage, the SD card, and workspace files retained on the computer. Files can be uploaded, downloaded, deleted, or copied from the workspace to the SD card.

Storage backups include checksums, download to the computer, and remain available in the workspace for restoration. The companion can also export and import its local data, including installed-app records, radio presets, and settings. Restore inputs are validated before local data changes.

Complete device copies are stored under `data/dumps/`. Each dump includes device information, Storage files, SD-card content, and a manifest with file sizes, checksums, skipped files, errors, and completion status. Use a dump to reproduce device state in the emulator or for local development.

### Settings, messages, and radio

The dashboard can read and update the firmware's `settings.json`, including device assignment, screen timeout, clock format, time zone, supported mode-dial behavior, clock calibration, and clock synchronization.

The **ID, lists & notes** tools manage the INV ID card, DATA lists and checklists, the DATA feeds user image, and Notes files. The dashboard preserves the device's expected file formats and asks before replacing a list changed on the device.

Messages sent from Home appear over the stock interface, are saved for the Inbox extension, and are stored in `USER/MESSAGES.json`. Radio presets are retained locally and can be synchronized to the Pip-Boy's RADIO menu.

Display-colour controls include presets, custom colours, and a scanline preview. When a device connects, the companion corrects its clock when it is more than three seconds out, unless clock synchronization is disabled.

### Diagnostics and serial communication

Diagnostics provides port selection, connection tests, console recovery, raw serial output, and live status JSON for automation or troubleshooting.

The companion uses a framed Web Serial protocol and matches replies to request IDs. It accounts for the Pip-Boy's approximately 63-byte output packets, uses release-mode pacing by default, and enables timer mode when the device supports it. Transfers provide error detection, checksums where applicable, progress reporting, cancellation between steps, and raw-output snapshots when a failure needs investigation.

The dashboard monitors sleep state and can keep an active connection awake. The **Wake** action only appears when the firmware reports that the device is asleep, keeping serial behavior separate from the stock interface's power-button behavior.

### Media remote, Notes, and Inbox

The Media remote makes the Pip-Boy a USB media controller for the connected computer:

- Wheel: volume
- Wheel press: play or pause
- Thumbwheel: previous or next track
- PLAY: mute

The Notes extension reads `NOTES/*.txt` files, which can be edited through **ID, lists & notes**. The Inbox extension displays messages sent from the dashboard's Home page.

### Emulator

The emulator runs the device firmware in a WebAssembly build of Espruino. A complete device dump supplies the device state, Storage, and SD-card files needed to reproduce a device locally.

For usage and build details, see the [emulator README](./pipboy-companion/emulator/README.md). The emulator also has a terminal entry point at [`pipboy-companion/emulator/cli.js`](./pipboy-companion/emulator/cli.js). Use [`pipboy-companion/apps/contact-sheet.mjs`](./pipboy-companion/apps/contact-sheet.mjs) to render every page of an app into a single PNG for visual inspection.

## Development

Run these commands from `pipboy-companion/`:

| Command | Purpose |
| --- | --- |
| `npm start` | Start the dashboard at <http://localhost:8077>. |
| `npm run dev` | Start the dashboard and restart when server files change. |
| `npm run apps:build` | Build minified dashboard-installed apps and extensions. |
| `npm test` | Run unit, integration, and emulator tests. |
| `npm run test:e2e` | Run browser tests when Playwright is available. |
| `npm run test:all` | Run the full test suite. |
| `npm run emulator` | Start the emulator terminal interface. |

To enable browser tests:

```bash
npm i -D playwright
npx playwright install chromium
```

## Local data and backups

The companion stores git-ignored local state in `data/`:

```text
data/
├── records.json
├── activity.jsonl
├── workspace/
└── dumps/
```

- `records.json` stores app records, radio presets, and settings.
- `activity.jsonl` is the bounded activity log.
- `workspace/` holds files retained between sessions.
- `dumps/<id>/` contains complete device copies.

Copy the entire `data/` directory to back up companion state. A complete dump contains `device.json`, Storage files, SD-card files, and `manifest.json`; the manifest is written last. Large SD-card files may be recorded as skipped because serial transfers are slow, and operating-system files such as `.DS_Store` are skipped and recorded.

If a dump is interrupted, the manifest records `"complete": false` and an abort reason. The Resume action continues the existing dump and skips files already saved.

## Security

By default, the server binds to `127.0.0.1`, accepts requests only for `localhost`, `127.0.0.1`, or `::1`, rejects cross-origin writes through Origin checks, and requires suitable content types for writes. There is no authentication.

Do not set `HOST=0.0.0.0` on an untrusted network.

## Pip-Boy Storage space

Pip-Boy Storage occupies one 128 KB flash page, and the stock `.bootcde` uses about 103 KB. Deleting or replacing a file marks its prior space unused, but the firmware cannot compact Storage while it is running from that same page. Consequently, writes may fail with `Unable to find or create file` even when the file list appears to show enough space.

The dashboard's **Free up space** workflow:

1. Backs up every Storage file with checksums.
2. Stops the firmware and erases Storage.
3. Writes the files back and verifies them.
4. Restarts and reconnects to the Pip-Boy.

App installation and restoration can request this rebuild automatically when space is insufficient.

## Further reading

- [Companion dashboard reference](./pipboy-companion/README.md)
- [Emulator setup and internals](./pipboy-companion/emulator/README.md)
- [Mojave interface documentation](./pipboy-companion/apps/mojave/README.md)
- [PIP-OS X interface documentation](./pipboy-companion/apps/pipos-x/README.md)
