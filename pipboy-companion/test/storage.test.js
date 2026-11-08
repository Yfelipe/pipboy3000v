import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { RecordStore } from '../server/storage/records.js';
import { FileStore } from '../server/storage/files.js';
import { ActivityLog } from '../server/storage/activity.js';
import { tempDir, quietLogger } from './support/tmp.js';
import { BACKUP_FORMAT } from '../shared/validate.js';

async function store(t, dir) {
  const s = new RecordStore(dir ?? (await tempDir(t)), { logger: quietLogger });
  await s.load();
  return s;
}

describe('RecordStore', () => {
  test('persists across restarts', async (t) => {
    const dir = await tempDir(t);
    const a = await store(t, dir);
    await a.create({ kind: 'app', name: 'Holotape', payload: { version: '1.0' } });
    await a.create({ kind: 'radio', name: 'Diamond City', payload: { frequency: '95.5' } });
    await a.saveSettings({ theme: 'Amber' });

    const b = await store(t, dir);
    assert.equal(b.list().length, 3);
    assert.equal(b.list({ kind: 'settings' })[0].payload.theme, 'Amber');
    const created = await b.create({ kind: 'app', name: 'Next', payload: {} });
    assert.equal(created.id, 4, 'ids keep increasing after restart');
  });

  test('rejects invalid input and duplicate frequencies', async (t) => {
    const s = await store(t);
    await assert.rejects(s.create({ kind: 'radio', name: 'X', payload: { frequency: '200' } }), { status: 400 });
    await s.create({ kind: 'radio', name: 'A', payload: { frequency: '101.7' } });
    await assert.rejects(s.create({ kind: 'radio', name: 'B', payload: { frequency: 101.7 } }), { status: 409, code: 'duplicate' });
    await assert.rejects(s.create({ kind: 'settings', name: 'S', payload: {} }).then(() => s.create({ kind: 'settings', name: 'S2', payload: {} })), { status: 409 });
  });

  test('only one settings profile ever exists', async (t) => {
    const s = await store(t);
    await s.saveSettings({ volume: 'High' });
    await s.saveSettings({ volume: 'Low' });
    const settings = s.list({ kind: 'settings' });
    assert.equal(settings.length, 1);
    assert.equal(settings[0].payload.volume, 'Low');
  });

  test('update and remove', async (t) => {
    const s = await store(t);
    const r = await s.create({ kind: 'radio', name: 'A', payload: { frequency: '90.1' } });
    const u = await s.update(r.id, { name: 'Renamed', payload: { frequency: '90.3' } });
    assert.equal(u.name, 'Renamed');
    assert.equal(u.payload.frequency, '90.3');
    await assert.rejects(s.update(r.id, { kind: 'app' }), /cannot be changed/);
    await s.remove(r.id);
    await assert.rejects(s.remove(r.id), { status: 404 });
  });

  test('enforces the 999-record limit', async (t) => {
    const dir = await tempDir(t);
    const records = Array.from({ length: 999 }, (_, i) => ({ id: i + 1, kind: 'app', name: `a${i}`, payload: { version: '' }, created_at: 'x', updated_at: 'x' }));
    await writeFile(path.join(dir, 'records.json'), JSON.stringify({ version: 1, nextId: 1000, records }));
    const s = await store(t, dir);
    await assert.rejects(s.create({ kind: 'app', name: 'one more', payload: {} }), { status: 409, code: 'limit' });
  });

  test('concurrent writes never lose records', async (t) => {
    const dir = await tempDir(t);
    const s = await store(t, dir);
    await Promise.all(Array.from({ length: 40 }, (_, i) => s.create({ kind: 'app', name: `app ${i}`, payload: {} })));
    const reloaded = await store(t, dir);
    assert.equal(reloaded.list().length, 40);
    assert.equal(new Set(reloaded.list().map((r) => r.id)).size, 40);
  });

  test('a failed write leaves the previous state intact', async (t) => {
    const s = await store(t);
    await s.create({ kind: 'app', name: 'keep', payload: {} });
    await assert.rejects(s.create({ kind: 'app', name: '', payload: {} }));
    assert.deepEqual(s.list().map((r) => r.name), ['keep']);
  });

  test('a corrupt file is moved aside, not overwritten', async (t) => {
    const dir = await tempDir(t);
    await writeFile(path.join(dir, 'records.json'), '{ this is not json');
    const s = await store(t, dir);
    assert.equal(s.list().length, 0);
    const files = await readdir(dir);
    const aside = files.find((f) => f.startsWith('records.json.corrupt-'));
    assert.ok(aside, 'corrupt copy kept');
    assert.equal(await readFile(path.join(dir, aside), 'utf8'), '{ this is not json');
  });

  test('backup export → import round-trip (v2) and legacy v1 import', async (t) => {
    const a = await store(t);
    await a.create({ kind: 'app', name: 'App', payload: { version: '2' } });
    await a.create({ kind: 'radio', name: 'Radio', payload: { frequency: '88.1' } });
    await a.saveSettings({ clock: '12-hour' });
    const backup = a.exportBackup();
    assert.equal(backup.version, 2);

    const b = await store(t);
    const result = await b.importBackup(JSON.parse(JSON.stringify(backup)));
    assert.equal(result.imported, 3);
    assert.equal(b.list({ kind: 'settings' })[0].payload.clock, '12-hour');

    const c = await store(t);
    await c.importBackup({
      format: BACKUP_FORMAT, version: 1,
      records: [{ kind: 'radio', name: 'Old', payload: '{"frequency":"99.9"}', created_at: '2024-05-01T00:00:00Z' }],
    });
    assert.equal(c.list()[0].payload.frequency, '99.9');
    assert.equal(c.list()[0].created_at, '2024-05-01T00:00:00.000Z');
  });

  test('import skips known frequencies, merges settings, and creates no duplicate profiles', async (t) => {
    const s = await store(t);
    await s.create({ kind: 'radio', name: 'Existing', payload: { frequency: '101.7' } });
    await s.saveSettings({ theme: 'Amber' });
    const backup = {
      format: BACKUP_FORMAT,
      records: [
        { kind: 'radio', name: 'Same freq', payload: { frequency: '101.7' } },
        { kind: 'radio', name: 'New', payload: { frequency: '102.1' } },
        { kind: 'radio', name: 'Dup inside file', payload: { frequency: '102.1' } },
        { kind: 'settings', name: 'S1', payload: { theme: 'Cool White' } },
        { kind: 'settings', name: 'S2', payload: { theme: 'Phosphor Green' } },
      ],
    };
    const preview = s.previewImport(backup);
    assert.equal(preview.radio, 1);
    assert.equal(preview.skipped.length, 2);
    assert.equal(preview.settings, 'update');
    const result = await s.importBackup(backup);
    assert.equal(result.imported, 2);
    assert.equal(s.list({ kind: 'settings' }).length, 1);
    assert.equal(s.list({ kind: 'settings' })[0].payload.theme, 'Phosphor Green');
    assert.equal(s.list({ kind: 'radio' }).length, 2);
  });

  test('an invalid backup imports nothing', async (t) => {
    const s = await store(t);
    await assert.rejects(
      s.importBackup({ format: BACKUP_FORMAT, records: [{ kind: 'app', name: 'ok', payload: {} }, { kind: 'radio', name: 'bad', payload: { frequency: 'x' } }] }),
      { status: 400 },
    );
    assert.equal(s.list().length, 0);
  });

  test('import counts a new settings profile against the record limit', async (t) => {
    const dir = await tempDir(t);
    const records = Array.from({ length: 999 }, (_, i) => ({ id: i + 1, kind: 'app', name: `a${i}`, payload: { version: '' }, created_at: 'x', updated_at: 'x' }));
    await writeFile(path.join(dir, 'records.json'), JSON.stringify({ version: 1, nextId: 1000, records }));
    const s = await store(t, dir);
    await assert.rejects(s.importBackup({ format: BACKUP_FORMAT, records: [{ kind: 'settings', name: 'S', payload: {} }] }), { code: 'limit' });
  });
});

describe('FileStore', () => {
  async function files(t, opts) {
    const f = new FileStore(await tempDir(t), opts);
    await f.init();
    return f;
  }

  test('saves, lists, reads and deletes files', async (t) => {
    const f = await files(t);
    await f.save('track.mp3', Readable.from([Buffer.from('ID3...')]));
    const list = await f.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].size, 6);
    assert.equal(list[0].media.ok, true);
    const { full } = await f.stat('track.mp3');
    assert.equal(await readFile(full, 'utf8'), 'ID3...');
    await f.remove('track.mp3');
    assert.equal((await f.list()).length, 0);
  });

  test('refuses traversal and unsafe names', async (t) => {
    const f = await files(t);
    for (const name of ['../escape.txt', '..', '.env', 'a/b.txt', 'CON']) {
      await assert.rejects(f.save(name, Readable.from(['x'])), { status: 400 }, name);
      await assert.rejects(f.stat(name), { status: 400 }, name);
    }
  });

  test('does not overwrite unless asked', async (t) => {
    const f = await files(t);
    await f.save('a.txt', Readable.from(['one']));
    await assert.rejects(f.save('a.txt', Readable.from(['two'])), { status: 409 });
    await f.save('a.txt', Readable.from(['two']), { overwrite: true });
    assert.equal(await readFile((await f.stat('a.txt')).full, 'utf8'), 'two');
  });

  test('enforces the size limit and leaves no partial file', async (t) => {
    const f = await files(t, { maxBytes: 10 });
    await assert.rejects(f.save('big.bin', Readable.from([Buffer.alloc(6), Buffer.alloc(6)])), { status: 413 });
    assert.deepEqual(await readdir(f.dir), []);
  });
});

describe('ActivityLog', () => {
  test('appends, lists newest first, filters and survives restart', async (t) => {
    const dir = await tempDir(t);
    const a = new ActivityLog(dir);
    await a.load();
    await a.append([{ message: 'first' }, { message: 'second', level: 'error' }]);
    const b = new ActivityLog(dir);
    await b.load();
    assert.deepEqual(b.list().map((e) => e.message), ['second', 'first']);
    assert.equal(b.list()[0].level, 'error');
    assert.deepEqual(b.list({ q: 'FIR' }).map((e) => e.message), ['first']);
  });

  test('stays bounded on disk and in memory', async (t) => {
    const dir = await tempDir(t);
    const log = new ActivityLog(dir, { maxEntries: 50 });
    await log.load();
    for (let i = 0; i < 12; i++) await log.append(Array.from({ length: 10 }, (_, j) => ({ message: `m${i * 10 + j}` })));
    assert.equal(log.list({ limit: 1000 }).length, 50);
    const reloaded = new ActivityLog(dir, { maxEntries: 50 });
    await reloaded.load();
    assert.equal(reloaded.list({ limit: 1000 }).length, 50);
    assert.equal(reloaded.list()[0].message, 'm119');
    const lines = (await readFile(path.join(dir, 'activity.jsonl'), 'utf8')).trim().split('\n');
    assert.ok(lines.length <= 50);
  });

  test('ignores a torn last line and validates input', async (t) => {
    const dir = await tempDir(t);
    await writeFile(path.join(dir, 'activity.jsonl'), '{"at":"2025-01-01T00:00:00Z","message":"ok"}\n{"at":"2025-01-0');
    const log = new ActivityLog(dir);
    await log.load();
    assert.equal(log.list().length, 1);
    await assert.rejects(log.append([]), { status: 400 });
    await assert.rejects(log.append([{ nope: 1 }]), { status: 400 });
    await log.clear();
    assert.equal(log.list().length, 0);
  });
});
