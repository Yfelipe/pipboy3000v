import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { AppError } from './errors.js';
import { readJson, sendJson, sendNoContent, sendError } from './http-utils.js';
import { createStaticHandler } from './static.js';
import { RecordStore } from './storage/records.js';
import { FileStore } from './storage/files.js';
import { ActivityLog } from './storage/activity.js';
import { DumpStore } from './storage/dumps.js';
import { KINDS } from '../shared/validate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  // Fonts and icons load from public CDNs; everything else is same-origin.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/lucide@0.577.0/", // wasm: the emulator; lucide only when there's no local copy (npm run vendor)
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
  ].join('; '),
};

/** "sd/MUSIC/Track%2001.wav" -> "sd/MUSIC/Track 01.wav" (each segment decoded separately). */
function decodeSegments(raw) {
  try {
    return raw.split('/').map((s) => decodeURIComponent(s)).join('/');
  } catch {
    throw new AppError(400, 'validation', 'Malformed path encoding');
  }
}

/** decodeURIComponent for one path segment; malformed % escapes are a 400, not a 500. */
function decodeSegment(raw) {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new AppError(400, 'validation', 'Malformed path encoding');
  }
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id < 1 || String(id) !== value) throw new AppError(400, 'validation', 'Invalid id');
  return id;
}

/** Only answer requests addressed to this machine by name (blocks DNS-rebinding). */
function hostAllowed(hostHeader, allowedHosts) {
  if (!hostHeader) return false;
  const host = hostHeader.replace(/:\d+$/, '').replace(/^\[|]$/g, '').toLowerCase();
  return allowedHosts.includes(host);
}

export async function createApp({
  dataDir = path.join(ROOT, 'data'),
  publicDir = path.join(ROOT, 'public'),
  sharedDir = path.join(ROOT, 'shared'),
  emulatorDir = path.join(ROOT, 'emulator'),
  appsDir = path.join(ROOT, 'apps'),
  allowedHosts = ['localhost', '127.0.0.1', '::1'],
  maxUploadBytes = 200 * 1024 * 1024,
  logger = console,
} = {}) {
  const records = new RecordStore(dataDir, { logger });
  const files = new FileStore(dataDir, { maxBytes: maxUploadBytes });
  const activity = new ActivityLog(dataDir);
  const dumps = new DumpStore(dataDir);
  await records.load();
  await files.init();
  await activity.load();
  await dumps.init();

  const servePublic = createStaticHandler(publicDir, '/');
  const serveShared = createStaticHandler(sharedDir, '/shared/');
  // The emulator (emulator/README.md) is a standalone page; only its web-facing parts are served
  const serveEmulator = createStaticHandler(emulatorDir, '/emulator/');
  const EMULATOR_PUBLIC = /^\/emulator\/(index\.html)?$|^\/emulator\/(web|runtime|dist)\//;
  const serveApps = createStaticHandler(appsDir, '/apps/'); // Pip-Boy apps (apps/index.json)

  // [method, regex, handler(req, res, match, url)]
  const routes = [
    ['GET', /^\/api\/health$/, (req, res) => sendJson(res, 200, { ok: true, dataDir, time: new Date().toISOString() })],

    ['GET', /^\/api\/records$/, (req, res, m, url) => {
      const kind = url.searchParams.get('kind');
      if (kind && !KINDS.includes(kind)) throw new AppError(400, 'validation', 'Unknown kind');
      sendJson(res, 200, { records: records.list({ kind: kind || undefined }) });
    }],
    ['POST', /^\/api\/records$/, async (req, res) => {
      const body = await readJson(req);
      if (body?.kind === 'settings') throw new AppError(400, 'validation', 'Use PUT /api/settings for the settings profile');
      sendJson(res, 201, { record: await records.create(body) });
    }],
    ['PATCH', /^\/api\/records\/([^/]+)$/, async (req, res, m) => {
      sendJson(res, 200, { record: await records.update(parseId(m[1]), await readJson(req)) });
    }],
    ['DELETE', /^\/api\/records\/([^/]+)$/, async (req, res, m) => {
      await records.remove(parseId(m[1]));
      sendNoContent(res);
    }],

    ['GET', /^\/api\/settings$/, (req, res) => {
      sendJson(res, 200, { record: records.list({ kind: 'settings' })[0] ?? null });
    }],
    ['PUT', /^\/api\/settings$/, async (req, res) => {
      const body = await readJson(req);
      sendJson(res, 200, { record: await records.saveSettings(body?.payload ?? body) });
    }],

    ['GET', /^\/api\/backup$/, (req, res) => {
      const stamp = new Date().toISOString().slice(0, 10);
      sendJson(res, 200, records.exportBackup(), {
        'Content-Disposition': `attachment; filename="pip-boy-companion-backup-${stamp}.json"`,
      });
    }],
    ['POST', /^\/api\/backup\/preview$/, async (req, res) => {
      const summary = records.previewImport(await readJson(req, 5_000_000));
      delete summary._plan;
      sendJson(res, 200, summary);
    }],
    ['POST', /^\/api\/backup\/import$/, async (req, res) => {
      sendJson(res, 200, await records.importBackup(await readJson(req, 5_000_000)));
    }],

    ['GET', /^\/api\/files$/, async (req, res) => sendJson(res, 200, { files: await files.list() })],
    ['GET', /^\/api\/files\/([^/]+)$/, async (req, res, m) => {
      const { full, info } = await files.stat(decodeSegment(m[1]));
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': info.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(info.name)}`,
        'Cache-Control': 'no-store',
      });
      await pipeline(files.openRead(full), res);
    }],
    ['PUT', /^\/api\/files\/([^/]+)$/, async (req, res, m, url) => {
      const info = await files.save(decodeSegment(m[1]), req, {
        overwrite: url.searchParams.get('overwrite') === '1',
        declaredLength: Number(req.headers['content-length']),
      });
      sendJson(res, 201, { file: info });
    }],
    ['DELETE', /^\/api\/files\/([^/]+)$/, async (req, res, m) => {
      await files.remove(decodeSegment(m[1]));
      sendNoContent(res);
    }],

    ['GET', /^\/api\/dumps$/, async (req, res) => sendJson(res, 200, { dumps: await dumps.list() })],
    ['POST', /^\/api\/dumps$/, async (req, res) => sendJson(res, 201, { dump: await dumps.create() })],
    ['DELETE', /^\/api\/dumps\/([^/]+)$/, async (req, res, m) => {
      await dumps.remove(decodeSegment(m[1]));
      sendNoContent(res);
    }],
    ['PUT', /^\/api\/dumps\/([^/]+)\/files\/(.+)$/, async (req, res, m) => {
      const info = await dumps.save(decodeSegment(m[1]), decodeSegments(m[2]), req, {
        declaredLength: Number(req.headers['content-length']),
      });
      sendJson(res, 201, { file: info });
    }],
    ['GET', /^\/api\/dumps\/([^/]+)\/files\/(.+)$/, async (req, res, m) => {
      const file = await dumps.open(decodeSegment(m[1]), decodeSegments(m[2]));
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': file.size,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        'Cache-Control': 'no-store',
      });
      await pipeline(file.stream, res);
    }],

    ['GET', /^\/api\/logs$/, (req, res, m, url) => {
      const limit = Math.min(5000, Math.max(1, Number(url.searchParams.get('limit')) || 1000));
      sendJson(res, 200, { entries: activity.list({ limit, q: url.searchParams.get('q') || '' }) });
    }],
    ['POST', /^\/api\/logs$/, async (req, res) => {
      const body = await readJson(req);
      sendJson(res, 201, { appended: await activity.append(body?.entries) });
    }],
    ['DELETE', /^\/api\/logs$/, async (req, res) => {
      await activity.clear();
      sendNoContent(res);
    }],
  ];

  /** Answer one request. Errors are thrown (AppError) and answered by handle() below. */
  async function route(req, res, url) {
    const pathname = url.pathname;
    if (!hostAllowed(req.headers.host, allowedHosts)) {
      throw new AppError(421, 'host_not_allowed', 'Host not allowed; open the app via localhost');
    }
    if (pathname.startsWith('/api/')) {
      // Browsers always send Origin on cross-site state-changing requests, and modern ones
      // also say where a request came from in Sec-Fetch-Site (refused unless same-origin or
      // typed by the user). Tools such as curl send neither and are allowed: the server only
      // listens on this machine.
      const origin = req.headers.origin;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        let ok = true;
        if (origin) {
          try {
            ok = new URL(origin).host === req.headers.host;
          } catch {
            ok = false;
          }
        }
        const site = req.headers['sec-fetch-site'];
        if (site && site !== 'same-origin' && site !== 'none') ok = false;
        if (!ok) throw new AppError(403, 'origin_not_allowed', 'Cross-origin request refused');
      }
      let pathMatched = false;
      for (const [method, pattern, fn] of routes) {
        const match = pattern.exec(pathname);
        if (!match) continue;
        pathMatched = true;
        if (method !== req.method) continue;
        await fn(req, res, match, url);
        return;
      }
      if (pathMatched) throw new AppError(405, 'method_not_allowed', 'Method not allowed');
      throw new AppError(404, 'not_found', 'Unknown API route');
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new AppError(405, 'method_not_allowed', 'Method not allowed');
    if (await serveShared(req, res, pathname)) return;
    if (pathname === '/emulator') {
      res.writeHead(301, { Location: '/emulator/' });
      res.end();
      return;
    }
    if (EMULATOR_PUBLIC.test(pathname) && (await serveEmulator(req, res, pathname))) return;
    if (/^\/apps\/.*\.(js|json|ext)$/i.test(pathname) && (await serveApps(req, res, pathname))) return;
    if (await servePublic(req, res, pathname)) return;
    if (pathname === '/vendor/lucide.min.js') {
      // No local copy of the icons yet (npm run vendor): an empty script, so the page can fall
      // back to the CDN without an error in the console
      res.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end('// No local copy: run `npm run vendor` to keep the icons on this computer.\n');
      return;
    }
    throw new AppError(404, 'not_found', 'Not found');
  }

  async function handle(req, res) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    try {
      await route(req, res, new URL(req.url, 'http://localhost'));
    } catch (err) {
      if (err?.code === 'ERR_STREAM_PREMATURE_CLOSE') return;
      sendError(res, err);
    }
  }

  const server = http.createServer(handle);
  return { server, records, files, activity, dumps, dataDir };
}
