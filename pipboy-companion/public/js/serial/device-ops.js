// High-level device operations built on SerialSession transactions. No DOM.
import { expr, bytesToBase64, base64ToBytes, byteChecksum } from './protocol.js';
import { validateStorageName, validateSdPath, sdJoin, encodeStorageFileName, crc32 } from '../../../shared/validate.js';

/** The Storage file that holds Pip-OS. Without it the Pip-Boy has no stock interface. */
export const FIRMWARE_FILE = '.bootcde';
/** Do these [name, bytes] entries leave out the firmware? */
export const lacksFirmware = (entries) => !entries.some(([name]) => name === FIRMWARE_FILE);

/**
 * Erasing is only for a board that says it's a Pip-Boy. Connecting accepts a device that
 * reports no board name at all, which is fine for reading but not for wiping its Storage.
 */
export function requirePipBoy(session) {
  if (session.board !== 'PIPBOY') {
    throw new Error('This device didn’t report that it’s a Pip-Boy, so its Storage won’t be erased');
  }
}

export const STORAGE_MAX_BYTES = 65_000; // for single files picked by the user
/** The Pip-Boy's whole Storage area: one 128 KB flash page (boards/PIPBOY.py). */
export const STORAGE_TOTAL_BYTES = 131_072;
// Espruino Storage: each file has a 32 byte header and is padded to the flash alignment
const STORAGE_FILE_OVERHEAD = 32;
const STORAGE_ALIGN = 8;
export const SD_MAX_BYTES = 8_000_000;
// Chunk sizes (bytes of file data per REPL command). Bigger means fewer round trips; the base64
// copy on the device is ~4/3 of this, so stay well clear of low-memory territory.
export const STORAGE_CHUNK = 384; // write
/**
 * Whole files are verified in slices this big. The Pip-Boy's watchdog restarts it if one
 * command keeps it busy for 15 s; a JS checksum over its 103 KB firmware file did exactly that.
 */
export const STORAGE_VERIFY_SLICE = 16384;
export const STORAGE_READ_CHUNK = 768;
export const SD_CHUNK = 384; // write
export const SD_READ_CHUNK = 768;
/**
 * Pip-OS 1.33 (Espruino 2v29) quadrupled the console's input buffer (io_buffer_size 512 ->
 * 2048 in boards/PIPBOY.py), so a write command can carry twice the data in one line.
 */
export const FAST_WRITE_CHUNK = 768;
/** Write chunk for this session: SerialSession.writeChunkBytes is set once the firmware is known. */
const writeChunk = (session, fallback) => session.writeChunkBytes ?? fallback;

/** Does an Espruino version string ("2v29.400") reach `major`v`minor`? */
export function versionAtLeast(version, major, minor) {
  const m = /^(\d+)v(\d+)/.exec(version ?? '');
  return !!m && (Number(m[1]) > major || (Number(m[1]) === major && Number(m[2]) >= minor));
}
/** Expected reply size for a chunk read (base64 data + checksum fields). */
const readReply = (length) => Math.ceil((length * 4) / 3) + 40;
export const BACKUP_MAX_FILES = 200;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const noop = () => {};

/** Text -> UTF-8 bytes; strings from a v1 Storage backup are byte strings (one char per byte). */
export const utf8 = (text) => new TextEncoder().encode(text);
export function byteString(text) {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 255) return utf8(text); // not a byte string – treat as text
    out[i] = c;
  }
  return out;
}

// ------------------------------------------------------- Espruino Storage

/**
 * List internal-flash Storage files.
 * Fix: the original "Espruino Storage files" panel listed the SD card (fs.readdirSync).
 */
export async function storageList(session) {
  const names = await session.transaction(expr.storageList(), 'list', { replyBytes: 600 });
  return names.filter((n) => typeof n === 'string');
}

export async function storageRead(session, name, { onProgress = noop, chunkDelayMs = 0, anyName = false } = {}) {
  // anyName: the dump must read system / StorageFile names (e.g. "log\u0001") byte-exactly.
  // The name is always passed to the device JSON-quoted, so this is safe.
  if (anyName) {
    if (typeof name !== 'string' || !name || name.length > 64) throw new Error('Invalid Storage name');
  } else {
    validateStorageName(name);
  }
  const total = await session.command(expr.storageSize(name));
  if (total === null) return null;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Unexpected Storage size response');
  const out = new Uint8Array(total);
  let offset = 0;
  while (offset < total) {
    session.checkCancelled('Cancelled between chunks');
    const length = Math.min(STORAGE_READ_CHUNK, total - offset);
    const res = await session.command(expr.storageReadChunk(name, offset, length), 20_000, { replyBytes: readReply(length) });
    const bytes = base64ToBytes(res?.data ?? '');
    if (!res || bytes.length !== res.size || bytes.length === 0 || byteChecksum(bytes) !== res.checksum) {
      throw new Error('Storage chunk checksum mismatch');
    }
    out.set(bytes, offset);
    offset += bytes.length;
    onProgress(offset / Math.max(total, 1));
    if (chunkDelayMs) await pause(chunkDelayMs);
  }
  return out;
}

/**
 * Write bytes to Storage and verify size + checksum on the device.
 * Fixes: sizes the file on the first write, sends raw bytes (base64) so UTF-8 survives,
 * and verifies with a single read.
 */
export async function storageWrite(session, name, bytes, { onProgress = noop, chunkDelayMs = 0, maxBytes = STORAGE_MAX_BYTES } = {}) {
  validateStorageName(name);
  if (!(bytes instanceof Uint8Array)) throw new Error('Expected file bytes');
  if (bytes.length === 0) throw new Error('Espruino Storage cannot hold an empty file');
  if (bytes.length > maxBytes) throw new Error(`File exceeds ${Math.round(maxBytes / 1000)} KB safety limit`);
  await session.command(expr.storageErase(name));
  const size = writeChunk(session, STORAGE_CHUNK);
  for (let offset = 0; offset < bytes.length; offset += size) {
    session.checkCancelled('Cancelled between chunks; partial file may remain');
    const chunk = bytes.subarray(offset, offset + size);
    const ok = await session.command(expr.storageWriteChunk(name, bytesToBase64(chunk), offset, bytes.length), 20_000);
    if (ok !== true) throw new Error(`Storage write rejected at offset ${offset}; partial file may remain`);
    onProgress(((offset + chunk.length) / bytes.length) * 0.9);
    if (chunkDelayMs) await pause(chunkDelayMs);
  }
  // Verify slice by slice with the device's native E.CRC32
  for (let offset = 0; offset < bytes.length; offset += STORAGE_VERIFY_SLICE) {
    const slice = bytes.subarray(offset, offset + STORAGE_VERIFY_SLICE);
    const check = await session.command(expr.storageVerify(name, offset, STORAGE_VERIFY_SLICE));
    if (!check || check.total !== bytes.length || check.size !== slice.length) throw new Error('Size mismatch; write not verified');
    if (typeof check.crc !== 'number') {
      // No E.CRC32 on this firmware: read the file back in checksummed chunks and compare
      const back = await storageRead(session, name);
      if (!back || back.length !== bytes.length || back.some((b, i) => b !== bytes[i])) throw new Error('Read-back mismatch; write not verified');
      break;
    }
    if (check.crc !== crc32(slice)) throw new Error(`CRC mismatch at offset ${offset}; write not verified`);
  }
  onProgress(1);
  return { name, size: bytes.length, crc: crc32(bytes) };
}

export async function storageDelete(session, name) {
  validateStorageName(name);
  await session.command(expr.storageErase(name));
  const size = await session.command(expr.storageSize(name));
  if (size !== null) throw new Error('Deletion not verified');
}

/** Back up every Storage file as base64 (v2). Names Storage reports that we cannot restore are skipped. */
export async function storageBackup(session, { onProgress = noop } = {}) {
  const names = await storageList(session);
  const files = {};
  const skipped = [];
  for (let i = 0; i < names.length; i++) {
    session.checkCancelled('Cancelled before next file');
    const name = names[i];
    try {
      validateStorageName(name);
    } catch {
      skipped.push(name);
      continue;
    }
    const bytes = await storageRead(session, name);
    if (bytes) files[name] = bytesToBase64(bytes);
    onProgress((i + 1) / names.length);
  }
  return { backup: { format: 'espruino-storage-backup', version: 2, encoding: 'base64', created_at: new Date().toISOString(), files }, skipped };
}

/** Validate a Storage backup (v1 byte strings or v2 base64) and return [name, bytes] entries. */
export function parseStorageBackup(data, { maxBytes = STORAGE_TOTAL_BYTES } = {}) {
  if (!data || data.format !== 'espruino-storage-backup' || !data.files || typeof data.files !== 'object' || Array.isArray(data.files)) {
    throw new Error('Invalid Storage backup');
  }
  const entries = Object.entries(data.files);
  if (entries.length > BACKUP_MAX_FILES) throw new Error('Too many files');
  const base64 = data.version >= 2 && data.encoding === 'base64';
  return entries.map(([name, content]) => {
    validateStorageName(name);
    if (typeof content !== 'string') throw new Error(`Invalid content for ${name}`);
    const bytes = base64 ? base64ToBytes(content) : byteString(content);
    if (bytes.length > maxBytes) throw new Error(`${name} is larger than Storage (${maxBytes} bytes)`);
    return [name, bytes];
  });
}

/** Write backup entries over Storage without erasing it first (needs the free space). */
export async function storageRestore(session, entries, { onProgress = noop } = {}) {
  for (let i = 0; i < entries.length; i++) {
    session.checkCancelled('Cancelled before next file; earlier files may already be restored');
    const [name, bytes] = entries[i];
    await storageWrite(session, name, bytes, { chunkDelayMs: 0, maxBytes: STORAGE_TOTAL_BYTES });
    onProgress((i + 1) / entries.length);
  }
}

/** Bytes a set of files takes in Storage, headers and padding included. */
export function storageFootprint(entries) {
  return entries.reduce((n, [, bytes]) => n + STORAGE_FILE_OVERHEAD + Math.ceil(bytes.length / STORAGE_ALIGN) * STORAGE_ALIGN, 0);
}

/**
 * Replace everything in Storage with `entries` ([name, bytes]): stop the running program
 * (reset() without boot code, because the firmware runs from Storage), erase Storage, then
 * write and verify every file, largest first.
 *
 * This is also how deleted files' space comes back on the Pip-Boy: its Storage is a single
 * 128 KB flash page, and Espruino can only compact it with a buffer that size, which the
 * device doesn't have once the firmware is installed. Call it with a fresh, verified backup.
 */
export async function storageRebuild(session, entries, { onProgress = noop, onPhase = noop } = {}) {
  if (!entries.length) throw new Error('Nothing to write: refusing to leave Storage empty');
  entries.forEach(([name, bytes]) => {
    validateStorageName(name);
    if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error(`${name}: empty or invalid file`);
  });
  if (new Set(entries.map(([n]) => n)).size !== entries.length) throw new Error('Duplicate file names');
  requirePipBoy(session);
  const stats = await session.command(expr.storageStats());
  const capacity = stats?.totalBytes ?? STORAGE_TOTAL_BYTES;
  const need = storageFootprint(entries);
  if (need > capacity) throw new Error(`The files need ${need} bytes but Storage holds ${capacity}`);

  onPhase('Stopping the running program (reset)');
  await session.softReset();
  onPhase('Erasing Storage');
  await session.command(expr.storageEraseAll(), 30_000);
  const left = await session.command(expr.storageList());
  if (!Array.isArray(left) || left.length) throw new Error('Storage did not erase');

  const ordered = [...entries].sort((a, b) => b[1].length - a[1].length);
  const total = ordered.reduce((n, [, b]) => n + b.length, 0);
  let done = 0;
  for (const [name, bytes] of ordered) {
    session.checkCancelled(`Cancelled before writing ${name}; Storage is incomplete - run this again with the backup`);
    onPhase(`Writing ${name} (${bytes.length} bytes)`);
    await storageWrite(session, name, bytes, {
      maxBytes: capacity,
      onProgress: (p) => onProgress((done + p * bytes.length) / total),
    });
    done += bytes.length;
  }
  return session.command(expr.storageStats());
}

// ------------------------------------------------------------------- SD

export async function sdList(session) {
  const names = await session.transaction(expr.sdList(), 'sd', { replyBytes: 600 });
  session.sdAvailable = true;
  return names.filter((n) => n !== '.' && n !== '..'); // FatFS includes dot entries
}

export function requireSd(session) {
  if (!session.sdAvailable) throw new Error('SD not verified; run Test SD card first');
}

/** One SD directory: [{ name, path, size, dir }], folders first. Verifies the SD card on success. */
export async function sdListDir(session, dir = '/') {
  validateSdPath(dir, { allowRoot: true });
  const rows = await session.transaction(expr.sdListDir(dir), 'sd', { replyBytes: 1500 });
  session.sdAvailable = true;
  return rows
    .filter((r) => Array.isArray(r) && typeof r[0] === 'string')
    .map(([name, size, isDir]) => ({ name, path: sdJoin(dir, name), size, dir: isDir === 1 }))
    .sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}

/**
 * Walk the SD card from `dir`. Returns a flat list of entries (folders and files) with paths.
 * Bounded by depth and entry count so a huge card can't run forever.
 */
export async function sdWalk(session, dir = '/', { maxDepth = 12, maxEntries = 5000, onDir = noop, skip } = {}) {
  const out = [];
  const queue = [[dir, 0]];
  const skipped = [];
  let truncated = false;
  while (queue.length) {
    session.checkCancelled('Cancelled while listing the SD card');
    const [path, depth] = queue.shift();
    onDir(path, out.length);
    const entries = await sdListDir(session, path);
    for (const e of entries) {
      if (skip?.(e)) {
        skipped.push(e.path);
        continue;
      }
      if (out.length >= maxEntries) {
        truncated = true;
        break;
      }
      out.push(e);
      if (e.dir) {
        if (depth + 1 < maxDepth) queue.push([e.path, depth + 1]);
        else truncated = true;
      }
    }
    if (truncated && out.length >= maxEntries) break;
  }
  return { entries: out, truncated, skipped };
}

export async function sdMkdir(session, path) {
  requireSd(session);
  validateSdPath(path);
  await session.command(expr.sdMkdir(path));
}

export async function sdDelete(session, path) {
  requireSd(session);
  validateSdPath(path);
  await session.command(expr.sdUnlink(path));
}

export async function sdStat(session, path) {
  requireSd(session);
  return session.command(expr.sdStat(validateSdPath(path)));
}

async function withHandle(session, path, mode, handle, work) {
  await session.command(expr.sdOpen(path, mode, handle));
  let failure = null;
  try {
    return await work();
  } catch (e) {
    failure = e;
    throw e;
  } finally {
    try {
      await session.command(expr.sdClose(handle));
    } catch (e) {
      // Fix: report the close failure without hiding the original error.
      if (!failure) throw new Error(`SD handle close unverified: ${e.message}`);
    }
  }
}

export async function sdRead(session, path, { onProgress = noop, chunkDelayMs = 0, maxBytes = SD_MAX_BYTES } = {}) {
  requireSd(session);
  validateSdPath(path);
  const stat = await session.command(expr.sdStat(path));
  if (stat?.dir) throw new Error(`${path} is a folder; use Download folder (.zip)`);
  const total = stat?.size;
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Unexpected SD size response');
  if (total > maxBytes) throw new Error(`File is ${total} bytes; the limit is ${maxBytes}`);
  const out = new Uint8Array(total);
  let offset = 0;
  await withHandle(session, path, 'r', '__pbRead', async () => {
    while (offset < total) {
      session.checkCancelled('Cancelled between chunks');
      const length = Math.min(SD_READ_CHUNK, total - offset);
      const res = await session.command(expr.sdReadChunk('__pbRead', length), 20_000, { replyBytes: readReply(length) });
      if (!res || !res.size) throw new Error('Unexpected end of SD file');
      const bytes = base64ToBytes(res.data);
      if (bytes.length !== res.size || byteChecksum(bytes) !== res.checksum) throw new Error('Chunk checksum mismatch');
      out.set(bytes, offset);
      offset += bytes.length;
      onProgress(offset / Math.max(total, 1));
      if (chunkDelayMs) await pause(chunkDelayMs);
    }
  });
  if (offset !== total) throw new Error('Final size mismatch');
  return out;
}

export async function sdWrite(session, path, bytes, { onProgress = noop, chunkDelayMs = 0 } = {}) {
  requireSd(session);
  validateSdPath(path);
  if (bytes.length > SD_MAX_BYTES) throw new Error('8 MB safety limit');
  let offset = 0;
  await withHandle(session, path, 'w', '__pbWrite', async () => {
    while (offset < bytes.length) {
      session.checkCancelled('Cancelled between chunks; partial SD file may remain');
      const chunk = bytes.subarray(offset, offset + writeChunk(session, SD_CHUNK));
      const res = await session.command(expr.sdWriteChunk('__pbWrite', bytesToBase64(chunk)), 20_000);
      if (res?.size !== chunk.length || res.checksum !== byteChecksum(chunk)) throw new Error('Chunk verification failed');
      offset += chunk.length;
      onProgress((offset / Math.max(bytes.length, 1)) * 0.9);
      if (chunkDelayMs) await pause(chunkDelayMs);
    }
  });
  const total = await session.command(expr.sdSize(path));
  if (total !== bytes.length) throw new Error('Final SD size mismatch');
  onProgress(1);
}

// ------------------------------------------------------------------ dump

/** Collect device facts plus an inventory of every global's methods (for an emulator). */
export async function deviceInfo(session, { onProgress = noop } = {}) {
  const info = await session.command(expr.deviceInfo(), 20_000, { replyBytes: 4000 });
  const names = Array.isArray(info?.globals) ? info.globals.filter((n) => typeof n === 'string') : [];
  const shapes = {};
  for (let i = 0; i < names.length; i += 15) {
    session.checkCancelled('Cancelled while reading the API inventory');
    const batch = names.slice(i, i + 15);
    Object.assign(shapes, await session.command(expr.globalShapes(batch), 20_000, { replyBytes: 2500 }));
    onProgress(Math.min(1, (i + 15) / names.length));
  }
  return { ...info, globalShapes: shapes };
}

/** Files and folders that operating systems write onto SD cards; not Pip-Boy content. */
export function isOsJunk(name) {
  return /^(\.DS_Store|\._.*|System Volume Information|\.Trashes|\.Spotlight-V100|\.fseventsd|\.TemporaryItems|Thumbs\.db|desktop\.ini)$/i.test(name);
}

export class DeviceSilentError extends Error {
  constructor(detail) {
    super(`The Pip-Boy stopped answering over USB (${detail}). Unplug and reconnect it, then press Resume.`);
    this.name = 'DeviceSilentError';
  }
}

/** Is the REPL still answering? Short timeout, no side effects. */
async function stillAnswering(session) {
  try {
    return (await session.transaction('1+1', 'value', { timeout: 4000 })) === 2;
  } catch {
    return false;
  }
}

/**
 * Dump the whole device. `save(relativePath, bytes)` persists each file (e.g. to the server).
 * Layout: device.json, storage/<encoded name>, sd/<path>, manifest.json.
 * manifest.json is always written – with complete:false and `aborted` if the dump stopped – so a
 * later run can resume: pass that manifest as `previous` and already-saved files are skipped.
 */
export async function dumpDevice(session, {
  save,
  includeSd = true,
  sdMaxFileBytes = 256 * 1024,
  skipOsJunk = true,
  previous = null,
  onStatus = noop,
  onEvent = noop, // (level, message) for things worth logging
} = {}) {
  const started = Date.now();
  const enc = (o) => new TextEncoder().encode(JSON.stringify(o, null, 2));
  const manifest = {
    format: 'pipboy-dump',
    version: 1,
    created_at: previous?.created_at ?? new Date().toISOString(),
    updated_at: null,
    tool: 'pipboy-companion',
    complete: false,
    aborted: null,
    resumed: previous ? (previous.resumed ?? 0) + 1 : 0,
    device: previous?.device ?? null,
    storage: [],
    sd: { included: includeSd, maxFileBytes: sdMaxFileBytes, entries: [], truncated: false },
    errors: [],
  };
  const prevStorage = new Map((previous?.storage ?? []).filter((r) => r.file && !r.error).map((r) => [r.name, r]));
  const prevSd = new Map((previous?.sd?.entries ?? []).filter((r) => r.file && !r.error).map((r) => [r.path, r]));

  /** Run one file; on a timeout check the device: retry once if it answers, otherwise abort. */
  async function guarded(label, work) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await work();
      } catch (e) {
        if (session.cancelRequested || !/timeout/i.test(e.message)) throw e;
        onEvent('error', `Dump: timeout on ${label} · ${session.diagnostics()}`);
        onStatus(`Timeout on ${label}; checking the Pip-Boy is still answering…`);
        if (!(await stillAnswering(session))) throw new DeviceSilentError(`no reply after a timeout on ${label}`);
        if (attempt >= 2) throw e;
        onEvent('info', `Dump: device still answering; retrying ${label}`);
      }
    }
  }

  try {
    if (!manifest.device) {
      onStatus('Reading device info and API inventory…', 0);
      manifest.device = await deviceInfo(session, { onProgress: (p) => onStatus('Reading API inventory…', p * 0.1) });
      await save('device.json', enc(manifest.device));
    }

    onStatus('Listing Storage…', 0.1);
    const files = await session.transaction(expr.storageListDetailed(), 'list', { replyBytes: 1500 });
    const totalBytes = files.reduce((n, [, size]) => n + Math.max(0, size), 0) || 1;
    let doneBytes = 0;
    for (const [name, size] of files) {
      session.checkCancelled('Dump cancelled');
      const file = `storage/${encodeStorageFileName(name)}`;
      const prev = prevStorage.get(name);
      if (prev && prev.size === size) {
        manifest.storage.push(prev);
      } else {
        onStatus(`Storage: ${name} (${size} B)`, 0.1 + 0.5 * (doneBytes / totalBytes));
        try {
          const bytes = await guarded(`Storage ${name}`, () => storageRead(session, name, { anyName: true }));
          if (bytes === null) throw new Error('disappeared during dump');
          await save(file, bytes);
          manifest.storage.push({ name, file, size: bytes.length, checksum: byteChecksum(bytes) });
        } catch (e) {
          if (session.cancelRequested || e instanceof DeviceSilentError) throw e;
          manifest.storage.push({ name, file: null, size, error: e.message });
          manifest.errors.push(`storage ${JSON.stringify(name)}: ${e.message}`);
        }
      }
      doneBytes += Math.max(0, size);
    }

    if (includeSd) {
      onStatus('Listing SD card…', 0.6);
      let walk;
      try {
        walk = await sdWalk(session, '/', {
          skip: skipOsJunk ? (e) => isOsJunk(e.name) : undefined,
          onDir: (p, n) => onStatus(`Listing SD ${p} (${n} entries)`, 0.6),
        });
      } catch (e) {
        if (session.cancelRequested) throw e;
        manifest.sd.error = e.message;
        manifest.errors.push(`sd: ${e.message}`);
      }
      if (walk) {
        manifest.sd.truncated = walk.truncated;
        manifest.sd.osJunkSkipped = walk.skipped;
        const wanted = walk.entries.filter((e) => !e.dir && e.size >= 0 && e.size <= sdMaxFileBytes);
        const wantedBytes = wanted.reduce((n, e) => n + e.size, 0) || 1;
        let got = 0;
        for (const e of walk.entries) {
          const row = { path: e.path, dir: e.dir, size: e.size };
          manifest.sd.entries.push(row);
          if (e.dir) continue;
          if (e.size < 0 || e.size > sdMaxFileBytes) {
            row.skipped = e.size < 0 ? 'size unknown' : `larger than ${sdMaxFileBytes} bytes; copy it from the card`;
            continue;
          }
          const prev = prevSd.get(e.path);
          if (prev && prev.size === e.size) {
            Object.assign(row, { file: prev.file, checksum: prev.checksum });
            got += e.size;
            continue;
          }
          session.checkCancelled('Dump cancelled');
          onStatus(`SD: ${e.path} (${e.size} B)`, 0.6 + 0.39 * (got / wantedBytes));
          try {
            const bytes = await guarded(e.path, () => sdRead(session, e.path, { maxBytes: sdMaxFileBytes }));
            row.file = `sd${e.path}`;
            await save(row.file, bytes);
            row.checksum = byteChecksum(bytes);
          } catch (err) {
            if (session.cancelRequested || err instanceof DeviceSilentError) throw err;
            row.error = err.message;
            manifest.errors.push(`sd ${e.path}: ${err.message}`);
          }
          got += e.size;
        }
      }
    }
    manifest.complete = true;
    onStatus('Dump complete', 1);
    return manifest;
  } catch (e) {
    manifest.aborted = e.message;
    throw e;
  } finally {
    manifest.updated_at = new Date().toISOString();
    manifest.duration_ms = (previous?.duration_ms ?? 0) + (Date.now() - started);
    // Always leave a manifest so the dump can be resumed (complete:false says it is partial).
    // If an aborted SD walk never got going, keep the previous run's SD rows.
    if (!manifest.complete && previous?.sd?.entries && !manifest.sd.entries.length) manifest.sd = previous.sd;
    try {
      await save('manifest.json', enc(manifest));
    } catch (err) {
      onEvent('error', `Dump: could not write manifest.json: ${err.message}`);
    }
  }
}
