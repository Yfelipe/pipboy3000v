# Pip-Boy apps

Alternative interfaces for the Pip-Boy 3000 Mk V. Each one replaces the stock screens while it
runs, follows the mode dial, wheel and thumbwheel, and leaves the stock firmware installed: the
power button returns to it. They run on the device and in the [emulator](../emulator/README.md).

| App | Based on | Storage name | Launcher |
| --- | --- | --- | --- |
| [Mojave UI](mojave/README.md) | The New Vegas era of the Fallout TV series' second season | `mojave.min.js` | `USER/MOJAVE.JS` |
| [PIP-OS X](pipos-x/README.md) | A holographic concept of a next-generation Pip-Boy | `pipos-x.min.js` | `USER/PIPOSX.JS` |
| [Capital UI](capital/README.md) | Fallout 3's Pip-Boy 3000 | `capital.min.js` | `USER/CAPITAL.JS` |
| [Pip-Boy 2000](pip2000/README.md) | Fallout and Fallout 2's Pip-Boy 2000 | `pip2000.min.js` | `USER/PIP2000.JS` |
| [Endurance](endurance/README.md) | The ship's flight deck in the film *Interstellar* | `endurance.min.js` | `USER/ENDURANC.JS` |
| [TARS](tars/README.md) | The robot in *Interstellar*, which talks to you | `tars.min.js` | `USER/TARS.JS` |

Each app's README says what it takes from its source, what it changes, and what's on each page.

Also here:

- [Holotapes](holotapes/README.md): small games and tools the *stock* interface runs from the
  SD card (terminal hacking, lockpicking, a stand clock and more).
- [Extensions](extensions/README.md): screens added to the stock interface instead of replacing
  it (media remote, radio presets, notes, inbox).

## Installing

On the dashboard's **Apps** page, **Install** writes the app to Storage and its launcher to
`USER/` on the SD card, so it appears in the stock **INV › APPS** menu. Every app also brings a
small extras file (`USER/<NAME>.EXT`) with the companion's features: FM radio presets,
INV › REMOTE, DATA › NOTES and INBOX, and message pop-ups. It runs from RAM, so it costs no
Storage. Endurance also copies three pictures to `ENDURANC/` on the SD card.

**Storage space:** each app is 24 to 27 KB, and with Pip-OS 1.33 installed about 33 KB of
Storage is free. So on a real Pip-Boy there is room for one app at a time.
[docs/BACKUPS.md](../docs/BACKUPS.md) explains why, and how **Free up space** gets space back.

## How they're built

Mojave UI, Capital UI, Pip-Boy 2000, Endurance and TARS share their plumbing:
[`shared/engine.js`](shared/engine.js) handles the wheels, the mode dial, sounds, video, the
display palette, settings, the radio, messages from the companion, the extras file and the
Pip-OS 1.33 screens (INV › ID, DATA › FEEDS and LISTS). Each app supplies its own drawing code,
so they share no appearance. PIP-OS X predates the engine and has its own.

Each app has a `build.sh` that bundles and minifies it with esbuild into `<app>.min.js` (Espruino
runs ES2017). From `pipboy-companion/`:

```bash
npm run apps:build                                    # every app, holotape and extension, and the emulator's starter
node apps/contact-sheet.mjs apps/<app>/<app>.min.js <pages per tab>   # every page in one PNG
```

The rules for adding or changing an app (each must have its own design, tests, rebuilding) are
in [AGENTS.md](../../AGENTS.md).
