# Development

The rules for changing the code (no dependencies, tests, security, firmware) are in
[AGENTS.md](../../AGENTS.md) at the top of the repository. This page is the map.

## Commands

```bash
npm start              # dashboard on http://localhost:8077, emulator at /emulator/
npm run dev            # same, restarting when server files change
npm test               # unit, integration and emulator tests (all must pass)
npm run test:e2e       # browser tests: need Playwright, otherwise skipped
npm run apps:build     # rebuild the apps, extensions, holotapes and the emulator's starter Pip-Boy
npm run vendor         # optional: copy the icon library into public/vendor/ (git-ignored)
```

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
docs/THEMES.md          how to add a dashboard theme (checked by test/themes.test.js)
apps/                   Pip-Boy apps (apps/index.json lists them for the emulator)
  shared/               engine.js (the plumbing Mojave UI, Capital UI, Pip-Boy 2000, Endurance and TARS share), the
                        Pip-OS 1.33 screens and the companion extras
  capital/              Capital UI: a Fallout 3 style interface — see apps/capital/README.md
  pip2000/              Pip-Boy 2000: a Fallout 1 and 2 style interface — see apps/pip2000/README.md
  endurance/            Endurance: a flight deck based on the film Interstellar — see apps/endurance/README.md
  tars/                 TARS: the film's robot, which talks to you — see apps/tars/README.md
  mojave/               Mojave UI: a season 2 / New Vegas style interface — see apps/mojave/README.md
  pipos-x/              PIP-OS X: a futuristic concept interface — see apps/pipos-x/README.md
  holotapes/            games and tools the stock interface runs from the SD card (INV › APPS)
  contact-sheet.mjs     renders every page of an app in the emulator into one PNG
emulator/               Espruino in WebAssembly (generic + Pip-Boy) — see emulator/README.md
  index.html, web/      the emulator page, served at /emulator/
  runtime/              host: Espruino class, WASI on an in-memory SD card, board profiles
  dist/                 prebuilt firmware (.wasm); rebuild with emulator/build.sh
  espruino/             board files, target code and patches applied to the Espruino source
  cli.js                REPL in a terminal: node emulator/cli.js
```

## Tests

```bash
npm test             # unit + integration + emulator (about 210 tests, two to three minutes)
npm run test:e2e     # browser tests (needs Playwright, skipped if missing)
npm run test:all
```

To enable the browser tests: `npm i -D playwright && npx playwright install chromium`.

`test/support/fake-espruino.js` is a fake Pip-Boy that evaluates the exact REPL lines the app
sends against a model of Espruino `Storage` (including its "size is fixed by the first write"
rule) and `fs`. That's how the serial code is tested without hardware. The browser tests inject
a similar fake as `navigator.serial`.

## More

- [API.md](API.md): the server's routes.
- [SERIAL.md](SERIAL.md): how the dashboard talks to the Pip-Boy.
- [SECURITY.md](SECURITY.md): what keeps the server and the device safe.
- [THEMES.md](THEMES.md): adding a dashboard theme.
- [../apps/README.md](../apps/README.md): the Pip-Boy apps and how they're built.
- [../emulator/README.md](../emulator/README.md): the emulator, and rebuilding its WebAssembly.
- [HISTORY.md](HISTORY.md): what changed from the original single-file dashboard.
