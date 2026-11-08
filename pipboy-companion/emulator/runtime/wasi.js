// The subset of WASI preview 1 (wasi_snapshot_preview1) that the Espruino WebAssembly build
// imports: file I/O on a MemFS mounted at "/", and console output on fds 1 and 2.
// Reference: https://github.com/WebAssembly/WASI/blob/main/legacy/preview1/docs.md

const ERRNO = { SUCCESS: 0, BADF: 8, EXIST: 20, INVAL: 28, IO: 29, ISDIR: 31, NOENT: 44, NOSYS: 52, NOTDIR: 54, NOTEMPTY: 55 };
const FILETYPE = { CHARACTER_DEVICE: 2, DIRECTORY: 3, REGULAR_FILE: 4 };
const OFLAGS = { CREAT: 1, DIRECTORY: 2, EXCL: 4, TRUNC: 8 };
const FDFLAGS_APPEND = 1;
const WHENCE = { SET: 0, CUR: 1, END: 2 };
const PREOPEN_FD = 3;

export class WasiExit extends Error {
  constructor(code) {
    super(`WASI program exited with code ${code}`);
    this.code = code;
  }
}

export class Wasi {
  /**
   * @param {object} options
   * @param {import('./memfs.js').MemFS} options.fs  filesystem mounted at "/"
   * @param {(text: string) => void} [options.stdout]
   */
  constructor({ fs, stdout = () => {} }) {
    this.fs = fs;
    this.stdout = stdout;
    this.memory = null;
    this.fds = new Map([[PREOPEN_FD, { node: fs.root, path: '/', preopen: true }]]);
    this.nextFd = PREOPEN_FD + 1;
    this.decoder = new TextDecoder();
  }

  /** Call once the module is instantiated. */
  setMemory(memory) {
    this.memory = memory;
  }

  get #view() {
    return new DataView(this.memory.buffer);
  }

  get #bytes() {
    return new Uint8Array(this.memory.buffer);
  }

  #string(ptr, len) {
    return this.decoder.decode(this.#bytes.subarray(ptr, ptr + len));
  }

  /** Resolve a path relative to a directory fd to an absolute MemFS path. */
  #resolve(dirFd, ptr, len) {
    const dir = this.fds.get(dirFd);
    if (!dir || dir.node.type !== 'dir') return null;
    const rel = this.#string(ptr, len);
    const parts = [];
    for (const part of `${dir.path}/${rel}`.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') return null; // never escape the mount
      parts.push(part);
    }
    return '/' + parts.join('/');
  }

  #writeFilestat(ptr, node) {
    const v = this.#view;
    const ns = BigInt(node.mtime) * 1000000n;
    v.setBigUint64(ptr, 0n, true); // dev
    v.setBigUint64(ptr + 8, 0n, true); // ino
    v.setUint8(ptr + 16, node.type === 'dir' ? FILETYPE.DIRECTORY : FILETYPE.REGULAR_FILE);
    v.setBigUint64(ptr + 24, 1n, true); // nlink
    v.setBigUint64(ptr + 32, BigInt(node.type === 'file' ? node.data.length : 0), true);
    v.setBigUint64(ptr + 40, ns, true); // atim
    v.setBigUint64(ptr + 48, ns, true); // mtim
    v.setBigUint64(ptr + 56, ns, true); // ctim
  }

  /** Import object for WebAssembly.instantiate: { wasi_snapshot_preview1: … } */
  get imports() {
    const self = this;
    return {
      fd_prestat_get(fd, ptr) {
        if (fd !== PREOPEN_FD) return ERRNO.BADF;
        const v = self.#view;
        v.setUint8(ptr, 0); // preopentype: dir
        v.setUint32(ptr + 4, 1, true); // name length of "/"
        return ERRNO.SUCCESS;
      },
      fd_prestat_dir_name(fd, ptr, len) {
        if (fd !== PREOPEN_FD) return ERRNO.BADF;
        if (len >= 1) self.#bytes[ptr] = 0x2f; // "/"
        return ERRNO.SUCCESS;
      },
      fd_fdstat_get(fd, ptr) {
        const v = self.#view;
        let type;
        if (fd <= 2) type = FILETYPE.CHARACTER_DEVICE;
        else {
          const f = self.fds.get(fd);
          if (!f) return ERRNO.BADF;
          type = f.node.type === 'dir' ? FILETYPE.DIRECTORY : FILETYPE.REGULAR_FILE;
        }
        v.setUint8(ptr, type);
        v.setUint16(ptr + 2, 0, true);
        v.setBigUint64(ptr + 8, 0xffffffffffffffffn, true); // all rights
        v.setBigUint64(ptr + 16, 0xffffffffffffffffn, true);
        return ERRNO.SUCCESS;
      },
      fd_fdstat_set_flags(fd) {
        return fd <= 2 || self.fds.has(fd) ? ERRNO.SUCCESS : ERRNO.BADF;
      },
      path_open(dirFd, _dirflags, pathPtr, pathLen, oflags, _rightsBase, _rightsInheriting, fdflags, fdOut) {
        const path = self.#resolve(dirFd, pathPtr, pathLen);
        if (path === null) return ERRNO.NOENT;
        let node = self.fs.lookup(path);
        if (node && (oflags & OFLAGS.CREAT) && (oflags & OFLAGS.EXCL)) return ERRNO.EXIST;
        if (!node) {
          if (!(oflags & OFLAGS.CREAT)) return ERRNO.NOENT;
          const where = self.fs.parentOf(path);
          if (!where) return ERRNO.NOENT;
          node = { type: 'file', data: new Uint8Array(0), mtime: Date.now() };
          where.parent.children.set(where.name, node);
        }
        if ((oflags & OFLAGS.DIRECTORY) && node.type !== 'dir') return ERRNO.NOTDIR;
        if (node.type === 'file' && (oflags & OFLAGS.TRUNC)) {
          node.data = new Uint8Array(0);
          node.mtime = Date.now();
        }
        const fd = self.nextFd++;
        self.fds.set(fd, { node, path, position: 0, append: !!(fdflags & FDFLAGS_APPEND) });
        self.#view.setUint32(fdOut, fd, true);
        return ERRNO.SUCCESS;
      },
      fd_close(fd) {
        const f = self.fds.get(fd);
        if (!f || f.preopen) return ERRNO.BADF;
        self.fds.delete(fd);
        return ERRNO.SUCCESS;
      },
      fd_read(fd, iovs, iovsLen, nreadPtr) {
        const f = self.fds.get(fd);
        if (!f) return ERRNO.BADF;
        if (f.node.type !== 'file') return ERRNO.ISDIR;
        const v = self.#view;
        const mem = self.#bytes;
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const buf = v.getUint32(iovs + i * 8, true);
          const len = v.getUint32(iovs + i * 8 + 4, true);
          const chunk = f.node.data.subarray(f.position, f.position + len);
          mem.set(chunk, buf);
          f.position += chunk.length;
          total += chunk.length;
          if (chunk.length < len) break;
        }
        v.setUint32(nreadPtr, total, true);
        return ERRNO.SUCCESS;
      },
      fd_write(fd, iovs, iovsLen, nwrittenPtr) {
        const v = self.#view;
        const mem = self.#bytes;
        const chunks = [];
        let total = 0;
        for (let i = 0; i < iovsLen; i++) {
          const buf = v.getUint32(iovs + i * 8, true);
          const len = v.getUint32(iovs + i * 8 + 4, true);
          chunks.push(mem.slice(buf, buf + len));
          total += len;
        }
        if (fd === 1 || fd === 2) {
          for (const c of chunks) self.stdout(self.decoder.decode(c));
        } else {
          const f = self.fds.get(fd);
          if (!f) return ERRNO.BADF;
          if (f.node.type !== 'file') return ERRNO.ISDIR;
          if (f.append) f.position = f.node.data.length;
          const end = f.position + total;
          if (end > f.node.data.length) {
            const grown = new Uint8Array(end);
            grown.set(f.node.data);
            f.node.data = grown;
          }
          for (const c of chunks) {
            f.node.data.set(c, f.position);
            f.position += c.length;
          }
          f.node.mtime = Date.now();
        }
        v.setUint32(nwrittenPtr, total, true);
        return ERRNO.SUCCESS;
      },
      fd_seek(fd, offset, whence, newOffsetPtr) {
        const f = self.fds.get(fd);
        if (!f || f.node.type !== 'file') return ERRNO.BADF;
        const base = whence === WHENCE.SET ? 0 : whence === WHENCE.CUR ? f.position : whence === WHENCE.END ? f.node.data.length : NaN;
        const pos = base + Number(offset);
        if (!Number.isFinite(pos) || pos < 0) return ERRNO.INVAL;
        f.position = pos;
        self.#view.setBigUint64(newOffsetPtr, BigInt(pos), true);
        return ERRNO.SUCCESS;
      },
      fd_readdir(fd, buf, bufLen, cookie, bufUsedPtr) {
        const f = self.fds.get(fd);
        if (!f) return ERRNO.BADF;
        if (f.node.type !== 'dir') return ERRNO.NOTDIR;
        const entries = [['.', f.node], ['..', f.node], ...f.node.children];
        const v = self.#view;
        const mem = self.#bytes;
        const encoder = new TextEncoder();
        let used = 0;
        for (let i = Number(cookie); i < entries.length; i++) {
          const [name, node] = entries[i];
          const nameBytes = encoder.encode(name);
          const header = new DataView(new ArrayBuffer(24));
          header.setBigUint64(0, BigInt(i + 1), true); // d_next
          header.setBigUint64(8, 0n, true); // d_ino
          header.setUint32(16, nameBytes.length, true);
          header.setUint8(20, node.type === 'dir' ? FILETYPE.DIRECTORY : FILETYPE.REGULAR_FILE);
          const record = new Uint8Array(24 + nameBytes.length);
          record.set(new Uint8Array(header.buffer), 0);
          record.set(nameBytes, 24);
          // Partial records are allowed: libc sees bufused == bufLen and asks again with a bigger buffer
          const n = Math.min(record.length, bufLen - used);
          mem.set(record.subarray(0, n), buf + used);
          used += n;
          if (used >= bufLen) break;
        }
        v.setUint32(bufUsedPtr, used, true);
        return ERRNO.SUCCESS;
      },
      path_filestat_get(dirFd, _flags, pathPtr, pathLen, out) {
        const path = self.#resolve(dirFd, pathPtr, pathLen);
        const node = path === null ? null : self.fs.lookup(path);
        if (!node) return ERRNO.NOENT;
        self.#writeFilestat(out, node);
        return ERRNO.SUCCESS;
      },
      path_create_directory(dirFd, pathPtr, pathLen) {
        const path = self.#resolve(dirFd, pathPtr, pathLen);
        if (path === null) return ERRNO.NOENT;
        if (self.fs.lookup(path)) return ERRNO.EXIST;
        const where = self.fs.parentOf(path);
        if (!where) return ERRNO.NOENT;
        where.parent.children.set(where.name, { type: 'dir', children: new Map(), mtime: Date.now() });
        return ERRNO.SUCCESS;
      },
      path_unlink_file(dirFd, pathPtr, pathLen) {
        const path = self.#resolve(dirFd, pathPtr, pathLen);
        const node = path === null ? null : self.fs.lookup(path);
        if (!node) return ERRNO.NOENT;
        if (node.type === 'dir') return ERRNO.ISDIR;
        self.fs.remove(path);
        return ERRNO.SUCCESS;
      },
      path_remove_directory(dirFd, pathPtr, pathLen) {
        const path = self.#resolve(dirFd, pathPtr, pathLen);
        const node = path === null ? null : self.fs.lookup(path);
        if (!node) return ERRNO.NOENT;
        if (node.type !== 'dir') return ERRNO.NOTDIR;
        if (node.children.size) return ERRNO.NOTEMPTY;
        self.fs.remove(path);
        return ERRNO.SUCCESS;
      },
      proc_exit(code) {
        throw new WasiExit(code);
      },
    };
  }
}
