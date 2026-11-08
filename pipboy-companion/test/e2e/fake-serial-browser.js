// Injected into the page before any app code runs (Playwright addInitScript).
// Provides navigator.serial with one fake Pip-Boy that evaluates REPL lines
// against a model of Espruino Storage / fs. State is exposed as window.__fakeDevice.
export function installFakeSerial({ storage = {}, sd = {}, capacity = 131072, trash = 0, clockOffset = 0, sdSize = 0 } = {}) {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const device = {
    storage: new Map(Object.entries(storage)),
    sizes: new Map(Object.entries(storage).map(([k, v]) => [k, v.length])),
    sd: new Map(Object.entries(sd)),
    sdDirs: new Set(),
    lines: [],
    trash, // bytes of erased/overwritten files, as on the real one-page Storage
    reboots: 0,
    clockOffset, // how far the device clock is ahead of the browser's (ms)
    resets: 0,
  };
  const footprint = (len) => 32 + Math.ceil(len / 8) * 8;
  window.__fakeDevice = device;

  const Storage = {
    write(name, data, offset, size) {
      data = String(data);
      const cur = device.storage.get(name);
      if (cur === undefined || offset === undefined || (offset === 0 && size !== undefined)) {
        const total = size ?? data.length;
        if ((offset || 0) + data.length > total) throw new Error('Too much data for file size');
        if (cur !== undefined) {
          device.trash += footprint(cur.length);
          device.storage.delete(name);
        }
        if (Storage.getStats().freeBytes < footprint(total)) throw new Error('Unable to find or create file');
        device.storage.set(name, data.padEnd(total, '\xff'));
        return true;
      }
      if (offset + data.length > cur.length) throw new Error('Too much data for file size');
      device.storage.set(name, cur.slice(0, offset) + data + cur.slice(offset + data.length));
      return true;
    },
    read(name, offset = 0, length) {
      const s = device.storage.get(name);
      if (s === undefined) return undefined;
      return length === undefined ? s.slice(offset) : s.slice(offset, offset + length);
    },
    erase(name) {
      const cur = device.storage.get(name);
      if (cur !== undefined) device.trash += footprint(cur.length);
      device.storage.delete(name);
    },
    eraseAll() { device.storage.clear(); device.trash = 0; },
    list() { return [...device.storage.keys()]; },
    getStats() {
      const fileBytes = [...device.storage.values()].reduce((n, v) => n + footprint(v.length), 0);
      return { totalBytes: capacity, fileBytes, fileCount: device.storage.size, trashBytes: device.trash, trashCount: 0, freeBytes: capacity - fileBytes - device.trash };
    },
  };
  const isDir = (p) => p === '/' || device.sdDirs.has(p) || [...device.sd.keys()].some((f) => f.startsWith(p + '/'));
  const fs = {
    readdirSync(dir) {
      if (!isDir(dir)) throw new Error('Directory not found');
      const prefix = dir === '/' ? '/' : dir + '/';
      const names = new Set(['.', '..']);
      for (const p of [...device.sd.keys(), ...device.sdDirs]) if (p.startsWith(prefix) && p.length > prefix.length) names.add(p.slice(prefix.length).split('/')[0]);
      return [...names];
    },
    statSync(p) {
      if (device.sd.has(p)) return { size: device.sd.get(p).length, dir: false };
      if (isDir(p)) return { size: 0, dir: true };
      throw new Error('not found');
    },
    mkdirSync(p) { device.sdDirs.add(p); return true; },
    mkdir(p) { p = p[0] == '/' ? p : '/' + p; device.sdDirs.add(p); return true; },
    getFree() {
      if (!sdSize) return undefined;
      const used = [...device.sd.values()].reduce((n, v) => n + v.length, 0);
      return { freeSectors: Math.floor((sdSize - used) / 512), totalSectors: sdSize / 512, sectorSize: 512, clusterSize: 8 };
    },
    readFile(p) { p = p[0] == '/' ? p : '/' + p; if (!device.sd.has(p)) throw new Error('NO_PATH'); return device.sd.get(p); },
    writeFile(p, d) { p = p[0] == '/' ? p : '/' + p; device.sd.set(p, String(d)); return true; },
    unlinkSync(p) { if (!device.sd.delete(p)) throw new Error('Could not delete'); return true; },
  };
  const E = {
    CRC32(str) {
      let c = 0xffffffff;
      for (let i = 0; i < str.length; i++) {
        c ^= str.charCodeAt(i) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      return (c ^ 0xffffffff) >>> 0;
    },
    kickWatchdog() {},
    reboot() { device.reboots++; },
    openFile(p, mode) {
      if (mode === 'r') {
        let pos = 0;
        const s = device.sd.get(p);
        return { read(n) { if (pos >= s.length) return undefined; const r = s.slice(pos, pos + n); pos += n; return r; }, close() {} };
      }
      let out = '';
      return { write(s) { out += s; }, close() { device.sd.set(p, out); } };
    },
  };

  let controller = null;
  const emit = (t) => controller?.enqueue(enc.encode(t));
  const scope = {
    print: (s) => emit(String(s) + '\r\n'),
    require: (m) => (m === 'Storage' ? Storage : m === 'fs' ? fs : (() => { throw new Error('Module ' + m + ' not found'); })()),
    E,
    process: { env: { BOARD: 'PIPBOY', VERSION: '2v24.99' }, version: '2v24.99', memory: () => ({ free: 9000, total: 12000 }) },
    Pip: { radioOn() {}, audioStart() {} },
    reset: () => { device.resets++; },
    // Wrapped: native btoa/atob throw "Illegal invocation" when called with `this` = scope.
    btoa: (s) => btoa(typeof s === 'string' ? s : String.fromCharCode(...new Uint8Array(s))),
    Date: { now: () => Date.now() + device.clockOffset },
    setTime: (sec) => { device.clockOffset = sec * 1000 - Date.now(); },
    Uint16Array,
    Math,
    g: {
      toColor(r, g, b) {
        const c = (v) => Math.max(0, Math.min(255, Math.trunc(v * 256)));
        return ((c(b) >> 3) | ((c(g) >> 2) << 5) | ((c(r) >> 3) << 11)) >>> 0;
      },
    },
    atob: (s) => atob(s),
    JSON,
    String,
  };
  scope.global = scope;

  let buf = '';
  function handle(line) {
    const code = line.replace(/^\x10/, '').replace(/\x03/g, '').trim();
    device.lines.push(code);
    if (code) {
      try {
        // eslint-disable-next-line no-new-func
        new Function('scope', 'with (scope) {' + code + '}')(scope);
      } catch (e) {
        emit('Uncaught ' + e.message + '\r\n');
      }
    }
    emit('>');
  }

  const port = {
    getInfo: () => ({ usbVendorId: 0x0483, usbProductId: 0x5740 }),
    async open() {
      port.readable = new ReadableStream({ start(c) { controller = c; } });
      port.writable = new WritableStream({
        write(chunk) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            setTimeout(() => handle(line), 2);
          }
        },
      });
    },
    async close() { try { controller?.close(); } catch {} controller = null; },
  };
  const listeners = {};
  let granted = false;
  const serial = {
    requestPort: async () => { granted = true; return port; },
    getPorts: async () => (granted ? [port] : []),
    addEventListener: (t, fn) => { (listeners[t] ||= []).push(fn); },
    removeEventListener() {},
  };
  Object.defineProperty(Navigator.prototype, 'serial', { get: () => serial, configurable: true });
}
