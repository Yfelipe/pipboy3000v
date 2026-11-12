import { promises as fs, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

/**
 * Serves files from `root` for URLs under `prefix`. Resolves the decoded path and
 * refuses anything that would land outside `root` (path traversal) or is a dotfile.
 */
export function createStaticHandler(root, prefix = '/') {
  const base = path.resolve(root);
  return async function serveStatic(req, res, pathname) {
    if (!pathname.startsWith(prefix)) return false;
    let rel;
    try {
      rel = decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      return false;
    }
    if (rel === '' || rel.endsWith('/')) rel += 'index.html';
    if (rel.includes('\0') || rel.split(/[\\/]/).some((part) => part.startsWith('.'))) return false;
    const full = path.resolve(base, rel);
    if (full !== base && !full.startsWith(base + path.sep)) return false;
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      return false;
    }
    if (!stat.isFile()) return false;
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Content-Length': stat.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    if (req.method === 'HEAD') {
      res.end();
      return true;
    }
    // pipeline, not pipe: a read error (the file vanished after stat) must not crash the server
    pipeline(createReadStream(full), res).catch(() => res.destroy());
    return true;
  };
}
