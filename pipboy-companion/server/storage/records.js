import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, Mutex } from './atomic.js';
import { AppError } from '../errors.js';
import {
  MAX_RECORDS,
  BACKUP_FORMAT,
  validateRecordInput,
  cleanName,
  normalizePayload,
  parseBackup,
  ValidationError,
} from '../../shared/validate.js';

const FILE_VERSION = 1;

function toAppError(e) {
  if (e instanceof ValidationError) return new AppError(400, 'validation', e.message);
  return e;
}

/**
 * Companion records (apps, radio presets, one settings profile) persisted to a JSON file.
 * All mutations go through a mutex and are written atomically, so a crash mid-write
 * never leaves a half-written file.
 */
export class RecordStore {
  #file;
  #state = null;
  #mutex = new Mutex();
  #logger;

  constructor(dataDir, { logger = console } = {}) {
    this.#file = path.join(dataDir, 'records.json');
    this.#logger = logger;
  }

  get file() {
    return this.#file;
  }

  async load() {
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    let text;
    try {
      text = await fs.readFile(this.#file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      this.#state = { version: FILE_VERSION, nextId: 1, records: [] };
      return;
    }
    try {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.records) || !Number.isInteger(data.nextId)) {
        throw new Error('unexpected shape');
      }
      this.#state = data;
    } catch (e) {
      // Never silently discard user data: keep the unreadable file beside the new one.
      const aside = `${this.#file}.corrupt-${Date.now()}`;
      await fs.rename(this.#file, aside);
      this.#logger.warn?.(`records.json could not be parsed (${e.message}); moved to ${aside} and started empty`);
      this.#state = { version: FILE_VERSION, nextId: 1, records: [] };
    }
  }

  #ensureLoaded() {
    if (!this.#state) throw new Error('RecordStore.load() has not been called');
  }

  async #persist(next) {
    await writeFileAtomic(this.#file, JSON.stringify(next, null, 2));
    this.#state = next;
  }

  #clone() {
    return structuredClone(this.#state);
  }

  list({ kind } = {}) {
    this.#ensureLoaded();
    const rows = kind ? this.#state.records.filter((r) => r.kind === kind) : this.#state.records;
    return structuredClone(rows);
  }

  get(id) {
    this.#ensureLoaded();
    const row = this.#state.records.find((r) => r.id === id);
    return row ? structuredClone(row) : null;
  }

  #checkDuplicate(records, candidate, ignoreId = null) {
    if (candidate.kind === 'radio') {
      const clash = records.find(
        (r) => r.kind === 'radio' && r.id !== ignoreId && r.payload.frequency === candidate.payload.frequency,
      );
      if (clash) throw new AppError(409, 'duplicate', `${candidate.payload.frequency} MHz is already saved as "${clash.name}"`);
    }
    if (candidate.kind === 'settings') {
      const existing = records.find((r) => r.kind === 'settings' && r.id !== ignoreId);
      if (existing) throw new AppError(409, 'duplicate', 'A settings profile already exists; update it instead');
    }
  }

  create(input) {
    return this.#mutex.run(async () => {
      this.#ensureLoaded();
      let clean;
      try {
        clean = validateRecordInput(input);
      } catch (e) {
        throw toAppError(e);
      }
      const next = this.#clone();
      if (next.records.length >= MAX_RECORDS) {
        throw new AppError(409, 'limit', `The ${MAX_RECORDS}-record limit has been reached. Remove a record first.`);
      }
      this.#checkDuplicate(next.records, clean);
      const now = new Date().toISOString();
      const record = { id: next.nextId++, ...clean, created_at: now, updated_at: now };
      next.records.push(record);
      await this.#persist(next);
      return structuredClone(record);
    });
  }

  update(id, changes) {
    return this.#mutex.run(async () => {
      this.#ensureLoaded();
      const next = this.#clone();
      const record = next.records.find((r) => r.id === id);
      if (!record) throw new AppError(404, 'not_found', 'Record not found');
      if (!changes || typeof changes !== 'object') throw new AppError(400, 'validation', 'Body must be an object');
      if (changes.kind !== undefined && changes.kind !== record.kind) {
        throw new AppError(400, 'validation', 'A record kind cannot be changed');
      }
      try {
        if (changes.name !== undefined) record.name = cleanName(changes.name);
        if (changes.payload !== undefined) record.payload = normalizePayload(record.kind, changes.payload);
      } catch (e) {
        throw toAppError(e);
      }
      this.#checkDuplicate(next.records, record, record.id);
      record.updated_at = new Date().toISOString();
      await this.#persist(next);
      return structuredClone(record);
    });
  }

  /** Create or replace the single settings profile. */
  saveSettings(payload) {
    return this.#mutex.run(async () => {
      this.#ensureLoaded();
      let clean;
      try {
        clean = normalizePayload('settings', payload);
      } catch (e) {
        throw toAppError(e);
      }
      const next = this.#clone();
      const now = new Date().toISOString();
      let record = next.records.find((r) => r.kind === 'settings');
      if (record) {
        record.payload = clean;
        record.updated_at = now;
      } else {
        if (next.records.length >= MAX_RECORDS) throw new AppError(409, 'limit', `The ${MAX_RECORDS}-record limit has been reached.`);
        record = { id: next.nextId++, kind: 'settings', name: 'Mark V profile', payload: clean, created_at: now, updated_at: now };
        next.records.push(record);
      }
      await this.#persist(next);
      return structuredClone(record);
    });
  }

  remove(id) {
    return this.#mutex.run(async () => {
      this.#ensureLoaded();
      const next = this.#clone();
      const index = next.records.findIndex((r) => r.id === id);
      if (index < 0) throw new AppError(404, 'not_found', 'Record not found');
      const [removed] = next.records.splice(index, 1);
      await this.#persist(next);
      return structuredClone(removed);
    });
  }

  exportBackup() {
    this.#ensureLoaded();
    return {
      format: BACKUP_FORMAT,
      version: 2,
      exported_at: new Date().toISOString(),
      records: this.#state.records.map(({ kind, name, payload, created_at }) => ({ kind, name, payload, created_at })),
    };
  }

  /** Validate a whole backup first, then apply it in one atomic write (all or nothing). */
  previewImport(data) {
    this.#ensureLoaded();
    let rows;
    try {
      rows = parseBackup(data);
    } catch (e) {
      throw toAppError(e);
    }
    return this.#planImport(this.#state.records, rows);
  }

  #planImport(existing, rows) {
    const plan = { add: [], settings: null, skipped: [] };
    const frequencies = new Set(existing.filter((r) => r.kind === 'radio').map((r) => r.payload.frequency));
    for (const row of rows) {
      if (row.kind === 'settings') {
        plan.settings = row; // last settings profile in the file wins
      } else if (row.kind === 'radio' && frequencies.has(row.payload.frequency)) {
        plan.skipped.push({ name: row.name, reason: `${row.payload.frequency} MHz already saved` });
      } else {
        if (row.kind === 'radio') frequencies.add(row.payload.frequency);
        plan.add.push(row);
      }
    }
    const hasSettings = existing.some((r) => r.kind === 'settings');
    const total = existing.length + plan.add.length + (plan.settings && !hasSettings ? 1 : 0);
    if (total > MAX_RECORDS) {
      throw new AppError(409, 'limit', `Import would exceed the ${MAX_RECORDS}-record limit (${total} records)`);
    }
    return {
      apps: plan.add.filter((r) => r.kind === 'app').length,
      radio: plan.add.filter((r) => r.kind === 'radio').length,
      settings: plan.settings ? (hasSettings ? 'update' : 'create') : 'none',
      skipped: plan.skipped,
      _plan: plan,
    };
  }

  importBackup(data) {
    return this.#mutex.run(async () => {
      this.#ensureLoaded();
      let rows;
      try {
        rows = parseBackup(data);
      } catch (e) {
        throw toAppError(e);
      }
      const next = this.#clone();
      const summary = this.#planImport(next.records, rows);
      const { add, settings } = summary._plan;
      const now = new Date().toISOString();
      for (const row of add) {
        next.records.push({ id: next.nextId++, ...row, created_at: row.created_at ?? now, updated_at: now });
      }
      if (settings) {
        const current = next.records.find((r) => r.kind === 'settings');
        if (current) {
          current.payload = settings.payload;
          current.updated_at = now;
        } else {
          next.records.push({ id: next.nextId++, kind: 'settings', name: settings.name, payload: settings.payload, created_at: now, updated_at: now });
        }
      }
      await this.#persist(next);
      delete summary._plan;
      return { ...summary, imported: add.length + (settings ? 1 : 0) };
    });
  }
}
