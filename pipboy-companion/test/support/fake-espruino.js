// A fake Pip-Boy running Espruino, exposing the Web Serial port shape
// ({ open, close, readable, writable, getInfo }). It evaluates each REPL line
// with a model of Espruino's Storage / fs semantics, so tests exercise the real
// command strings the app sends.
import vm from 'node:vm';

const toB = (s) => Buffer.from(s, 'latin1');

/** Model of require("Storage"): flash files can't grow past the size fixed by the first write. */
export class FakeStorage {
  constructor(files = {}) {
    this.files = new Map(Object.entries(files).map(([k, v]) => [k, toB(v)]));
  }
  write(name, data, offset, size) {
    data = String(data);
    const bytes = toB(data);
    const existing = this.files.get(name);
    if (!existing || offset === undefined || (offset === 0 && size !== undefined)) {
      const total = size ?? bytes.length;
      if ((offset ?? 0) + bytes.length > total) throw new Error('Too much data for file size');
      const buf = Buffer.alloc(total, 0xff);
      bytes.copy(buf, offset ?? 0);
      this.files.set(name, buf);
      return true;
    }
    if (offset + bytes.length > existing.length) throw new Error('Too much data for file size');
    // Flash can only clear bits: writing over already-written bytes corrupts them.
    for (let i = 0; i < bytes.length; i++) existing[offset + i] &= bytes[i];
    return true;
  }
  read(name, offset = 0, length) {
    const buf = this.files.get(name);
    if (!buf) return undefined;
    const end = length === undefined ? buf.length : Math.min(buf.length, offset + length);
    return buf.subarray(offset, end).toString('latin1');
  }
  erase(name) {
    this.files.delete(name);
  }
  list() {
    return [...this.files.keys()];
  }
  getFree() {
    return 1_000_000 - [...this.files.values()].reduce((n, b) => n + b.length, 0);
  }
  getStats() {
    return { fileBytes: 1_000_000 - this.getFree(), fileCount: this.files.size };
  }
  text(name) {
    return this.files.get(name)?.toString('utf8');
  }
}

export class FakeSd {
  /** files: { "/a.txt": "…", "/MUSIC/x y.wav": "…" }; dirs: extra empty folders. */
  constructor(files = {}, dirs = []) {
    this.files = new Map(Object.entries(files).map(([k, v]) => [k, toB(v)]));
    this.dirs = new Set(dirs);
  }
  #norm(p) {
    p = String(p);
    if (!p.startsWith('/')) p = `/${p}`;
    return p.length > 1 ? p.replace(/\/+$/, '') : p;
  }
  #isDir(p) {
    if (p === '/') return true;
    if (this.dirs.has(p)) return true;
    for (const f of this.files.keys()) if (f.startsWith(`${p}/`)) return true;
    return false;
  }
  readdirSync(dir) {
    dir = this.#norm(dir);
    if (!this.#isDir(dir)) throw new Error('Directory not found');
    const prefix = dir === '/' ? '/' : `${dir}/`;
    const names = new Set(['.', '..']); // like FatFS, include dot entries for the app to filter
    for (const p of [...this.files.keys(), ...this.dirs]) {
      if (p.startsWith(prefix) && p.length > prefix.length) names.add(p.slice(prefix.length).split('/')[0]);
    }
    return [...names];
  }
  statSync(path) {
    path = this.#norm(path);
    const b = this.files.get(path);
    if (b) return { size: b.length, dir: false };
    if (this.#isDir(path)) return { size: 0, dir: true };
    throw new Error(`File ${path} not found`);
  }
  mkdirSync(path) {
    path = this.#norm(path);
    if (this.files.has(path) || this.#isDir(path)) throw new Error('Already exists');
    this.dirs.add(path);
    return true;
  }
  unlinkSync(path) {
    path = this.#norm(path);
    if (this.files.delete(path)) return true;
    if (this.dirs.has(path) && !this.readdirSync(path).some((n) => n !== '.' && n !== '..')) {
      this.dirs.delete(path);
      return true;
    }
    throw new Error('Could not delete');
  }
  open(path, mode) {
    if (mode === 'r') {
      const buf = this.files.get(path);
      if (!buf) throw new Error('File not found');
      let pos = 0;
      return {
        read: (n) => {
          if (pos >= buf.length) return undefined;
          const s = buf.subarray(pos, pos + n).toString('latin1');
          pos += n;
          return s;
        },
        close() {},
      };
    }
    const parts = [];
    return {
      write: (s) => parts.push(toB(String(s))),
      close: () => this.files.set(path, Buffer.concat(parts)),
    };
  }
}

export function createFakePipBoy({
  board = 'PIPBOY',
  storage = {},
  sd = {},
  sdDirs = [],
  respond = true,
  hooks = {},
  transform = (text) => text, // rewrite device output, e.g. to mimic terminal quirks
  // Model of the real Pip-Boy behaviour seen in the logs: the most recent write is held
  // by the device and only processed when the next write arrives (survives reconnects).
  holdLastTransfer = false,
  silentPrompt = false, // real device printed nothing for a bare newline
  // Second model, matching the 11:19 logs: a command's output is only released when the
  // NEXT non-empty command runs; bare newlines don't release it.
  holdOutputUntilNextCommand = false,
  // Third model, matching the 11:26 logs exactly: output is queued and the device sends ONE
  // packet of up to `packetSize` bytes each time it starts running a (non-empty) line.
  packetPerLine = false,
  packetSize = 63,
  // Timing realism: run lines one at a time, each taking this long.
  lineDelayMs = 0,
  // Whether a device timer firing also sends a packet (unknown on the real Pip-Boy; probed).
  timerWake = false,
  // Sleep model (13:21 logs): after idleTimeoutMs without Pip.kickIdleTimer() the Pip-Boy sleeps
  // and then behaves like packetPerLine (one packet per line run, timers don't help).
  idleTimeoutMs = 0,
} = {}) {
  const state = {
    storage: new FakeStorage(storage),
    sd: new FakeSd(sd, sdDirs),
    open: false,
    lines: [],
    board,
    respond,
    hooks,
    lowMemoryNext: false,
    sentBytes: 0,
  };
  let controller;
  let lineBuf = '';
  const decoder = new TextDecoder();

  let heldOutput = '';
  let capturing = false;
  const emit = (text) => {
    if (capturing) {
      heldOutput += text;
      return;
    }
    if (!controller) return;
    try {
      controller.enqueue(new TextEncoder().encode(transform(text)));
    } catch {}
  };

  function releasePacket() {
    const bytes = Buffer.from(heldOutput, 'utf8');
    const packet = bytes.subarray(0, packetSize);
    heldOutput = bytes.subarray(packet.length).toString('utf8');
    if (packet.length) emit(packet.toString('utf8'));
  }
  const wrapTimer = (fn) => () => {
    if ((packetPerLine || state.asleep) && timerWake && !state.asleep && !capturing) releasePacket();
    fn();
  };
  const timers = new Set();

  // Firmware-provided globals the API inventory should find (a stand-in for Pip-Boy built-ins).
  const firmwareGlobals = {
    Pip: {
      audioStart() {}, audioStop() {}, radioOn() {}, setVolume() {}, remove() {},
      sleeping: false,
      idleTimer: undefined,
      kickIdleTimer() {
        clearTimeout(this.idleTimer);
        this.idleTimer = idleTimeoutMs ? setTimeout(() => goToSleep(), idleTimeoutMs) : undefined;
        this.idleTimer?.unref?.();
        state.kicks = (state.kicks ?? 0) + 1;
      },
      powerButtonHandler() {
        if (this.sleeping) {
          this.sleeping = false;
          state.asleep = false;
          this.kickIdleTimer();
        } else {
          state.switchedOff = true; // what the real handler does to an awake Pip-Boy
        }
      },
    },
    Graphics: Object.assign(function Graphics() {}, { createArrayBuffer() {} }),
    BIG_TABLE: new Array(5000).fill(0), // must be summarised, not listed
  };
  firmwareGlobals.Graphics.prototype = { drawString() {}, setColor() {}, flip() {} };
  firmwareGlobals.VUSB_PRESENT = { read: () => true };
  firmwareGlobals.settings = { idleTimeout: idleTimeoutMs };
  function goToSleep() {
    firmwareGlobals.Pip.sleeping = true;
    state.asleep = true;
  }
  firmwareGlobals.Pip.kickIdleTimer();
  const globals = { ...firmwareGlobals };
  const context = vm.createContext({
    ...firmwareGlobals,
    setInterval: (fn, ms) => {
      const t = setInterval(wrapTimer(fn), ms);
      timers.add(t);
      return t;
    },
    clearInterval: (t) => {
      clearInterval(t);
      timers.delete(t);
    },
    Array,
    print: (...a) => emit(a.join(' ') + '\r\n'),
    require: (m) => {
      if (m === 'Storage') return state.storage;
      if (m === 'fs') return state.sd;
      throw new Error(`Module ${m} not found`);
    },
    E: {
      openFile: (p, mode) => state.sd.open(p, mode),
      CRC32: (str) => { // as Espruino's native E.CRC32 on a byte string
        let c = 0xffffffff;
        for (let i = 0; i < str.length; i++) {
          c ^= str.charCodeAt(i) & 0xff;
          for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        return (c ^ 0xffffffff) >>> 0;
      },
      getFlags: () => ({ pretokenise: 1 }),
      getTimeZone: () => 13,
      getConsole: () => 'USB',
    },
    process: {
      env: { get BOARD() { return state.board; }, VERSION: '2v24.99', SERIAL: 'fake-serial' },
      version: '2v24.99',
      memory: () => ({ free: 9000, usage: 3000, total: 12000 }),
    },
    Object,
    Date,
    btoa: (s) => Buffer.from(String(s), 'latin1').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('latin1'),
    JSON,
    String,
    global: globals,
  });
  // `global.__pbRead = …` then `__pbRead.read()` must resolve to the same object.
  context.global = new Proxy(globals, {
    set(t, k, v) { t[k] = v; context[k] = v; return true; },
    deleteProperty(t, k) { delete t[k]; delete context[k]; return true; },
  });

  function handleLine(line) {
    if (line.includes('\x03')) {
      emit('\r\n>');
      line = line.replace(/\x03/g, '');
    }
    const code = line.replace(/^\x10/, '').trim();
    state.lines.push(code);
    if (!code) {
      if (!silentPrompt) emit('\r\n>');
      return;
    }
    if (holdOutputUntilNextCommand) {
      const release = heldOutput;
      heldOutput = '';
      if (release) emit(release);
      capturing = true;
    } else if (packetPerLine || state.asleep) {
      releasePacket();
      capturing = true;
    } else if (heldOutput) {
      // Awake again (e.g. after Wake): anything held while asleep goes out normally.
      const all = heldOutput;
      heldOutput = '';
      emit(all);
    }
    try {
      runLine(code);
    } finally {
      capturing = false;
      if (!holdOutputUntilNextCommand && !packetPerLine && !state.asleep && heldOutput) {
        // This line woke the device: its output is sent right away.
        const all = heldOutput;
        heldOutput = '';
        emit(all);
      }
    }
  }

  function runLine(code) {
    if (state.hooks.beforeEval?.(code, { emit, state }) === false) return;
    if (!state.respond) return;
    if (state.lowMemoryNext) {
      state.lowMemoryNext = false;
      emit('New interpreter error: LOW_MEMORY,MEMORY\r\n>');
      return;
    }
    try {
      vm.runInContext(code, context, { timeout: 2000 });
    } catch (e) {
      emit(`Uncaught ${e.message}\r\n`);
    }
    if (!silentPrompt) emit('>');
  }

  const lineQueue = [];
  let lineRunning = false;
  function runQueue() {
    lineRunning = true;
    setTimeout(() => {
      const line = lineQueue.shift();
      if (line !== undefined) handleLine(line);
      if (lineQueue.length) runQueue();
      else lineRunning = false;
    }, Math.max(1, lineDelayMs));
  }

  function processBytes(chunk) {
    lineBuf += decoder.decode(chunk, { stream: true });
    let i;
    while ((i = lineBuf.indexOf('\n')) >= 0) {
      const line = lineBuf.slice(0, i);
      lineBuf = lineBuf.slice(i + 1);
      // Respond asynchronously like a real device, one line at a time.
      lineQueue.push(line);
      if (!lineRunning) runQueue();
    }
    if (lineBuf === '\x03') {
      lineBuf = '';
      setTimeout(() => emit('\r\n>'), 1);
    }
  }
  let held = null;

  const port = {
    state,
    getInfo: () => ({ usbVendorId: 0x0483, usbProductId: 0x5740 }),
    async open(options) {
      if (state.open) throw new Error('Port already open');
      state.open = true;
      state.options = options;
      port.readable = new ReadableStream({
        start(c) { controller = c; },
        cancel() { controller = null; },
      });
      port.writable = new WritableStream({
        write(chunk) {
          state.sentBytes += chunk.length;
          state.writes = (state.writes ?? 0) + 1;
          if (holdLastTransfer) {
            const previous = held;
            held = new Uint8Array(chunk);
            if (previous) processBytes(previous);
          } else {
            processBytes(chunk);
          }
        },
      });
    },
    async close() {
      for (const t of timers) clearInterval(t);
      timers.clear();
      state.open = false;
      try { controller?.close(); } catch {}
      controller = null;
    },
    emit,
    /** Simulate unplugging the cable. */
    unplug() {
      try { controller?.error(new Error('The device has been lost.')); } catch {}
      controller = null;
      state.open = false;
    },
  };
  return port;
}
