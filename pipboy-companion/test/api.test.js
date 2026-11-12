import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createApp, isLoopbackHost } from '../server/app.js';
import { tempDir, quietLogger } from './support/tmp.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let app;
let base;
let dataDir;

/** Raw request so tests can set Host/Origin headers freely. */
function request(method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, base);
    const req = http.request(
      { method, hostname: url.hostname, port: url.port, path: url.pathname + url.search, headers: { Host: url.host, ...headers } },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try {
            json = JSON.parse(buf.toString());
          } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body: buf, json });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    req.end();
  });
}
const json = (method, p, body, headers = {}) => request(method, p, { body, headers: { 'Content-Type': 'application/json', ...headers } });

before(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), 'pipboy-api-'));
  app = await createApp({ dataDir, logger: quietLogger, maxUploadBytes: 1024 * 1024 });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${app.server.address().port}`;
});
after(async () => {
  await new Promise((r) => app.server.close(r));
  await rm(dataDir, { recursive: true, force: true });
});

describe('static files', () => {
  test('serves the app shell and shared modules with security headers', async () => {
    const index = await request('GET', '/');
    assert.equal(index.status, 200);
    assert.match(index.headers['content-type'], /text\/html/);
    assert.match(index.body.toString(), /PIP-BOY/);
    assert.ok(!index.body.toString().includes('_sdk/'), 'no hosted SDK scripts');
    assert.match(index.headers['content-security-policy'], /default-src 'self'/);
    assert.equal(index.headers['x-frame-options'], 'DENY');
    const js = await request('GET', '/js/main.js');
    assert.match(js.headers['content-type'], /javascript/);
    const shared = await request('GET', '/shared/validate.js');
    assert.equal(shared.status, 200);
  });

  test('blocks path traversal and dotfiles', async () => {
    for (const p of ['/../server/app.js', '/%2e%2e/server/app.js', '/..%2fpackage.json', '/shared/../server/app.js', '/.gitignore', '/js/%00.js']) {
      const res = await request('GET', p);
      assert.equal(res.status, 404, p);
      assert.ok(!res.body.toString().includes('createApp'), p);
    }
  });

  test('serves the emulator page, runtime and firmware, but not its sources', async () => {
    assert.equal((await request('GET', '/emulator')).status, 301);
    const page = await request('GET', '/emulator/');
    assert.equal(page.status, 200);
    assert.match(page.body.toString(), /web\/app\.js/);
    assert.match(page.headers['content-security-policy'], /'wasm-unsafe-eval'/);
    assert.equal((await request('GET', '/emulator/runtime/espruino.js')).status, 200);
    const wasm = await request('HEAD', '/emulator/dist/pipboy_wasm.wasm');
    assert.equal(wasm.status, 200);
    assert.equal(wasm.headers['content-type'], 'application/wasm');
    assert.equal((await request('GET', '/emulator/build.sh')).status, 404);
    assert.equal((await request('GET', '/emulator/espruino/ESPRUINO_COMMIT')).status, 404);
    assert.equal((await request('GET', '/apps/index.json')).status, 200);
    assert.equal((await request('GET', '/apps/holotapes/sd/CLOCK/ROBCO.IMG')).status, 200, 'a holotape\'s image file');
    assert.equal((await request('GET', '/apps/holotapes/build.sh')).status, 404, 'only app files are served');
    // assets: only pictures at the top of assets/official (the ID card emblems)
    assert.equal((await request('GET', '/assets/official/STAT/VB01.avi')).status, 404);
    assert.equal((await request('GET', '/assets/official/fallout-level-up.ogg')).status, 404);
    assert.equal((await request('GET', '/assets/official/missing.png')).status, 404);
    assert.equal((await request('GET', '/apps/mojave/mojave.min.js')).status, 200);
    assert.equal((await request('GET', '/apps/mojave/build.sh')).status, 404);
  });

  test('rejects non-GET methods on static paths', async () => {
    assert.equal((await request('POST', '/index.html')).status, 405);
  });
});

describe('request guards', () => {
  test('the server only listens on this computer', () => {
    for (const host of ['127.0.0.1', '::1', 'localhost', 'LOCALHOST']) assert.equal(isLoopbackHost(host), true, host);
    for (const host of ['0.0.0.0', '::', '192.168.1.20', 'example.com', '']) assert.equal(isLoopbackHost(host), false, host);
  });

  test('rejects foreign Host headers (DNS rebinding)', async () => {
    const res = await request('GET', '/api/health', { headers: { Host: 'evil.example:8077' } });
    assert.equal(res.status, 421);
  });

  test('rejects cross-origin writes', async () => {
    const res = await json('POST', '/api/records', { kind: 'app', name: 'x', payload: {} }, { Origin: 'https://evil.example' });
    assert.equal(res.status, 403);
    const same = await json('POST', '/api/records', { kind: 'app', name: 'same-origin', payload: {} }, { Origin: base });
    assert.equal(same.status, 201);
    // no Origin, but the browser says it came from another site
    const site = await request('DELETE', '/api/logs', { headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(site.status, 403);
    assert.equal((await request('DELETE', '/api/logs', { headers: { 'Sec-Fetch-Site': 'same-origin', Origin: base } })).status, 204);
  });

  test('Pip-OS releases per variant, read from The Wand Company\'s indexes on the server and cached', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'pipboy-pipos-'));
    const asked = [];
    const indexes = {
      'https://cdn.thewandcompany.com/blueprint/index.json': [{ Version: 'v1.33', ReleaseDate: '2026-10-29T22:44:21+00:00', Assets: ['blueprint/v1.33/assets/blueprint_2v29.400-1.33.zip'] }],
      'https://cdn.thewandcompany.com/blueprint-overseer/index.json': [{ Version: 'v2.01', ReleaseDate: '2026-11-10T01:13:57+00:00', Assets: ['blueprint-overseer/v2.01/assets/overseer_2v29.402-2.01.zip'] }],
    };
    const other = await createApp({ dataDir: dir, logger: quietLogger, fetchImpl: async (url) => { asked.push(url); return { ok: !!indexes[url], json: async () => indexes[url] }; } });
    await new Promise((r) => other.server.listen(0, '127.0.0.1', r));
    const base = `http://localhost:${other.server.address().port}/api/pipos-releases`;
    const get = (q = '') => fetch(base + q).then(async (r) => ({ status: r.status, body: await r.json() }));
    assert.equal((await get()).body.releases[0].zipUrl, 'https://cdn.thewandcompany.com/blueprint/v1.33/assets/blueprint_2v29.400-1.33.zip', 'blueprint by default');
    const overseer = await get('?variant=overseer');
    assert.equal(overseer.body.releases[0].zipFile, 'overseer_2v29.402-2.01.zip');
    await get('?variant=overseer');
    assert.equal(asked.filter((u) => u.includes('overseer')).length, 1, 'cached');
    assert.equal((await get('?variant=FO3')).body.releases, null, 'a list that can\'t be read is null (and asked again next time)');
    assert.equal((await get('?variant=../../etc')).status, 400, 'only known variants');
    other.server.close();
    await rm(dir, { recursive: true, force: true });
  });

  test('malformed % escapes in a path are a 400, not a server error', async () => {
    assert.equal((await request('GET', '/api/files/%E0%A4%A')).status, 400);
    assert.equal((await request('DELETE', '/api/dumps/%zz')).status, 400);
  });

  test('requires JSON content type and valid JSON', async () => {
    assert.equal((await request('POST', '/api/records', { body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
    const bad = await request('POST', '/api/records', { body: '{nope', headers: { 'Content-Type': 'application/json' } });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.error.code, 'invalid_json');
  });

  test('limits JSON body size', async () => {
    const res = await json('POST', '/api/records', 'x'.repeat(1_100_000));
    assert.equal(res.status, 413);
  });

  test('unknown routes and wrong methods', async () => {
    assert.equal((await request('GET', '/api/nope')).status, 404);
    assert.equal((await request('PUT', '/api/records')).status, 405);
    assert.equal((await request('DELETE', '/api/records/abc')).status, 400);
    assert.equal((await request('DELETE', '/api/records/1.5')).status, 400);
  });
});

describe('records API', () => {
  test('create, list, update, delete', async () => {
    const created = await json('POST', '/api/records', { kind: 'radio', name: 'Galaxy News', payload: { frequency: '100.1' } });
    assert.equal(created.status, 201);
    const id = created.json.record.id;

    const dup = await json('POST', '/api/records', { kind: 'radio', name: 'Again', payload: { frequency: 100.1 } });
    assert.equal(dup.status, 409);
    assert.match(dup.json.error.message, /already saved/);

    const list = await request('GET', '/api/records?kind=radio');
    assert.ok(list.json.records.some((r) => r.id === id));
    assert.equal((await request('GET', '/api/records?kind=bogus')).status, 400);

    const patched = await json('PATCH', `/api/records/${id}`, { name: 'GNR' });
    assert.equal(patched.json.record.name, 'GNR');

    assert.equal((await request('DELETE', `/api/records/${id}`)).status, 204);
    assert.equal((await request('DELETE', `/api/records/${id}`)).status, 404);
  });

  test('validation errors come back as 400 with a message', async () => {
    const res = await json('POST', '/api/records', { kind: 'radio', name: 'X', payload: { frequency: 'abc' } });
    assert.equal(res.status, 400);
    assert.equal(res.json.error.code, 'validation');
  });

  test('settings use their own upsert endpoint', async () => {
    assert.equal((await json('POST', '/api/records', { kind: 'settings', name: 's', payload: {} })).status, 400);
    const first = await json('PUT', '/api/settings', { payload: { brightness: 'High' } });
    const second = await json('PUT', '/api/settings', { payload: { brightness: 'Low' } });
    assert.equal(first.json.record.id, second.json.record.id);
    const got = await request('GET', '/api/settings');
    assert.equal(got.json.record.payload.brightness, 'Low');
    assert.equal((await json('PUT', '/api/settings', { payload: { brightness: 'Blinding' } })).status, 400);
  });

  test('backup export, preview and atomic import', async () => {
    const exported = await request('GET', '/api/backup');
    assert.match(exported.headers['content-disposition'], /attachment/);
    assert.equal(exported.json.format, 'pip-boy-companion-backup');

    const backup = { format: 'pip-boy-companion-backup', records: [{ kind: 'app', name: 'From backup', payload: { version: '9' } }] };
    const preview = await json('POST', '/api/backup/preview', backup);
    assert.equal(preview.json.apps, 1);
    assert.equal(preview.json._plan, undefined, 'internal plan not leaked');

    const before = (await request('GET', '/api/records')).json.records.length;
    const bad = await json('POST', '/api/backup/import', { ...backup, records: [...backup.records, { kind: 'radio', name: 'bad', payload: { frequency: 1 } }] });
    assert.equal(bad.status, 400);
    assert.equal((await request('GET', '/api/records')).json.records.length, before, 'nothing imported');

    const ok = await json('POST', '/api/backup/import', backup);
    assert.equal(ok.json.imported, 1);
  });
});

describe('workspace files API', () => {
  test('upload, list, download, overwrite and delete', async () => {
    const content = Buffer.from([0, 1, 2, 255, 254]);
    const up = await request('PUT', '/api/files/clip%20(1).wav', { body: content, headers: { 'Content-Type': 'application/octet-stream' } });
    assert.equal(up.status, 201);
    assert.equal(up.json.file.size, 5);

    const list = await request('GET', '/api/files');
    assert.ok(list.json.files.some((f) => f.name === 'clip (1).wav'));

    const down = await request('GET', '/api/files/clip%20(1).wav');
    assert.equal(down.status, 200);
    assert.deepEqual([...down.body], [...content]);
    assert.match(down.headers['content-disposition'], /attachment/);

    const again = await request('PUT', '/api/files/clip%20(1).wav', { body: 'x' });
    assert.equal(again.status, 409);
    const over = await request('PUT', '/api/files/clip%20(1).wav?overwrite=1', { body: 'x' });
    assert.equal(over.status, 201);
    assert.equal(over.json.file.size, 1);

    assert.equal((await request('DELETE', '/api/files/clip%20(1).wav')).status, 204);
    assert.equal((await request('GET', '/api/files/clip%20(1).wav')).status, 404);
  });

  test('rejects traversal in file names', async () => {
    // %2e%2e is normalised to ".." by the URL parser and never reaches the file route (404);
    // the others reach it and are refused by name validation (400). Either way nothing is written.
    for (const name of ['..%2f..%2fpackage.json', '%2e%2e', '.hidden', 'a%5cb', '..%2frecords.json']) {
      const res = await request('PUT', `/api/files/${name}`, { body: 'x' });
      assert.ok([400, 404].includes(res.status), `${name} -> ${res.status}`);
    }
    assert.equal((await request('GET', '/api/files/..%2fpackage.json')).status, 400);
    const { readdir, readFile } = await import('node:fs/promises');
    assert.deepEqual((await readdir(dataDir)).filter((f) => !['records.json', 'workspace', 'activity.jsonl', 'dumps'].includes(f)), []);
    const records = JSON.parse(await readFile(path.join(dataDir, 'records.json'), 'utf8'));
    assert.ok(Array.isArray(records.records), 'records.json not clobbered');
  });

  test('rejects uploads over the limit', async () => {
    const res = await request('PUT', '/api/files/huge.bin', { body: Buffer.alloc(1024 * 1024 + 1) });
    assert.equal(res.status, 413);
    const list = await request('GET', '/api/files');
    assert.ok(!list.json.files.some((f) => f.name === 'huge.bin'));
  });
});

describe('dumps API', () => {
  test('create, save nested files with encoded names, read back, list, delete', async () => {
    const created = await request('POST', '/api/dumps', { headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(created.status, 201);
    const id = created.json.dump.id;
    const put = await request('PUT', `/api/dumps/${id}/files/sd/MUSIC/Live%20Set/a%20b.wav`, { body: Buffer.from([1, 2, 3]) });
    assert.equal(put.status, 201);
    assert.equal(put.json.file.path, 'sd/MUSIC/Live Set/a b.wav');
    const got = await request('GET', `/api/dumps/${id}/files/sd/MUSIC/Live%20Set/a%20b.wav`);
    assert.deepEqual([...got.body], [1, 2, 3]);
    const list = await request('GET', '/api/dumps');
    assert.ok(list.json.dumps.some((d) => d.id === id && d.complete === false));
    assert.equal((await request('DELETE', `/api/dumps/${id}`)).status, 204);
    assert.equal((await request('GET', `/api/dumps/${id}/files/sd/MUSIC/Live%20Set/a%20b.wav`)).status, 404);
  });

  test('rejects traversal in dump ids and paths', async () => {
    const id = (await request('POST', '/api/dumps', { headers: { 'Content-Type': 'application/json' }, body: '{}' })).json.dump.id;
    for (const rel of ['..%2F..%2Fpackage.json', 'sd/..%2F..%2F..%2Fx', 'a%5Cb', 'a%3Ab']) {
      const res = await request('PUT', `/api/dumps/${id}/files/${rel}`, { body: 'x' });
      assert.ok([400, 404].includes(res.status), `${rel} -> ${res.status}`);
    }
    assert.equal((await request('PUT', '/api/dumps/..%2F..%2Fdata/files/x', { body: 'x' })).status, 400);
    await request('DELETE', `/api/dumps/${id}`);
  });
});

describe('logs API', () => {
  test('append, list, filter, clear', async () => {
    assert.equal((await json('POST', '/api/logs', { entries: [{ message: 'hello vault' }, { message: 'error here', level: 'error' }] })).status, 201);
    const all = await request('GET', '/api/logs');
    assert.equal(all.json.entries[0].message, 'error here');
    const filtered = await request('GET', '/api/logs?q=VAULT');
    assert.deepEqual(filtered.json.entries.map((e) => e.message), ['hello vault']);
    assert.equal((await json('POST', '/api/logs', { entries: [] })).status, 400);
    assert.equal((await request('DELETE', '/api/logs')).status, 204);
    assert.equal((await request('GET', '/api/logs')).json.entries.length, 0);
  });
});

describe('persistence', () => {
  test('a new server on the same data directory sees the same data', async (t) => {
    const dir = await tempDir(t);
    const first = await createApp({ dataDir: dir, logger: quietLogger });
    await first.records.create({ kind: 'app', name: 'Survivor', payload: {} });
    const second = await createApp({ dataDir: dir, logger: quietLogger });
    assert.equal(second.records.list()[0].name, 'Survivor');
  });
});
