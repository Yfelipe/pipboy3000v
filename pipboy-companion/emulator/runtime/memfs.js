// In-memory filesystem used as the emulated SD card (and any other host files).
// Paths are absolute and '/'-separated: "/sdcard/MUSIC/Track 01.wav".

export class MemFS {
  constructor() {
    this.root = MemFS.#dir();
  }

  static #dir() {
    return { type: 'dir', children: new Map(), mtime: Date.now() };
  }

  static #parts(path) {
    return String(path).split('/').filter((p) => p && p !== '.');
  }

  /** Node at `path`, or null. Rejects ".." so nothing escapes the root. */
  lookup(path) {
    let node = this.root;
    for (const part of MemFS.#parts(path)) {
      if (part === '..' || node.type !== 'dir') return null;
      node = node.children.get(part);
      if (!node) return null;
    }
    return node;
  }

  /** Parent directory node and final name for `path` (parent must exist). */
  parentOf(path) {
    const parts = MemFS.#parts(path);
    const name = parts.pop();
    if (!name || name === '..') return null;
    const parent = this.lookup('/' + parts.join('/'));
    return parent && parent.type === 'dir' ? { parent, name } : null;
  }

  mkdirp(path) {
    let node = this.root;
    for (const part of MemFS.#parts(path)) {
      if (part === '..') throw new Error(`Invalid path: ${path}`);
      let next = node.children.get(part);
      if (!next) {
        next = MemFS.#dir();
        node.children.set(part, next);
      } else if (next.type !== 'dir') {
        throw new Error(`Not a directory: ${path}`);
      }
      node = next;
    }
    return node;
  }

  writeFile(path, data) {
    const parts = MemFS.#parts(path);
    const name = parts.pop();
    const dir = this.mkdirp('/' + parts.join('/'));
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data);
    dir.children.set(name, { type: 'file', data: bytes, mtime: Date.now() });
  }

  readFile(path) {
    const node = this.lookup(path);
    if (!node || node.type !== 'file') throw new Error(`No such file: ${path}`);
    return node.data;
  }

  exists(path) {
    return this.lookup(path) !== null;
  }

  readdir(path) {
    const node = this.lookup(path);
    if (!node || node.type !== 'dir') throw new Error(`Not a directory: ${path}`);
    return [...node.children.keys()];
  }

  remove(path) {
    const where = this.parentOf(path);
    if (!where || !where.parent.children.delete(where.name)) throw new Error(`No such file: ${path}`);
  }

  /** Every file below `path` as [absolutePath, bytes]. */
  *walk(path = '/') {
    const node = this.lookup(path);
    if (!node) return;
    if (node.type === 'file') {
      yield [path, node.data];
      return;
    }
    for (const [name, child] of node.children) {
      yield* this.walk(`${path === '/' ? '' : path}/${name}`);
    }
  }
}
