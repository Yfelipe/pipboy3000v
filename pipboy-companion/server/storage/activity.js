import { promises as fs } from 'node:fs';
import path from 'node:path';
import { writeFileAtomic, Mutex } from './atomic.js';
import { AppError } from '../errors.js';

/**
 * Persistent activity log (JSON lines). Keeps the newest `maxEntries`; older
 * lines are compacted away so the file cannot grow without bound.
 */
export class ActivityLog {
  #file;
  #entries = [];
  #mutex = new Mutex();
  #max;
  #sinceCompact = 0;

  constructor(dataDir, { maxEntries = 5000 } = {}) {
    this.#file = path.join(dataDir, 'activity.jsonl');
    this.#max = maxEntries;
  }

  async load() {
    await fs.mkdir(path.dirname(this.#file), { recursive: true });
    let text = '';
    try {
      text = await fs.readFile(this.#file, 'utf8');
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    this.#entries = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (typeof entry.at === 'string' && typeof entry.message === 'string') this.#entries.push(entry);
      } catch {
        // skip a torn final line from an interrupted append
      }
    }
    if (this.#entries.length > this.#max) await this.#compact();
  }

  async #compact() {
    this.#entries = this.#entries.slice(-this.#max);
    await writeFileAtomic(this.#file, this.#entries.map((e) => JSON.stringify(e)).join('\n') + (this.#entries.length ? '\n' : ''));
    this.#sinceCompact = 0;
  }

  /** Newest first. */
  list({ limit = 1000, q = '' } = {}) {
    const needle = q.toLowerCase();
    const out = [];
    for (let i = this.#entries.length - 1; i >= 0 && out.length < limit; i--) {
      const e = this.#entries[i];
      if (!needle || e.message.toLowerCase().includes(needle)) out.push(e);
    }
    return out;
  }

  append(items) {
    return this.#mutex.run(async () => {
      if (!Array.isArray(items) || items.length === 0 || items.length > 500) {
        throw new AppError(400, 'validation', 'Send between 1 and 500 log entries');
      }
      const clean = items.map((item) => {
        if (!item || typeof item.message !== 'string') throw new AppError(400, 'validation', 'Each entry needs a message');
        const at = typeof item.at === 'string' && !Number.isNaN(Date.parse(item.at)) ? new Date(item.at).toISOString() : new Date().toISOString();
        const level = item.level === 'error' || item.level === 'debug' ? item.level : 'info';
        return { at, level, message: item.message.slice(0, 2000) };
      });
      await fs.appendFile(this.#file, clean.map((e) => JSON.stringify(e)).join('\n') + '\n');
      this.#entries.push(...clean);
      this.#sinceCompact += clean.length;
      if (this.#entries.length > this.#max && this.#sinceCompact >= Math.ceil(this.#max / 10)) await this.#compact();
      else if (this.#entries.length > this.#max) this.#entries = this.#entries.slice(-this.#max);
      return clean.length;
    });
  }

  clear() {
    return this.#mutex.run(async () => {
      this.#entries = [];
      await writeFileAtomic(this.#file, '');
    });
  }
}
