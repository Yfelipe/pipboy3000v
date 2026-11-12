// Pure validation helpers shared by the browser (served at /shared/validate.js)
// and the Node server. No DOM, no Node-only APIs.

export const MAX_RECORDS = 999;
export const KINDS = Object.freeze(['app', 'radio', 'settings']);
export const NAME_MAX = 100;
export const FM_MIN = 87.5;
export const FM_MAX = 108;
export const BACKUP_FORMAT = 'pip-boy-companion-backup';

export const MEDIA_EXTENSIONS = Object.freeze(['mp3', 'wav', 'ogg', 'avi', 'jpg', 'jpeg', 'png', 'mp4', 'txt']);
export const MEDIA_MAX_BYTES = 100 * 1024 * 1024;

export const SETTINGS_OPTIONS = Object.freeze({
  brightness: Object.freeze(['Low', 'Medium', 'High']),
  volume: Object.freeze(['Low', 'Medium', 'High']),
  theme: Object.freeze(['Phosphor Green', 'Amber', 'Cool White']),
  clock: Object.freeze(['24-hour', '12-hour']),
});
export const SETTINGS_DEFAULTS = Object.freeze({
  brightness: 'Medium',
  volume: 'Medium',
  theme: 'Phosphor Green',
  clock: '24-hour',
});

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
  }
}

// ---------------------------------------------------------------- records

/** Returns the frequency as a string with one decimal ("101.7"), or throws. */
export function parseFrequency(value) {
  let n;
  if (typeof value === 'number') {
    n = value;
  } else if (typeof value === 'string' && /^\d{2,3}(\.\d+)?$/.test(value.trim())) {
    n = Number(value.trim());
  } else {
    throw new ValidationError('Frequency must be a number');
  }
  if (!Number.isFinite(n)) throw new ValidationError('Frequency must be a number');
  if (n < FM_MIN || n > FM_MAX) {
    throw new ValidationError(`Frequency must be between ${FM_MIN.toFixed(1)} and ${FM_MAX.toFixed(1)} MHz`);
  }
  const tenths = n * 10;
  if (Math.abs(tenths - Math.round(tenths)) > 1e-6) {
    throw new ValidationError('Frequency must use 0.1 MHz steps');
  }
  return (Math.round(tenths) / 10).toFixed(1);
}

export function cleanName(value, max = NAME_MAX) {
  if (typeof value !== 'string') throw new ValidationError('Name must be text');
  const name = value.trim();
  if (!name) throw new ValidationError('Name is required');
  if (name.length > max) throw new ValidationError(`Name must be ${max} characters or fewer`);
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new ValidationError('Name contains control characters');
  return name;
}

/** Normalises a payload for a record kind. Accepts an object or a JSON string (backup v1). */
export function normalizePayload(kind, payload) {
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      throw new ValidationError('Payload is not valid JSON');
    }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Payload must be an object');
  }
  switch (kind) {
    case 'app': {
      const version = payload.version ?? '';
      if (typeof version !== 'string') throw new ValidationError('Version must be text');
      const trimmed = version.trim();
      if (trimmed.length > 70) throw new ValidationError('Version must be 70 characters or fewer');
      if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new ValidationError('Version contains control characters');
      return { version: trimmed };
    }
    case 'radio':
      return { frequency: parseFrequency(payload.frequency) };
    case 'settings': {
      const out = {};
      for (const key of Object.keys(SETTINGS_OPTIONS)) {
        const value = payload[key] ?? SETTINGS_DEFAULTS[key];
        if (!SETTINGS_OPTIONS[key].includes(value)) throw new ValidationError(`Invalid ${key} setting`);
        out[key] = value;
      }
      return out;
    }
    default:
      throw new ValidationError(`kind must be one of ${KINDS.join(', ')}`);
  }
}

export function validateRecordInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Record must be an object');
  }
  if (!KINDS.includes(input.kind)) throw new ValidationError(`kind must be one of ${KINDS.join(', ')}`);
  return {
    kind: input.kind,
    name: cleanName(input.name),
    payload: normalizePayload(input.kind, input.payload),
  };
}

/** Validates a backup document (v1 string payloads or v2 object payloads). Returns normalised records. */
export function parseBackup(data) {
  if (!data || data.format !== BACKUP_FORMAT || !Array.isArray(data.records)) {
    throw new ValidationError('Not a Pip-Boy companion backup');
  }
  if (data.records.length > MAX_RECORDS) throw new ValidationError(`Backups may hold at most ${MAX_RECORDS} records`);
  return data.records.map((record, index) => {
    try {
      const clean = validateRecordInput(record);
      if (typeof record.created_at === 'string' && !Number.isNaN(Date.parse(record.created_at))) {
        clean.created_at = new Date(record.created_at).toISOString();
      }
      return clean;
    } catch (e) {
      throw new ValidationError(`Record ${index + 1}: ${e.message}`);
    }
  });
}

// ------------------------------------------------------------------ files

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** Server workspace file name: flat, no path separators, no hidden files. */
export function validateWorkspaceName(name) {
  if (typeof name !== 'string' || !name) throw new ValidationError('File name is required');
  if (name.length > 100) throw new ValidationError('File name must be 100 characters or fewer');
  if (!/^[A-Za-z0-9_][A-Za-z0-9 _.()-]*$/.test(name)) {
    throw new ValidationError('File name may use letters, digits, space, _ . ( ) - and must not start with a symbol');
  }
  if (/[ .]$/.test(name)) throw new ValidationError('File name must not end with a space or dot');
  if (WINDOWS_RESERVED.test(name)) throw new ValidationError('That file name is reserved by the operating system');
  return name;
}

/** Turn an arbitrary local file name into a valid workspace name (best effort). */
export function sanitizeWorkspaceName(name) {
  let base = String(name ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _.()-]+/g, '_')
    .replace(/^[^A-Za-z0-9_]+/, '')
    .replace(/[ .]+$/, '');
  if (base.length > 100) {
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 && base.length - dot <= 10 ? base.slice(dot) : '';
    base = base.slice(0, 100 - ext.length) + ext;
  }
  if (!base || WINDOWS_RESERVED.test(base)) base = `file_${base || 'upload'}`.slice(0, 100);
  return base;
}

/** Espruino Storage name: plain ASCII, max 28 characters. */
export function validateStorageName(name) {
  if (typeof name !== 'string' || !/^[A-Za-z0-9_.-]{1,28}$/.test(name) || name === '.' || name === '..') {
    throw new ValidationError('Use a safe 1–28 character file name (letters, digits, _ . -)');
  }
  return name;
}

/**
 * Absolute SD-card path without traversal. Allows FAT long-name characters (spaces,
 * brackets, etc.) but not control characters, \ : * ? " < > | or "." / ".." segments.
 * Fix: the old rule refused names with spaces, which real Pip-Boy SD cards have.
 */
export function validateSdPath(path, { allowRoot = false } = {}) {
  if (allowRoot && path === '/') return path;
  const bad = () => new ValidationError('Use an absolute SD path like /MUSIC/track 01.wav (no .., \\ : * ? " < > | or control characters)');
  if (typeof path !== 'string' || path.length > 240 || !path.startsWith('/') || path.endsWith('/')) throw bad();
  const parts = path.slice(1).split('/');
  if (parts.length > 16) throw bad();
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.length > 128) throw bad();
    if (/[\u0000-\u001f\u007f\\:*?"<>|]/.test(part)) throw bad();
  }
  return path;
}

/** Join an SD directory and an entry name. */
export function sdJoin(dir, name) {
  return dir === '/' ? `/${name}` : `${dir}/${name}`;
}

/**
 * A relative path inside a dump folder ("storage/x.js", "sd/MUSIC/a b.wav"). Same segment
 * rules as SD paths; the server additionally checks the resolved path stays inside the dump.
 */
export function validateDumpPath(path) {
  if (typeof path !== 'string' || !path || path.length > 400 || path.startsWith('/')) {
    throw new ValidationError('Invalid dump path');
  }
  const parts = path.split('/');
  if (parts.length > 20) throw new ValidationError('Dump path is too deep');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.length > 200 || /[\u0000-\u001f\u007f\\:*?"<>|]/.test(part)) {
      throw new ValidationError(`Invalid dump path segment: ${JSON.stringify(part)}`);
    }
  }
  return path;
}

/** Map any Storage file name (which may contain \x01 etc.) to a safe file name; reversible. */
export function encodeStorageFileName(name) {
  const encoded = String(name).replace(/[^A-Za-z0-9_.-]|^\./g, (c) =>
    [...new TextEncoder().encode(c)].map((b) => `%${b.toString(16).toUpperCase().padStart(2, '0')}`).join(''),
  );
  return encoded || '%00empty';
}

// ------------------------------------------------------------------ media

export function validateMedia({ name, size }) {
  const issues = [];
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  if (dot < 0 || !MEDIA_EXTENSIONS.includes(ext)) issues.push('Extension not in example supported list');
  if (size === 0) issues.push('File is empty');
  if (size > MEDIA_MAX_BYTES) issues.push('Over 100 MB; review device limits');
  if (/[<>:"/\\|?*]/.test(name)) issues.push('Filename contains problematic characters');
  return {
    name,
    size,
    ok: issues.length === 0,
    message: issues.join('; ') || 'Basic filename, extension, and size checks passed',
  };
}

// ------------------------------------------------------------------- misc

export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

let crcTable = null;
/** Standard CRC-32 (as Espruino's native E.CRC32), for verifying whole files. */
export function crc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Sum of byte values modulo 2^32 – matches the checksum computed on the device. */
export function byteChecksum(bytes) {
  let sum = 0;
  for (const b of bytes) sum = (sum + b) >>> 0;
  return sum;
}
