# Espruino emulator

Espruino compiled to WebAssembly from the official source, with a small JavaScript host that
runs it in a browser or in Node.js. Four boards are included:

| Board | Build | What it is |
| --- | --- | --- |
| `espruino` | `ESPRUINO_WASM` | Generic Espruino: 320×240 display, BTN1–2, LED1–3, 1 MB Storage, a filesystem. Runs any Espruino program. |
| `pipboy` | `PIPBOY_WASM` | Pip-Boy 3000 Mk V: same pins, buttons, LEDs, 5000 variables, 128 KB Storage, 480×320 display and `Pip` library as the real device. Load a dump and it runs the device's own firmware. |
| `fo3` | `SAPLING_WASM` | **Prototype** of the Fallout 3 / New Vegas Pip-Boy 3000 (board `SAPLING`), whose board isn't published: the Mk V build with the FO3's controls from The Wand Company's diagram (see below). Runs a control test, not FO3 firmware. |
| `pipboy-xl` | `PIPBOY_XL_WASM` | The same Pip-Boy with **512 KB of Storage** (still one flash page), so Pip-OS, both of the companion's apps and the extensions fit at once. Emulator only. The page uses it for the starter, dumps and Pip-OS unless **Load → Extra Storage** is unticked; untick it to check that something fits on a real Pip-Boy. |

Both are built from Espruino `2v29.400`, the version in Pip-OS 1.33
([`88118ebb`](https://github.com/espruino/Espruino/commit/88118ebb65684ea57c6a19bcd8c2880973a039cc),
the 400th commit after `RELEASE_2V29` on master), so `process.env.VERSION` and behaviour match the
device. The firmware itself reports commit `0db1c9c41`, which isn't in the public repository; the one
native it uses that the public tree lacks, `Pip.blitFile` (DATA › FEEDS and INV › ID pictures), is
added by `patches/0004-pipboy-blitfile.patch`. Older dumps (Pip-OS 1.20, Espruino 2v24) boot too.

## Use it

**In the browser:** `npm start`, then open <http://localhost:8077/emulator/> (or **Emulator** in
the dashboard's sidebar).

- **Run tab:** the page opens on a launcher with a tile for each app and holotape (from
  `apps/index.json`; a tile shows the entry's `name` and short `tag`). Point at a tile to read what
  it is, click it to run it; the running one is marked. A holotape chosen while an app is running
  leaves the app first. The other tabs are **Console**, **Program** and **Load** (the starter or
  a dump, Pip-OS, SD card files and Storage files, each in a section that folds away).
- **No device needed:** the first visit opens the **starter Pip-Boy** (`emulator/starter/`). It has
  a small boot menu with the companion's six apps (Mojave UI, PIP-OS X, Capital UI, Pip-Boy 2000, Endurance and TARS) and its holotapes, the Vault Boy STAT videos from `assets/official/STAT`, plus their SD card
  extras and sample notes, lists, messages and radio presets. It's also first in **Load → Starter
  Pip-Boy or a dump**. Rebuild it with `npm run starter:build` (`npm run apps:build` does it too). With Extra Storage unticked
  (128 KB) the six apps don't all fit: the starter loads the ones that do, its menu lists only
  those, and the status line names the rest.
- **Pip-OS isn't included:** it belongs to The Wand Company, as do the Pip-Boy's sounds and videos.
  To run the stock interface:
  1. On the Load tab, pick the **variant** and **version**, then **Download** the release zip from
     The Wand Company. The dashboard's server reads their public release index for the variant
     (the same lists their [Pip-Boy upgrade page](https://www.thewandcompany.com/pip-boy/upgrade/)
     uses) and keeps it for an hour; if it can't be read, the button opens the upgrade page.

     | Variant | Release index | Runs here |
     | --- | --- | --- |
     | Pip-Boy 3000 Mk V (`blueprint`) | `https://cdn.thewandcompany.com/blueprint/index.json` | yes |
     | Overseer (`overseer`; its SD card has `MISC/HANK.avi`) | `https://cdn.thewandcompany.com/blueprint-overseer/index.json` | yes |
     | FO3 | `https://cdn.thewandcompany.com/sapling/index.json` | no: another board, download only |

     The variant starts on the one that matches the emulated SD card. Each entry's zip is under the
     CDN, e.g. `https://cdn.thewandcompany.com/blueprint/v1.33/assets/blueprint_2v29.400-1.33.zip`;
     anything pointing elsewhere is ignored.
  2. **Add the update zip…** takes that zip as it is (or **…or its unzipped folder**). Its files go
     onto the SD card and `FW.JS` becomes the boot code, as on the device.

  Storage starts again with Pip-OS and the starter's apps. With Extra Storage (the default)
  everything fits; on the real 128 KB, Pip-OS leaves room for one app. The update has no
  `BOOT/BOOT_DONE.wav` (it's on the Pip-Boy's own card), so silence stands in for it. Missing
  videos just leave blank screens. The emulator never downloads Pip-OS by itself: you download
  the zip from The Wand Company and add it.
- **Load → Device dump** boots a dump from `data/dumps/` (or pick a dump folder from disk). A dump
  of your own Pip-Boy has everything: Pip-OS and the whole SD card.
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
node emulator/cli.js --board pipboy-xl --dump emulator/starter  # the starter Pip-Boy, 512 KB Storage
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

## Sound

The Pip-Boy boards play their sound on the computer. `Pip.audioStart` (WAV files from the SD
card), `Pip.audioStartVar` and video soundtracks fill the Pip library's audio ring buffer as on
the device. `targets/wasm/audio_wasm.c` stands in for the I2S output: the host takes the samples
as they fall due, in real time at the file's sample rate, and the page plays them through Web Audio
(`web/audio.js`). Playback starts and stops as on the device: once enough is buffered, and when the
buffer runs dry. So `Pip.audioIsPlaying()`, the `audioStopped` event and the waveform
(`Pip.getAudioWaveform`) follow the sound, and long files are read from the SD card as they
play rather than all at once.

- Browsers only start sound after a click or key press on the page; the **Sound** checkbox and
  volume slider in the header turn it off or down, and the choice is kept in the browser.
- From code, pass `onAudio(samples, rate)` to `Espruino.start` (16 bit mono `Int16Array`s).
- The FO3's built-in UI clicks (TAB, SCROLL …) aren't in this build, so those stay silent; its
  WAV files (boot sound, holotapes, FX) play. The FM radio and the codec make no sound.

## The FO3 prototype

The Wand Company's FO3 Pip-Boy (board `SAPLING`) runs Espruino 2v29, but its board file isn't
public. `fo3` is a best guess that **runs the real FO3 firmware**: add The Wand Company's FO3
update zip (`sapling_<version>.zip`, from the Load tab's download select) with **Add the update
zip…** and the emulator switches to this board, puts the update's files on the SD card and boots
`FW.JS`. Tested with 1.1.6: it boots to STATS and every control drives its screens.

It's the Mk V build (same 480×320 screen, Pip library, SD card and radio) plus:

- **The firmware's pin names** (`BTN_STATS`, `ENC1_A`, `MODE_SELECTOR`, `LED_DOWNFIRE` …).
  Which pin each one is on is the emulator's choice, made in `web/sapling-boot0.js`, which goes in
  Storage as `.boot0`. Where the FO3 and Mk V share a part, it uses the Mk V's pin.
- **Stand-ins for what its native firmware has and this build lacks:** `Pip.blitScreen` (draws
  the screen buffer, without the device's glitch and scanline animations), `Pip.audioFileInfo`,
  `Pip.enableMCLK`, the Monofonto14 and Fixedsys16 fonts (the nearest size stands in), its
  built-in UI sound names (silence), `VERSION`, and `E.nativeCall`. Machine code can't run
  under WebAssembly, so the sleep routine's piece is skipped.
- **Emulator fixes it needed, which every board gets:** `require("timer")` tasks now run (the FO3
  fades its LEDs with one), screen buffers can be up to 256 KB in device memory, `analogWrite()`
  duty reaches the host (`onAnalogOut`), and I2C goes to emulated chips (below).
- **Emulated I2C chips** (`runtime/i2c.js`, listed in the board profile): I2C transfers now reach
  the host, which answers for the chips a board has; an address with no chip throws, as on a real
  bus. The FO3 gets its KXTJ3 accelerometer (I2C1 0x0F; reads flat, taps pull `ACCEL_INT` low
  until the firmware reads them), its audio codec (I2C1 0x10; answers, makes no sound) and its
  RDA5807 radio (I2C2 0x11; tunes at once). So the firmware finds its accelerometer and skips its
  hardware-version check. The page's **Motion** controls tap it (A) or shake it for a second (K);
  from code, `emu.tap()` and `emu.setAcceleration(x, y, z)`.
- **Guesses:** 256 KB of Storage and 12000 variables.

| FO3 control | Firmware name | Pin here | Emulator key |
| --- | --- | --- | --- |
| Primary scroll (left wheel) | `ENC1_A` / `ENC1_B` | B1 / B0 | Up / Down, mouse wheel (down the list is +1) |
| Click select | `ENC1_PRESS` | A3 | Enter |
| Secondary scroll (top wheel) | `ENC2_A` / `ENC2_B` | A10 / A8 | Left / Right |
| STATS, ITEMS, DATA | `BTN_STATS`, `BTN_ITEMS`, `BTN_DATA` | A1, E1, E2 | S, I, D |
| Their lamps | `LED_STATS`, `LED_ITEMS`, `LED_DATA` | E7, E8, E9 | (LEDs) |
| Page select knob | `MODE_SELECTOR` (powered by `MEAS_ENB`) | A7 (C4) | 1 to 5 (0.8, 0.6, 0.4, 0.2, 0 V/V) |
| Power | `BTN_POWER` | A0 | Esc |
| Torch, downfire light, RGB LED | `LED_TORCH`, `LED_DOWNFIRE`, `LED_RED/GREEN/BLUE` | E11, E10, E4-E6 | (LEDs) |

The FO3 has no torch button: its torch is a screen of its own. Without firmware, choosing the
board boots `web/fo3-controls.js`, a control test that uses the same pin names. The tests check the
control test always, and the real firmware when `data/firmware/sapling_*.zip` exists. `data/` is
git-ignored: the firmware belongs to The Wand Company.

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
