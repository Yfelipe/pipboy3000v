// The one connection to the Pip-Boy, shared by every page.
//
// Owns the SerialSession, connecting/disconnecting/restarting (with automatic reconnect after
// a restart), and a cached device summary (firmware, Storage usage, files, SD card) that pages
// render from. Pages subscribe with onDeviceChange().
import { $, notify } from '../ui.js';
import { log } from '../activity.js';
import { SerialSession } from '../serial/session.js';
import { expr } from '../serial/protocol.js';
import { versionAtLeast, FAST_WRITE_CHUNK } from '../serial/device-ops.js';

export const serialAvailable = !!navigator.serial && window.isSecureContext;

export const session = new SerialSession({
  events: {
    log: (level, text) => log(text, level),
    state: () => emit(),
    raw: () => rawListeners.forEach((fn) => fn()),
  },
});
window.__pipboySession = session; // handy for debugging from the console

/**
 * phase: 'offline' | 'connecting' | 'online' | 'restarting'
 * info:  null until read; { version, firmware, stats, files: [[name, size]], sd, readAt }
 */
export const device = {
  phase: 'offline',
  info: null,
  error: null,
  port: null, // the last port that connected (reused by Connect and after restarts)
  userDisconnected: false,
  get connected() {
    return session.connected;
  },
  get busy() {
    return session.busy || !!session.pending || session.opening;
  },
  get asleep() {
    return session.pipState?.sleeping === true; // "BUSY" while switching on or off
  },
  file(name) {
    return this.info?.files.find(([n]) => n === name) ?? null;
  },
};

const listeners = new Set();
const rawListeners = new Set();
let queued = false;

export function onDeviceChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function onRawOutput(fn) {
  rawListeners.add(fn);
}

function emit() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    if (device.phase === 'online' && !session.connected && !session.opening) device.phase = 'offline';
    renderStatus();
    for (const fn of listeners) fn(device);
  });
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------ status bar
function renderStatus() {
  const s = $('connection-status');
  const dot = $('status-dot');
  const connect = $('device-connect');
  const disconnect = $('device-disconnect');
  const wake = $('device-wake');
  let text;
  let tone;
  if (device.phase === 'restarting') {
    text = 'RESTARTING PIP-BOY…';
    tone = 'warn';
  } else if (device.phase === 'connecting' || session.opening) {
    text = 'CONNECTING…';
    tone = 'warn';
  } else if (session.connected) {
    text = session.activeOperation ? `WORKING · ${session.activeOperation.toUpperCase()}` : device.asleep ? 'CONNECTED · PIP-BOY ASLEEP' : 'CONNECTED';
    tone = device.asleep ? 'warn' : 'ok';
  } else {
    text = 'NOT CONNECTED';
    tone = 'off';
  }
  s.textContent = text;
  dot.dataset.tone = tone;
  const online = session.connected || !!session.port;
  connect.hidden = online || device.phase === 'restarting';
  connect.disabled = !serialAvailable || device.phase === 'connecting' || session.opening;
  disconnect.hidden = !online && device.phase !== 'restarting';
  disconnect.disabled = session.busy && device.phase !== 'restarting';
  wake.hidden = !(session.connected && device.asleep);
  wake.disabled = device.busy;
}

// ------------------------------------------------------------ connection
async function authorizedPorts() {
  if (!serialAvailable) return [];
  try {
    return await navigator.serial.getPorts();
  } catch {
    return [];
  }
}

function sameDevice(a, b) {
  try {
    const x = a.getInfo();
    const y = b.getInfo();
    return x.usbVendorId === y.usbVendorId && x.usbProductId === y.usbProductId;
  } catch {
    return false;
  }
}

/** Friendly explanation for a failed connection attempt. */
function connectError(e) {
  if (e.name === 'NotFoundError') return null; // the user closed the port chooser
  if (e.name === 'NotAllowedError' || e.name === 'SecurityError') return 'The browser did not allow access to the serial port.';
  if (e.name === 'InvalidStateError' || /already open/i.test(e.message)) {
    return 'The port is in use by another program or tab (for example the Espruino IDE). Close it there, then try again.';
  }
  if (e.name === 'NetworkError') return 'The port could not be opened. Unplug the Pip-Boy, plug it back in, then try again.';
  return e.message;
}

async function openPort(port) {
  device.phase = 'connecting';
  device.error = null;
  device.info = null; // read afresh for this connection
  emit();
  try {
    await session.open(port);
    device.port = port;
    device.userDisconnected = false;
    device.phase = 'online';
    emit();
    await refreshInfo();
    return true;
  } catch (e) {
    // Leave nothing half-open: the Diagnostics page has Recover for deeper problems.
    if (session.port) await session.close(`Connection failed: ${e.message}`);
    device.phase = 'offline';
    throw e;
  } finally {
    emit();
  }
}

/**
 * Connect to the Pip-Boy. Reuses a port the browser already allowed when there is exactly
 * one (no chooser); otherwise, or with { choose: true }, shows the browser's port chooser.
 * Resolves true when connected. Errors are shown to the user, not thrown.
 */
export async function connect({ choose = false } = {}) {
  if (session.connected) return true;
  if (!serialAvailable) {
    notify('Connecting needs Chrome or Edge, with this page opened from localhost.', true);
    return false;
  }
  if (session.opening || device.phase === 'connecting') return false;
  try {
    let port = null;
    if (!choose) {
      const ports = await authorizedPorts();
      port = ports.find((p) => p === device.port) ?? (ports.length === 1 ? ports[0] : null);
    }
    port ??= await navigator.serial.requestPort({});
    return await openPort(port);
  } catch (e) {
    const text = connectError(e);
    device.error = text;
    if (text) {
      notify(`Could not connect: ${text}`, true);
      log(`Could not connect: ${text}`, 'error');
    }
    emit();
    return false;
  }
}

export async function disconnect() {
  device.userDisconnected = true;
  device.phase = 'offline';
  if (session.busy) session.requestCancel();
  await session.close('Disconnected by user');
  emit();
}

/** For buttons that need the device: connect first if necessary (one click does both). */
export async function ensureConnected() {
  if (session.connected) return true;
  if (device.phase === 'restarting') {
    notify('The Pip-Boy is restarting. Try again once it has reconnected.', true);
    return false;
  }
  return connect();
}

/**
 * Restart the Pip-Boy into its firmware (E.reboot) and reconnect when it's back.
 * The USB connection drops during a restart. Resolves true once reconnected.
 */
export async function restart({ timeoutMs = 60_000 } = {}) {
  const port = device.port ?? session.port;
  device.phase = 'restarting';
  emit();
  log('Restarting the Pip-Boy');
  try {
    await session.send('\x10E.reboot();\n');
  } catch {}
  await pause(1500);
  await session.close('Restarting the Pip-Boy');
  device.phase = 'restarting';
  emit();
  const end = Date.now() + timeoutMs;
  await pause(2500);
  while (Date.now() < end && device.phase === 'restarting') {
    const ports = await authorizedPorts();
    const next = ports.find((p) => p === port) ?? ports.find((p) => port && sameDevice(p, port));
    if (next) {
      try {
        device.info = null;
        await session.open(next);
        device.port = next;
        device.phase = 'online';
        log('Reconnected after restart');
        emit();
        await refreshInfo();
        return true;
      } catch {
        if (session.port) await session.close('Not ready yet');
      }
    }
    await pause(2000);
  }
  if (device.phase === 'restarting') device.phase = 'offline';
  emit();
  return session.connected;
}

// ---------------------------------------------------------------- summary
/** Re-read firmware, Storage usage, files and SD presence. Call inside session.run or alone. */
export async function readInfo() {
  const t0 = Date.now();
  const r = await session.transaction(expr.deviceSummary(), 'value', { timeout: 15_000, replyBytes: 2000 });
  const t1 = Date.now();
  if (!r || !Array.isArray(r.files)) throw new Error('Unexpected status reply');
  device.info = {
    version: typeof r.version === 'string' ? r.version : null,
    firmware: typeof r.firmware === 'string' && /^[\x20-\x7e]{1,24}$/.test(r.firmware.trim()) ? r.firmware.trim() : null,
    stats: r.stats && typeof r.stats.totalBytes === 'number' ? r.stats : null,
    files: r.files.filter((f) => Array.isArray(f) && typeof f[0] === 'string'),
    sd: r.sd === true,
    pipos: r.pipos === true, // the stock interface is running (not an app)
    // The app set to open at power-on (our .bootPowerOn), '' for a .bootPowerOn that isn't ours
    startApp: typeof r.powerOn === 'string' ? (/companion-startapp/.test(r.powerOn) ? (/load\("([^"]+)"\)/.exec(r.powerOn)?.[1] ?? '') : '') : null,
    // How far the Pip-Boy's clock is ahead of this computer's (ms), allowing for the round trip
    clockDrift: Number.isFinite(r.now) && t1 - t0 < 5000 ? r.now - (t0 + t1) / 2 : null,
    readAt: Date.now(),
  };
  session.sdAvailable = device.info.sd;
  session.writeChunkBytes = versionAtLeast(device.info.version, 2, 29) ? FAST_WRITE_CHUNK : undefined;
  emit();
  return device.info;
}

/** Refresh the summary as its own small operation (skipped while something else runs). */
export async function refreshInfo() {
  if (!session.connected || session.busy || session.pending) return device.info;
  const result = await session.run('Read Pip-Boy status', readInfo);
  if (!result.ok) log(`Could not read the Pip-Boy's status: ${result.error.message}`, 'error');
  return device.info;
}

/** Storage numbers for display: { total, used, trash, free } in bytes, or null. */
export function storageUsage() {
  const info = device.info;
  if (!info) return null;
  if (info.stats) {
    const { totalBytes: total, freeBytes: free, trashBytes: trash = 0 } = info.stats;
    return { total, free, trash, used: Math.max(0, total - free - trash), exact: true };
  }
  const used = info.files.reduce((n, [, size]) => n + Math.max(0, size), 0);
  return { total: null, free: null, trash: 0, used, exact: false };
}

// ------------------------------------------------------------------- init
export function initDeviceState() {
  if (serialAvailable) {
    navigator.serial.addEventListener('disconnect', (e) => {
      const port = e.target === navigator.serial ? e.port : e.target;
      if (device.phase === 'restarting') return; // expected; restart() reconnects
      if (!session.port || port !== session.port) return;
      void session.close('The Pip-Boy was unplugged or switched off');
      notify('The Pip-Boy disconnected.', true);
    });
    // Plugged back in after being unplugged (not after a manual disconnect): reconnect.
    navigator.serial.addEventListener('connect', (e) => {
      const port = e.target === navigator.serial ? e.port : e.target;
      if (device.phase !== 'offline' || device.userDisconnected || !device.port || session.port) return;
      if (port !== device.port && !sameDevice(port, device.port)) return;
      setTimeout(() => void openPort(port).catch(() => {}), 2500);
    });
  }
  $('device-connect').addEventListener('click', () => connect());
  $('device-disconnect').addEventListener('click', () => disconnect());
  window.addEventListener('pagehide', () => {
    if (session.port) void session.close('Page closed');
  });
  emit();
}
