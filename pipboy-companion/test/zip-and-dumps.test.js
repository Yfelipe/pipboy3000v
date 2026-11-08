import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { crc32, createZip } from '../public/js/zip.js';
import { DumpStore } from '../server/storage/dumps.js';
import { tempDir } from './support/tmp.js';

describe('zip', () => {
  test('crc32 matches the standard check value', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    assert.equal(crc32(new Uint8Array(0)), 0);
  });

  test('produces a structurally valid archive', () => {
    const enc = new TextEncoder();
    const zip = createZip([{ name: 'A/' }, { name: 'A/b c.txt', bytes: enc.encode('hello') }, { name: 'ü.bin', bytes: new Uint8Array([0, 255]) }]);
    const view = new DataView(zip.buffer);
    assert.equal(view.getUint32(0, true), 0x04034b50, 'local header first');
    const end = zip.length - 22;
    assert.equal(view.getUint32(end, true), 0x06054b50, 'end of central directory last');
    assert.equal(view.getUint16(end + 10, true), 3, 'three entries');
  });

  test('unzip accepts it when available', (t) => {
    try {
      execFileSync('unzip', ['-v'], { stdio: 'ignore' });
    } catch {
      t.skip('unzip not installed');
      return;
    }
    const dir = mkdtempSync(path.join(tmpdir(), 'zip-'));
    const file = path.join(dir, 't.zip');
    writeFileSync(file, createZip([{ name: 'MUSIC/' }, { name: 'MUSIC/Track 01.wav', bytes: new Uint8Array(70_000).map((_, i) => i & 255) }]));
    const out = execFileSync('unzip', ['-t', file]).toString();
    assert.match(out, /No errors detected/);
  });
});

describe('DumpStore', () => {
  async function store(t) {
    const s = new DumpStore(await tempDir(t), { maxFileBytes: 1024 });
    await s.init();
    return s;
  }

  test('creates a dump, saves nested files, lists and removes it', async (t) => {
    const s = await store(t);
    const { id, path: dir } = await s.create();
    assert.match(id, /^pipboy-\d{4}-/);
    await s.save(id, 'sd/MUSIC/Live Set/a b.wav', Readable.from([Buffer.from('RIFF')]));
    await s.save(id, 'storage/%2Eboot0', Readable.from([Buffer.from('boot')]));
    assert.equal(await readFile(path.join(dir, 'sd', 'MUSIC', 'Live Set', 'a b.wav'), 'utf8'), 'RIFF');

    let [listed] = await s.list();
    assert.equal(listed.complete, false, 'no manifest yet');
    await s.save(id, 'manifest.json', Readable.from([Buffer.from(JSON.stringify({
      created_at: 'now', device: { env: { BOARD: 'PIPBOY', VERSION: '2v24' } },
      storage: [{ file: 'x' }], sd: { entries: [{ file: 'y' }, { skipped: 'big' }] }, errors: [],
    }))]));
    [listed] = await s.list();
    assert.equal(listed.complete, true, 'old manifests without a flag count as complete');
    assert.equal(listed.board, 'PIPBOY');
    assert.equal(listed.sdSkipped, 1);

    await s.save(id, 'manifest.json', Readable.from([Buffer.from(JSON.stringify({ complete: false, aborted: 'The Pip-Boy stopped answering', storage: [], sd: { entries: [] }, errors: [] }))]));
    [listed] = await s.list();
    assert.equal(listed.complete, false);
    assert.equal(listed.hasManifest, true);
    assert.match(listed.aborted, /stopped answering/);

    const file = await s.open(id, 'storage/%2Eboot0');
    assert.equal(file.size, 4);
    file.stream.destroy();
    await s.remove(id);
    assert.deepEqual(await s.list(), []);
  });

  test('refuses traversal, bad ids, oversize files and leaves no partial files', async (t) => {
    const s = await store(t);
    const { id, path: dir } = await s.create();
    for (const rel of ['../x', 'a/../../x', '/etc/passwd', 'a\\b', 'a:b', '']) {
      await assert.rejects(s.save(id, rel, Readable.from(['x'])), { status: 400 }, rel);
    }
    await assert.rejects(s.save('../../etc', 'a', Readable.from(['x'])), { status: 400 });
    await assert.rejects(s.save('pipboy-2026-01-01-00-00-00-abcd', 'a', Readable.from(['x'])), { status: 404 });
    await assert.rejects(s.save(id, 'big.bin', Readable.from([Buffer.alloc(800), Buffer.alloc(800)])), { status: 413 });
    assert.deepEqual(await readdir(dir), []);
  });
});
