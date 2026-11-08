# Espruino emulator

Espruino compiled to WebAssembly from the official source, with a small JavaScript host that
runs it in a browser or in Node.js. Two boards are included:

| Board | Build | What it is |
| --- | --- | --- |
| `espruino` | `ESPRUINO_WASM` | Generic Espruino: 320×240 display, BTN1–2, LED1–3, 1 MB Storage, a filesystem. Runs any Espruino program. |
| `pipboy` | `PIPBOY_WASM` | Pip-Boy 3000 Mk V: same pins, buttons, LEDs, 5000 variables, 128 KB Storage, 480×320 display and `Pip` library as the real device. Load a dump and it runs the device's own firmware. |

Both are built from Espruino `2v29.400`, the version in Pip-OS 1.33
([`88118ebb`](https://github.com/espruino/Espruino/commit/88118ebb65684ea57c6a19bcd8c2880973a039cc),
the 400th commit after `RELEASE_2V29` on master), so `process.env.VERSION` and behaviour match the
device. The firmware itself reports commit `0db1c9c41`, which isn't in the public repository; the one
native it uses that the public tree lacks, `Pip.blitFile` (DATA › FEEDS and INV › ID pictures), is
added by `patches/0004-pipboy-blitfile.patch`. Older dumps (Pip-OS 1.20, Espruino 2v24) boot too.

## Use it

**In the browser:** `npm start`, then open <http://localhost:8077/emulator/> (or **Emulator** in
the dashboard's sidebar).

- **Load → Device dump** boots a dump from `data/dumps/` (or pick a dump folder from disk).
- **Program** runs code like the [Web IDE](https://www.espruino.com/ide/): *Run in RAM* resets
  and types it into the REPL; *Save as boot code* writes `.bootcde` to Storage and reboots.
- **Load → Apps** installs an app from the project's `apps/` folder (e.g. the Mojave UI) and runs it.
  **Program → Save to Storage & load()** does the same for your own code.
- **Console** is the REPL. Click it and type, paste, use the arrow keys for history.
- Click the screen to drive the controls from the keyboard (keys are shown on the buttons).
  On the Pip-Boy, the mouse wheel turns the menu wheel.

**In a terminal:**

```bash
node emulator/cli.js                         # generic board, REPL on stdin/stdout
node emulator/cli.js app.js                  # ...running app.js
node emulator/cli.js --save app.js           # app.js saved as boot code
node emulator/cli.js --board pipboy --dump data/dumps/<id> [--sd /path/to/card/copy]
```

Ctrl-] quits.

**From code** (Node or browser):

```js
import { Espruino } from './emulator/runtime/espruino.js';
import { BOARDS } from './emulator/runtime/boards.js';

const emu = await Espruino.start({
  board: BOARDS.espruino,
  wasm: await readFile('emulator/dist/espruino_wasm.wasm'),
  onOutput: (text) => process.stdout.write(text),
});
emu.write('digitalWrite(LED1, 1)\n');      // type at the REPL
emu.storageWrite('.bootcde', code);         // require("Storage").write(...)
emu.reboot();                               // power cycle: RAM cleared, Storage kept
emu.setButton('BTN1', true);                // press a button from the board profile
emu.pixels;                                 // RGB565 framebuffer; emu.takeDirty() says what changed
```

Pass `fs` (a `MemFS`) to give the board an SD card; `require("fs")` and `E.openFile` use it.
`flashImage()` returns Storage as bytes, and `flash:` at start restores it.

## How it's built

`./build.sh` (or `npm run emulator:build`) produces `dist/*.wasm`:

1. clones Espruino at `espruino/ESPRUINO_COMMIT` into `.build/`,
2. applies `espruino/patches/*.patch` (each starts with what it changes and why),
3. copies the overlay on top: `espruino/boards/*_WASM.py`, `espruino/make/`, `espruino/targets/wasm/`,
4. runs the normal Espruino build, `make BOARD=<board>`, with the WASI SDK's clang.

It needs git, make, python3 and curl; it downloads the [WASI SDK](https://github.com/WebAssembly/wasi-sdk)
unless `WASI_SDK_PATH` points at one. `RELEASE= ./build.sh` keeps Espruino's assertions in.

The port follows the structure Espruino uses for its other targets (see
[README_BuildProcess.md](https://github.com/espruino/Espruino/blob/master/README_BuildProcess.md)
and `targets/emscripten`, the Bangle.js emulator): a board file describes the device, a `WASM`
chip family selects `make/family/WASM.make`, and `targets/wasm/` implements `jshardware.h`.

- **Console:** the host pushes characters with `jshPushIOCharEvent` and drains output with
  `jshGetDeviceToTransmit`/`jshGetCharToTransmit`, as for USB on a real board.
- **Time and sleep:** `jsIdle()` runs the interpreter until it would sleep and returns how long
  for; the host schedules the next call. Pins, analog values and the clock are host imports
  (`targets/wasm/wasm_host.h`).
- **Storage** lives in the module's memory, so it is memory-mapped as on the real chips and large
  boot code runs straight from flash. It behaves like NOR flash (writes only clear bits).
- **Display:** `targets/wasm/lcd_wasm.c` implements Espruino's `lcd_sdl.h` interface on a plain
  RGB565 framebuffer.
- **Files:** `LINUX=1` selects Espruino's POSIX file code, which WASI provides; `runtime/wasi.js`
  implements the WASI calls on an in-memory filesystem (`runtime/memfs.js`).
- **Device addresses:** `peek`/`poke` and `E.memoryArea` on addresses outside the module's memory
  (registers, the STM32's CCM RAM at `0x10000000`) get zero-filled RAM, so firmware that keeps
  buffers there works.

`runtime/boards.js` describes each board's inputs for the host: buttons (and whether they are
active-low), rotary encoders, the Pip-Boy's analog mode dial, and fixed levels such as USB power
and the SD card-detect switch.

## Not emulated

- Audio (the Pip-Boy's codec), the FM radio chip, I2C/SPI/serial peripherals: calls succeed and
  do nothing, reads return zeros.
- `E.nativeCall` (ARM machine code) throws. The Pip-Boy firmware only uses it for the power-off
  animation.
- Code that never returns to the event loop (`while(1);`) freezes the page: there's no second
  thread to deliver Ctrl-C. Reload to recover.
- Large SD files the dump skipped (boot video, long radio clips): add them with **Load → SD card**
  from a copy of the card.

The Pip-Boy firmware prints `Oops. non-even byte count!` while it types text: its sound effects
are odd-length strings. That message comes from `libs/pipboy` and appears on the real device too.

## Tests

```bash
node --test emulator/test/      # also part of npm test
```

They boot both builds and check the REPL, timers, Storage across reboots, buttons and watches,
Graphics, files, the Pip-Boy's inputs and memory map, and `Pip.blitImage`. If a dump exists in
`data/dumps/` (or `PIPBOY_DUMP=<dir>`), one more test boots it to the Pip-Boy main menu.

Buttons held down from the host (`emu.setButton(id, true)`) stay held through `reboot()`, so
boot-time checks behave as on the device (holding the torch button skips companion extensions).
The binary's own SD-card install of Pip-OS (Tune+ and Power) isn't part of the emulated build.
