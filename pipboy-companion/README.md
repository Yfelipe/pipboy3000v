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

**No Pip-Boy?** Open <http://localhost:8077/emulator/>: it starts the starter Pip-Boy with the
companion's apps and sample files. Pip-OS isn't included (it's The Wand Company's), but you can add
the official update on the emulator's Load tab: pick the variant (Mk V, Overseer, FO3) and version,
and **Download** links to that release zip on The Wand Company's CDN (from the index their
[Pip-Boy upgrade page](https://www.thewandcompany.com/pip-boy/upgrade/) uses), and **Add the update
zip** installs it. See the
[emulator README](emulator/README.md).

Open <http://localhost:8077>. Web Serial needs a secure context, and `localhost` counts as one,
so connecting works without HTTPS.

| Setting | Default | Env var |
| --- | --- | --- |
| Port | `8077` | `PORT` |
| Bind address | `127.0.0.1` | `HOST` (`127.0.0.1`, `::1` or `localhost` only: the server refuses to start on any other address) |
| Data folder | `./data` | `PIPBOY_DATA_DIR` |

## Documentation

| For | Read |
| --- | --- |
| What each dashboard page does | [docs/DASHBOARD.md](docs/DASHBOARD.md) |
| Where your data lives, backups, complete device copies, freeing Storage space | [docs/BACKUPS.md](docs/BACKUPS.md) |
| The Pip-Boy apps | [apps/README.md](apps/README.md) |
| Holotapes (games and tools run from the SD card) | [apps/holotapes/README.md](apps/holotapes/README.md) |
| Extensions (screens added to the stock Pip-OS) | [apps/extensions/README.md](apps/extensions/README.md) |
| The emulator | [emulator/README.md](emulator/README.md) |
| Working on the code: layout, tests | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |
| The server API | [docs/API.md](docs/API.md) |
| Serial protocol notes | [docs/SERIAL.md](docs/SERIAL.md) |
| Security notes | [docs/SECURITY.md](docs/SECURITY.md) |
| Adding a dashboard theme | [docs/THEMES.md](docs/THEMES.md) |
| Changes from the original single-file dashboard | [docs/HISTORY.md](docs/HISTORY.md) |
