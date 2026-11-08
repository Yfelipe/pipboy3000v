import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { AppError } from '../errors.js';
import { validateWorkspaceName, validateMedia, ValidationError } from '../../shared/validate.js';

/**
 * Long-lived SD-card staging workspace: real files kept under data/workspace/.
 * Names are flat (no folders) and strictly validated, so a request can never
 * escape the workspace directory.
 */
export class FileStore {
  #dir;
  #maxBytes;

  constructor(dataDir, { maxBytes = 200 * 1024 * 1024 } = {}) {
    this.#dir = path.join(dataDir, 'workspace');
    this.#maxBytes = maxBytes;
  }

  get dir() {
    return this.#dir;
  }

  async init() {
    await fs.mkdir(this.#dir, { recursive: true });
  }

  #resolve(name) {
    try {
      validateWorkspaceName(name);
    } catch (e) {
      if (e instanceof ValidationError) throw new AppError(400, 'validation', e.message);
      throw e;
    }
    const full = path.join(this.#dir, name);
    if (path.dirname(full) !== this.#dir) throw new AppError(400, 'validation', 'Invalid file name');
    return full;
  }

  async list() {
    const entries = await fs.readdir(this.#dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const stat = await fs.stat(path.join(this.#dir, entry.name));
      files.push(this.#describe(entry.name, stat));
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  #describe(name, stat) {
    const check = validateMedia({ name, size: stat.size });
    return { name, size: stat.size, modified_at: stat.mtime.toISOString(), media: { ok: check.ok, message: check.message } };
  }

  async stat(name) {
    const full = this.#resolve(name);
    try {
      const stat = await fs.stat(full);
      if (!stat.isFile()) throw new AppError(404, 'not_found', 'File not found');
      return { full, info: this.#describe(name, stat) };
    } catch (e) {
      if (e.code === 'ENOENT') throw new AppError(404, 'not_found', 'File not found');
      throw e;
    }
  }

  openRead(full) {
    return createReadStream(full);
  }

  /** Stream a request body to disk; only replaces the target once the full body arrived. */
  async save(name, source, { overwrite = false, declaredLength } = {}) {
    const full = this.#resolve(name);
    if (Number.isFinite(declaredLength) && declaredLength > this.#maxBytes) {
      throw new AppError(413, 'too_large', `Files are limited to ${this.#maxBytes} bytes`, { Connection: 'close' });
    }
    if (!overwrite) {
      try {
        await fs.access(full);
        throw new AppError(409, 'exists', `"${name}" already exists in the workspace`);
      } catch (e) {
        if (e instanceof AppError) throw e;
      }
    }
    const tmp = path.join(this.#dir, `.upload-${randomBytes(6).toString('hex')}.tmp`);
    let total = 0;
    const max = this.#maxBytes;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        total += chunk.length;
        if (total > max) cb(new AppError(413, 'too_large', `Files are limited to ${max} bytes`, { Connection: 'close' }));
        else cb(null, chunk);
      },
    });
    try {
      await pipeline(source, counter, createWriteStream(tmp, { flags: 'wx' }));
      await fs.rename(tmp, full);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
    const stat = await fs.stat(full);
    return this.#describe(name, stat);
  }

  async remove(name) {
    const full = this.#resolve(name);
    try {
      await fs.unlink(full);
    } catch (e) {
      if (e.code === 'ENOENT') throw new AppError(404, 'not_found', 'File not found');
      throw e;
    }
  }
}
