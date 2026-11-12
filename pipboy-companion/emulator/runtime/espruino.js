// Host for the Espruino WebAssembly builds (emulator/espruino/targets/wasm).
// Works in browsers and in Node.js; has no DOM dependencies.
//
//   const emu = await Espruino.start({ board: BOARDS.espruino, wasm: bytes, onOutput: (t) => … });
//   emu.write('digitalWrite(LED1,1)\n');
//
// The interpreter runs in short bursts: jsIdle() runs everything that is due and returns the
// milliseconds until it needs to run again. Input, pin changes and timers schedule the next burst.

import { MemFS } from './memfs.js';
import { I2CBuses } from './i2c.js';
import { Wasi, WasiExit } from './wasi.js';

const STORAGE_CHUNK = 4096;
const INPUT_SLICE = 128;

/** Thrown by the `reboot` import to abandon the running instance (see jshReboot in targets/wasm). */
class RebootRequest extends Error {}

export class Espruino {
  /**
   * Create and boot an emulator.
   * @param {object} options
   * @param {object} options.board               a profile from boards.js
   * @param {BufferSource|WebAssembly.Module} options.wasm  the board's .wasm (bytes or compiled module)
   * @param {Uint8Array} [options.flash]         initial Storage contents, e.g. from flashImage() (erased if omitted)
   * @param {MemFS} [options.fs]                 the SD card, used by require("fs") and E.openFile
   * @param {(text: string) => void} [options.onOutput]   console output (what the REPL prints)
   * @param {(text: string) => void} [options.onLog]      C-level stdout/stderr of the firmware (debugging)
   * @param {(pin: string|number, level: number) => void} [options.onPinChange]  an output pin changed (LEDs)
   * @param {(pin: number, duty: number) => void} [options.onAnalogOut]  analogWrite() duty 0..1 (meters, dimmed LEDs)
   * @param {(samples: Int16Array, rate: number) => void} [options.onAudio]  sound the board plays (Pip.audioStart etc.), 16 bit mono, as it becomes due
   * @param {() => void} [options.onReboot]      the program is rebooting the device (E.reboot())
   * @param {boolean} [options.autoRun=true]     schedule bursts automatically (false: call idle() yourself)
   */
  static async start(options) {
    const module = options.wasm instanceof WebAssembly.Module ? options.wasm : await WebAssembly.compile(options.wasm);
    const emu = new Espruino({ ...options, module });
    emu.#boot();
    return emu;
  }

  constructor({ board, module, flash, fs, onOutput = () => {}, onLog = () => {}, onPinChange = () => {}, onAnalogOut = () => {}, onAudio = () => {}, onReboot = () => {}, autoRun = true }) {
    this.board = board;
    this.module = module;
    this.savedFlash = flash ?? new Uint8Array(board.storageBytes).fill(0xff);
    if (this.savedFlash.length !== board.storageBytes) throw new Error(`Flash image must be ${board.storageBytes} bytes`);
    this.fs = fs ?? new MemFS();
    this.onOutput = onOutput;
    this.onLog = onLog;
    this.onPinChange = onPinChange;
    this.onAnalogOut = onAnalogOut;
    this.onAudio = onAudio;
    this.onReboot = onReboot;
    this.autoRun = autoRun;
    this.levels = new Map(); // pin number -> electrical level, driven by the host or set by the program
    this.held = new Map(); // buttons the host holds down: pin -> level, kept through reboots
    this.analog = new Map(); // pin number -> 0..1
    this.analogOut = new Map(); // pin number -> analogWrite() duty 0..1, as the program set it
    this.i2c = new I2CBuses(board.i2c, this); // the board's emulated I2C chips (runtime/i2c.js)
    this.timer = null;
    this.stopped = false;
  }

  // ------------------------------------------------------------------ lifecycle

  /** Start a fresh instance (power-on): new RAM, Storage restored from savedFlash. */
  #boot() {
    for (;;) {
      this.decoder = new TextDecoder();
      this.wasi = new Wasi({ fs: this.fs, stdout: (t) => this.onLog(t) });
      const instance = new WebAssembly.Instance(this.module, {
        wasi_snapshot_preview1: this.wasi.imports,
        espruino: this.#hostImports(),
      });
      this.exports = instance.exports;
      this.audioBuffer = 0; // allocated in the new instance on first use
      this.audioClock = null;
      this.wasi.setMemory(this.exports.memory);
      this.exports._initialize();
      this.#flashView().set(this.savedFlash);
      this.console = this.exports.wasmConsoleDevice();
      this.lcd = {
        width: this.exports.wasmLcdWidth(),
        height: this.exports.wasmLcdHeight(),
        pointer: this.exports.wasmLcdBuffer(),
      };
      this.levels.clear();
      this.#applyBoardInputs();
      // Buttons held through a reboot stay held, so boot-time combinations work (as on the device)
      for (const [pin, level] of this.held) this.levels.set(pin, level);
      try {
        this.exports.jsInit(); // runs the boot code, which may itself call E.reboot()
      } catch (e) {
        if (!(e instanceof RebootRequest)) throw e;
        this.#beforeReboot();
        continue;
      }
      break;
    }
    this.idle();
  }

  #beforeReboot() {
    this.#drainOutput();
    this.savedFlash = this.flashImage();
    this.onReboot();
  }

  /** Power-cycle: fresh RAM, same Storage (flash) and SD card. */
  reboot() {
    clearTimeout(this.timer);
    this.timer = null;
    this.savedFlash = this.flashImage();
    this.#boot();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.timer = null;
  }

  // ------------------------------------------------------------------ the interpreter loop

  /** Run everything that is due now. Returns ms until the next burst is needed (0 = more work queued). */
  idle() {
    if (this.stopped) return -1;
    clearTimeout(this.timer);
    this.timer = null;
    let next;
    try {
      next = this.exports.jsIdle();
    } catch (e) {
      if (e instanceof RebootRequest) {
        this.#beforeReboot();
        this.#boot();
        return 0;
      }
      if (e instanceof WasiExit) {
        this.stop();
        return -1;
      }
      throw e;
    }
    this.#drainOutput();
    if (this.#pumpAudio()) next = Math.min(next, 15); // keep the sound flowing
    if (this.autoRun) this.timer = setTimeout(() => this.idle(), Math.min(next, 0x7fffffff));
    return next;
  }

  /**
   * Take the samples that are due to play (real time, at the sample rate) from the board's audio
   * ring buffer (targets/wasm/audio_wasm.c) and hand them to onAudio. Returns true while playing.
   */
  #pumpAudio() {
    const ex = this.exports;
    if (!ex.wasmAudioRead) return false; // a board without the Pip-Boy's audio
    if (!ex.wasmAudioPlaying()) {
      this.audioClock = null;
      return false;
    }
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const rate = ex.wasmAudioRate();
    this.audioClock ??= now - 60; // start with a little in hand
    const due = Math.min(8192, Math.floor(((now - this.audioClock) * rate) / 1000));
    if (due <= 0) return true;
    this.audioBuffer ||= ex.wasmAlloc(8192 * 2);
    const n = ex.wasmAudioRead(this.audioBuffer, due);
    this.audioClock = n < due ? now : this.audioClock + (n * 1000) / rate; // ran dry: start again from now
    if (n) this.onAudio(new Int16Array(ex.memory.buffer, this.audioBuffer, n).slice(), rate);
    return !!ex.wasmAudioPlaying();
  }

  #drainOutput() {
    const bytes = [];
    for (;;) {
      const device = this.exports.jshGetDeviceToTransmit();
      if (!device) break;
      const ch = this.exports.jshGetCharToTransmit(device);
      if (ch < 0) break;
      if (device === this.console) bytes.push(ch);
    }
    if (bytes.length) this.onOutput(this.decoder.decode(new Uint8Array(bytes), { stream: true }));
  }

  // ------------------------------------------------------------------ console

  /** Type text into the console (as if sent over USB). Large inputs are fed in slices. */
  write(text) {
    if (this.stopped) return;
    const data = new TextEncoder().encode(text);
    // The IO buffer holds 256 events (gen/platform_config.h); let the interpreter drain it between slices.
    for (let i = 0; i < data.length; i += INPUT_SLICE) {
      for (const b of data.subarray(i, i + INPUT_SLICE)) this.exports.jshPushIOCharEvent(this.console, b);
      this.idle();
    }
  }

  // ------------------------------------------------------------------ Storage

  /** Write a file to Storage, exactly like require("Storage").write(name, data). */
  storageWrite(name, data) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    if (!bytes.length) throw new Error('Storage files cannot be empty');
    const nameBytes = new TextEncoder().encode(name);
    if (nameBytes.length > 28) throw new Error('Storage names are limited to 28 characters');
    const namePtr = this.#copyIn(new Uint8Array([...nameBytes, 0]));
    try {
      for (let offset = 0; offset < bytes.length; offset += STORAGE_CHUNK) {
        const chunk = bytes.subarray(offset, offset + STORAGE_CHUNK);
        const ptr = this.#copyIn(chunk);
        try {
          if (!this.exports.wasmStorageWrite(namePtr, ptr, chunk.length, offset, bytes.length)) {
            throw new Error(`Storage write failed for ${name} at offset ${offset} (out of memory or Storage full?)`);
          }
        } finally {
          this.exports.wasmFree(ptr);
        }
      }
    } finally {
      this.exports.wasmFree(namePtr);
    }
    this.idle();
  }

  /** A copy of the whole Storage area, to save and pass back as `flash` later. */
  flashImage() {
    return this.#flashView().slice();
  }

  #flashView() {
    const size = this.exports.wasmFlashSize();
    if (size !== this.board.storageBytes) throw new Error(`Board profile says ${this.board.storageBytes} bytes of Storage, firmware has ${size}`);
    return new Uint8Array(this.exports.memory.buffer, this.exports.wasmFlashBuffer(), size);
  }

  #copyIn(bytes) {
    const ptr = this.exports.wasmAlloc(bytes.length || 1);
    if (!ptr) throw new Error('Out of WebAssembly memory');
    new Uint8Array(this.exports.memory.buffer, ptr, bytes.length).set(bytes);
    return ptr;
  }

  // ------------------------------------------------------------------ pins

  /** Pin number for a name ("A9", "BTN1", "LED1"), or -1. */
  pin(name) {
    if (typeof name === 'number') return name;
    const ptr = this.#copyIn(new TextEncoder().encode(`${name}\0`));
    try {
      return this.exports.wasmPinFromName(ptr);
    } finally {
      this.exports.wasmFree(ptr);
    }
  }

  /** Drive an input pin to an electrical level (0/1) and notify any setWatch. */
  setPin(name, level) {
    const pin = this.pin(name);
    if (pin < 0) throw new Error(`Unknown pin ${name}`);
    const value = level ? 1 : 0;
    if (this.levels.get(pin) === value) return;
    this.levels.set(pin, value);
    this.exports.wasmSendPinWatchEvent(pin);
    this.idle();
  }

  getPin(name) {
    return this.levels.get(this.pin(name)) ?? 0;
  }

  setAnalog(name, value) {
    const pin = this.pin(name);
    if (pin < 0) throw new Error(`Unknown pin ${name}`);
    this.analog.set(pin, value);
  }

  /** Press or release a button from the board profile. */
  setButton(id, pressed) {
    const button = this.board.buttons?.[id];
    if (!button) throw new Error(`Unknown button ${id}`);
    const pin = this.pin(button.pin);
    if (pressed) this.held.set(pin, pressed !== !!button.activeLow ? 1 : 0);
    else this.held.delete(pin);
    this.setPin(button.pin, pressed !== !!button.activeLow ? 1 : 0);
  }

  /** Turn an encoder from the board profile one detent: direction +1 or -1. */
  turnEncoder(id, direction) {
    const enc = this.board.encoders?.[id];
    if (!enc) throw new Error(`Unknown encoder ${id}`);
    // One full quadrature cycle; which line changes first gives the direction
    const [first, second] = direction > 0 ? [enc.a, enc.b] : [enc.b, enc.a];
    const rest = enc.activeLow ? 1 : 0;
    this.setPin(first, 1 - rest);
    this.setPin(second, 1 - rest);
    this.setPin(first, rest);
    this.setPin(second, rest);
  }

  /** Tap the board's accelerometer (its interrupt line fires until the firmware reads it). */
  tap() {
    const accel = this.i2c.find('kxtj3');
    if (!accel) throw new Error(`${this.board.name} has no accelerometer`);
    accel.tap();
  }

  /** Set the accelerometer's reading in g, in the chip's own axes (flat on a table: 0, 0, 1). */
  setAcceleration(x, y, z) {
    const accel = this.i2c.find('kxtj3');
    if (!accel) throw new Error(`${this.board.name} has no accelerometer`);
    accel.setAcceleration(x, y, z);
  }

  /** Move a selector switch from the board profile to a position (index into `positions`). */
  setSelector(id, index) {
    const sel = this.board.selectors?.[id];
    if (!sel?.positions[index]) throw new Error(`Unknown selector position ${id}[${index}]`);
    this.setAnalog(sel.pin, sel.positions[index].value);
    this.selectorPositions[id] = index;
  }

  #applyBoardInputs() {
    const level = (name, value) => {
      const pin = this.pin(name);
      if (pin < 0) throw new Error(`Board profile ${this.board.id}: unknown pin ${name}`);
      this.levels.set(pin, value);
    };
    for (const [name, value] of Object.entries(this.board.inputs ?? {})) level(name, value);
    for (const b of Object.values(this.board.buttons ?? {})) level(b.pin, b.activeLow ? 1 : 0);
    for (const e of Object.values(this.board.encoders ?? {})) {
      level(e.a, e.activeLow ? 1 : 0);
      level(e.b, e.activeLow ? 1 : 0);
    }
    for (const [name, value] of Object.entries(this.board.analog ?? {})) this.setAnalog(name, value);
    this.selectorPositions ??= {};
    for (const [id, sel] of Object.entries(this.board.selectors ?? {})) {
      this.setAnalog(sel.pin, sel.positions[this.selectorPositions[id] ?? 0].value);
    }
  }

  /** analogRead() value of a pin, honouring a selector's enable line (see boards.js). */
  #readAnalog(pin) {
    for (const sel of Object.values(this.board.selectors ?? {})) {
      if (!sel.enable || this.pin(sel.pin) != pin) continue;
      if (this.levels.get(this.pin(sel.enable.pin)) !== sel.enable.level) return 1;
    }
    return this.analog.get(pin) ?? 0;
  }

  // ------------------------------------------------------------------ display

  /** RGB565 pixels of the display (a live view into WebAssembly memory). */
  get pixels() {
    return new Uint16Array(this.exports.memory.buffer, this.lcd.pointer, this.lcd.width * this.lcd.height);
  }

  /** The area changed since the last call as {x1,y1,x2,y2} (inclusive), or null. */
  takeDirty() {
    const ptr = this.exports.wasmAlloc(16);
    try {
      if (!this.exports.wasmLcdTakeDirty(ptr)) return null;
      const [x1, y1, x2, y2] = new Int32Array(this.exports.memory.buffer, ptr, 4);
      return { x1, y1, x2, y2 };
    } finally {
      this.exports.wasmFree(ptr);
    }
  }

  // ------------------------------------------------------------------ host imports

  #hostImports() {
    return {
      now: () => (typeof performance !== 'undefined' ? performance.timeOrigin + performance.now() : Date.now()),
      pinSet: (pin, value) => {
        if (this.levels.get(pin) === value) return;
        this.levels.set(pin, value);
        this.onPinChange(pin, value);
      },
      pinGet: (pin) => this.levels.get(pin) ?? 0,
      i2cWrite: (bus, address, ptr, length) => (this.i2c.write(bus, address, new Uint8Array(this.exports.memory.buffer, ptr, length).slice()) ? 1 : 0),
      i2cRead: (bus, address, ptr, length) => {
        const data = this.i2c.read(bus, address, length);
        if (!data) return 0;
        new Uint8Array(this.exports.memory.buffer, ptr, length).set(data);
        return 1;
      },
      pinAnalogOut: (pin, value) => {
        this.analogOut.set(pin, value);
        this.onAnalogOut(pin, value);
      },
      pinAnalog: (pin) => this.#readAnalog(pin),
      fsSpace: (totalPtr, freePtr) => {
        // fs.getFree(): an SD card of the board's size (16 GB unless it says), less what's on it
        const total = this.board.sdCardBytes ?? 16 * 1024 ** 3;
        const view = new DataView(this.exports.memory.buffer);
        view.setFloat64(totalPtr, total, true);
        view.setFloat64(freePtr, Math.max(0, total - this.fs.usedBytes()), true);
        return 1;
      },
      busyIdle: () => this.#drainOutput(), // e.g. jshTransmit waiting for room in a full output buffer
      reboot: () => {
        throw new RebootRequest(); // unwinds out of the module; caught in #boot() / idle()
      },
    };
  }
}

/**
 * Copy a rectangle of the display into RGBA bytes laid out like the whole screen
 * (e.g. a canvas ImageData of width x height), converting from RGB565.
 */
export function rgb565ToRgba(pixels, width, rect, rgba) {
  for (let y = rect.y1; y <= rect.y2; y++) {
    for (let x = rect.x1, i = y * width + x; x <= rect.x2; x++, i++) {
      const c = pixels[i];
      const o = i * 4;
      rgba[o] = ((c >> 11) * 527 + 23) >> 6; // 5 bits -> 8 bits
      rgba[o + 1] = (((c >> 5) & 0x3f) * 259 + 33) >> 6; // 6 bits -> 8 bits
      rgba[o + 2] = ((c & 0x1f) * 527 + 23) >> 6;
      rgba[o + 3] = 255;
    }
  }
  return rgba;
}
