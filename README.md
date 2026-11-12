# Pip-Boy 3000 Mark V companion

A companion for the real **Pip-Boy 3000 Mark V** (The Wand Company's wearable from Fallout 4):
a dashboard that runs on your computer and talks to the Pip-Boy over USB, alternative
interfaces and games for the device, and an emulator of it that runs in the browser, so you can
try everything without one.

## What's in it

- **A dashboard** (Chrome or Edge, over USB): install apps in one click, manage the Pip-Boy's
  Storage and SD card, back up and restore, set its clock and display colour, make your ID card,
  lists and notes, send it messages, the weather and radio presets, and take a complete copy of
  the device for the emulator.
- **Six alternative interfaces** for the Pip-Boy:

  | App | Based on |
  | --- | --- |
  | [Mojave UI](pipboy-companion/apps/mojave/README.md) | The New Vegas era of the Fallout TV series |
  | [PIP-OS X](pipboy-companion/apps/pipos-x/README.md) | A holographic next-generation Pip-Boy concept |
  | [Capital UI](pipboy-companion/apps/capital/README.md) | Fallout 3's Pip-Boy 3000 |
  | [Pip-Boy 2000](pipboy-companion/apps/pip2000/README.md) | Fallout and Fallout 2's Pip-Boy 2000 |
  | [Endurance](pipboy-companion/apps/endurance/README.md) | The ship's flight deck in the film *Interstellar* |
  | [TARS](pipboy-companion/apps/tars/README.md) | The robot in *Interstellar*, which talks to you |

- **Holotapes**: [games and tools](pipboy-companion/apps/holotapes/README.md) the stock
  interface runs from the SD card: terminal hacking, lockpicking, Cap Collector, an FM scanner,
  a stand clock and a level-up tracker for your to-do lists.
- **Extensions**: [screens added to the stock interface](pipboy-companion/apps/extensions/README.md):
  a USB media remote, radio presets, notes and an inbox.
- **An emulator**: Espruino compiled to WebAssembly with the Pip-Boy's screen, wheels, dial and
  buttons. It starts with a [starter Pip-Boy](pipboy-companion/emulator/README.md) holding all
  the apps, and can run Pip-OS once you add The Wand Company's official update yourself.

## Quick start

Needs **Node.js 22 or later**, and Chrome or Edge to connect a Pip-Boy (Web Serial). Nothing to
install: there are no dependencies.

```bash
cd pipboy-companion
npm start
```

Open <http://localhost:8077>. No Pip-Boy? Open <http://localhost:8077/emulator/>.

## Documentation

| For | Read |
| --- | --- |
| The dashboard: setup and every page | [pipboy-companion/README.md](pipboy-companion/README.md), then [docs/DASHBOARD.md](pipboy-companion/docs/DASHBOARD.md) |
| Backups, complete device copies, freeing Storage space | [docs/BACKUPS.md](pipboy-companion/docs/BACKUPS.md) |
| The apps, and how they're built | [apps/README.md](pipboy-companion/apps/README.md) |
| The emulator | [emulator/README.md](pipboy-companion/emulator/README.md) |
| Working on the code | [docs/DEVELOPMENT.md](pipboy-companion/docs/DEVELOPMENT.md) and [AGENTS.md](AGENTS.md) (the project's rules, for people and coding agents) |

## Repository layout

| Path | What it is |
| --- | --- |
| [`pipboy-companion/`](pipboy-companion) | The project: dashboard, apps, holotapes, extensions and emulator |
| [`AGENTS.md`](AGENTS.md) | The rules for working on the code: commands, security, firmware, quality |
| [`.bootcde.js`](.bootcde.js) | The device's boot code, decoded. A reference only: nothing runs it or builds from it |

## Not affiliated

This is a fan project. It isn't made or endorsed by The Wand Company, Bethesda, or the makers of
*Interstellar*. Pip-Boy, Fallout and Vault-Tec are trademarks of their owners. Pip-OS isn't
included: the emulator links to The Wand Company's official update for you to download.
