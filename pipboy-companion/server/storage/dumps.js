import { promises as fs, createWriteStream, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { AppError } from '../errors.js';
import { validateDumpPath, ValidationError } from '../../shared/validate.js';

const ID_RE = /^pipboy-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{4}$/;

/**
 * Full-device dumps, one folder each under data/dumps/<id>/ with nested files
 * (device.json, manifest.json, storage/…, sd/…). Kept as plain files so an emulator
 * project can read them directly.
 */
export class DumpStore {
  #dir;
  #maxFileBytes;

  constructor(dataDir, { maxFileBytes = 64 * 1024 * 1024 } = {}) {
    this.#dir = path.join(dataDir, 'dumps');
    this.#maxFileBytes = maxFileBytes;
  }

  get dir() {
    return this.#dir;
  }

  async init() {
    await fs.mkdir(this.#dir, { recursive: true });
  }

  #dumpDir(id) {
    if (typeof id !== 'string' || !ID_RE.test(id)) throw new AppError(400, 'validation', 'Invalid dump id');
    return path.join(this.#dir, id);
  }

  async #existing(id) {
    const dir = this.#dumpDir(id);
    try {
      if ((await fs.stat(dir)).isDirectory()) return dir;
    } catch {}
    throw new AppError(404, 'not_found', 'Dump not found');
  }

  #resolve(dir, rel) {
    try {
      validateDumpPath(rel);
    } catch (e) {
      if (e instanceof ValidationError) throw new AppError(400, 'validation', e.message);
      throw e;
    }
    const full = path.resolve(dir, ...rel.split('/'));
    if (!full.startsWith(dir + path.sep)) throw new AppError(400, 'validation', 'Path escapes the dump folder');
    return full;
  }

  async create() {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const id = `pipboy-${stamp}-${randomBytes(2).toString('hex')}`;
    await fs.mkdir(this.#dumpDir(id), { recursive: false });
    return { id, path: this.#dumpDir(id) };
  }

  async list() {
    const out = [];
    for (const entry of await fs.readdir(this.#dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !ID_RE.test(entry.name)) continue;
      const dir = path.join(this.#dir, entry.name);
      let manifest = null;
      try {
        manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
      } catch {}
      out.push({
        id: entry.name,
        path: dir,
        // Older manifests have no `complete` flag; they were only written when the dump finished.
        complete: !!manifest && manifest.complete !== false,
        hasManifest: !!manifest,
        aborted: manifest?.aborted ?? null,
        created_at: manifest?.created_at ?? null,
        board: manifest?.device?.env?.BOARD ?? null,
        version: manifest?.device?.env?.VERSION ?? manifest?.device?.version ?? null,
        storageFiles: manifest?.storage?.filter((f) => f.file).length ?? null,
        sdFiles: manifest?.sd?.entries?.filter((e) => e.file).length ?? null,
        sdSkipped: manifest?.sd?.entries?.filter((e) => e.skipped).length ?? null,
        errors: manifest?.errors?.length ?? null,
      });
    }
    return out.sort((a, b) => b.id.localeCompare(a.id));
  }

  async save(id, rel, source, { declaredLength } = {}) {
    const dir = await this.#existing(id);
    const full = this.#resolve(dir, rel);
    const max = this.#maxFileBytes;
    if (Number.isFinite(declaredLength) && declaredLength > max) {
      throw new AppError(413, 'too_large', `Dump files are limited to ${max} bytes`, { Connection: 'close' });
    }
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = path.join(path.dirname(full), `.part-${randomBytes(6).toString('hex')}`);
    let total = 0;
    const counter = new Transform({
      transform(chunk, _e, cb) {
        total += chunk.length;
        if (total > max) cb(new AppError(413, 'too_large', `Dump files are limited to ${max} bytes`, { Connection: 'close' }));
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
    return { path: rel, size: total };
  }

  async open(id, rel) {
    const dir = await this.#existing(id);
    const full = this.#resolve(dir, rel);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      throw new AppError(404, 'not_found', 'File not found');
    }
    if (!stat.isFile()) throw new AppError(404, 'not_found', 'File not found');
    return { size: stat.size, stream: createReadStream(full), name: path.basename(full) };
  }

  async remove(id) {
    const dir = await this.#existing(id);
    await fs.rm(dir, { recursive: true, force: true });
  }
}
