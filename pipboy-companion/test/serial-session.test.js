import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SerialSession, RELEASE_LINE } from '../public/js/serial/session.js';
import { buildCommand } from '../public/js/serial/protocol.js';
import * as ops from '../public/js/serial/device-ops.js';
import { createFakePipBoy } from './support/fake-espruino.js';

const fast = () => new SerialSession({ promptDelayMs: 5, writePauseMs: 0, releaseIntervalMs: 5 });
const noDelay = { chunkDelayMs: 0 };

async function connected(options) {
  const port = createFakePipBoy(options);
  const session = fast();
  await session.open(port);
  return { port, session };
}

describe('connection', () => {
  test('verifies the board and reports status', async () => {
    const { session } = await connected();
    assert.equal(session.connected, true);
    assert.equal(session.board, 'PIPBOY');
    const s = session.status();
    assert.equal(s.replStatus, 'verified');
    assert.equal(s.portOpen, true);
    assert.equal(s.queueStatus, 'idle');
    await session.close();
  });

  test('accepts a null board (firmware without process.env.BOARD)', async () => {
    const { session } = await connected({ board: null });
    assert.equal(session.connected, true);
    assert.equal(session.board, null);
    await session.close();
  });

  test('rejects an unexpected board and leaves the port open for recovery', async () => {
    const port = createFakePipBoy({ board: 'BANGLEJS2' });
    const session = fast();
    await assert.rejects(session.open(port), /Unexpected board: BANGLEJS2/);
    assert.equal(session.connected, false);
    assert.equal(session.portOpen, true);
    await session.close();
  });

  test('times out when the device never answers', { timeout: 8000 }, async () => {
    const port = createFakePipBoy({ respond: false });
    const session = fast();
    session.verifyBoard = function () {
      return this.transaction('process.env.BOARD', 'board', { timeout: 300, requireVerified: false });
    };
    await assert.rejects(session.open(port), /timeout/i);
    await session.close();
  });

  test('connects when the device inserts spaces and erase sequences around markers', async () => {
    const quirky = (t) =>
      t
        .replace('< << ', 'xy\x08 \x08\x08 \x08<  <<  ')
        .replace(' >> >', '  >>\x08 \x08>  >');
    const { session } = await connected({ transform: quirky });
    assert.equal(session.connected, true);
    assert.deepEqual(await session.command('[1,2]'), [1, 2]);
    await session.close();
  });

  test('a silent device logs a persistent diagnostic snapshot', { timeout: 8000 }, async () => {
    const port = createFakePipBoy({ respond: false });
    port.emit = () => {}; // nothing at all comes back, not even a prompt
    const logs = [];
    const session = new SerialSession({ promptDelayMs: 5, writePauseMs: 0, events: { log: (level, m) => logs.push({ level, m }) } });
    const original = session.transaction.bind(session);
    session.transaction = (e, k, o) => original(e, k, { ...o, timeout: 300 });
    await assert.rejects(session.open(port), /timeout/i);
    const wake = logs.find((l) => l.m.startsWith('Wake:'));
    assert.ok(wake, 'wake result logged');
    const failure = logs.find((l) => l.level === 'error' && l.m.startsWith('Board verification failed'));
    assert.ok(failure, 'failure logged at error level (persisted to the server)');
    assert.match(failure.m, /bytes in \d+ \/ out \d+/);
    assert.match(failure.m, /raw tail/);
    assert.ok(logs.some((l) => /port opened .*(DTR asserted|not supported)/.test(l.m)));
    await session.close();
  });

  test('regression (13:11 logs): a completely silent device gets a clear message and is not flooded', { timeout: 10000 }, async () => {
    const port = createFakePipBoy({ respond: false, silentPrompt: true });
    const session = new SerialSession({ promptDelayMs: 5, releaseIntervalMs: 20 });
    const orig = session.transaction.bind(session);
    session.transaction = (e, k, o) => orig(e, k, { ...o, timeout: 1500 });
    await assert.rejects(session.open(port), /not sent a single byte.*asleep, switched off.*power button/s);
    const releases = port.state.lines.filter((l) => l === 'print("")').length;
    assert.ok(releases <= 20, `sent ${releases} release lines to a silent device`);
    await session.close();
  });

  test('diagnostics include an unparseable reply so it can be read in the log', { timeout: 8000 }, async () => {
    const logs = [];
    const port = createFakePipBoy({
      hooks: {
        beforeEval(code, { emit }) {
          if (code.includes('process.env.BOARD')) {
            emit('< << {"requestId":"broken" >> >\r\n>');
            return false;
          }
          return true;
        },
      },
    });
    const session = new SerialSession({ promptDelayMs: 5, writePauseMs: 0, events: { log: (level, m) => logs.push({ level, m }) } });
    const original = session.transaction.bind(session);
    session.transaction = (e, k, o) => original(e, k, { ...o, timeout: 300 });
    await assert.rejects(session.open(port), /timeout/i);
    const failure = logs.find((l) => l.m.startsWith('Board verification failed'));
    assert.match(failure.m, /stale frames 1/);
    assert.match(failure.m, /last stale frame: "\{\\?"requestId\\?":\\?"broken\\?"/);
    await session.close();
  });

  test('regression: device that holds the last write until more input arrives (real Pip-Boy)', async () => {
    const port = createFakePipBoy({ holdLastTransfer: true, silentPrompt: true, storage: { 'a.js': 'print(1)' } });
    const session = fast();
    await session.open(port);
    assert.equal(session.connected, true);
    assert.deepEqual(await ops.storageList(session), ['a.js']);
    await ops.storageWrite(session, 'b.js', ops.utf8('x'.repeat(500)), noDelay);
    assert.equal(port.state.storage.text('b.js'), 'x'.repeat(500));
    await session.recover();
    assert.equal(session.connected, true);
    await session.close();
  });

  test('regression: reply only released when the next command runs (real Pip-Boy, 11:19 logs)', async () => {
    const port = createFakePipBoy({ holdOutputUntilNextCommand: true, silentPrompt: true, storage: { 'a.js': 'print(1)' }, sd: { '/x.txt': 'hello sd' } });
    const session = fast();
    await session.open(port);
    assert.equal(session.connected, true);
    assert.deepEqual(await ops.storageList(session), ['a.js']);
    const text = 'Nüklear ☢ '.repeat(40);
    await ops.storageWrite(session, 'b.js', ops.utf8(text), noDelay);
    assert.equal(port.state.storage.text('b.js'), text);
    assert.equal(new TextDecoder().decode(await ops.storageRead(session, 'b.js', noDelay)), text);
    await ops.sdList(session);
    assert.equal(Buffer.from(await ops.sdRead(session, '/x.txt', noDelay)).toString(), 'hello sd');
    await session.recover();
    assert.equal(session.connected, true);
    assert.equal(session.stats.staleFrames, 0);
    await session.close();
  });

  test('regression: one ~63-byte packet per executed line (real Pip-Boy, 11:26 logs)', { timeout: 30000 }, async () => {
    const port = createFakePipBoy({ packetPerLine: true, silentPrompt: true, storage: { 'a.js': 'print(1)' }, sd: { '/x.txt': 'hello sd' } });
    const session = fast();
    await session.open(port);
    assert.equal(session.connected, true);
    assert.deepEqual(await ops.storageList(session), ['a.js']);
    const text = 'Nüklear ☢ '.repeat(60); // several chunks, each reply spans many packets
    await ops.storageWrite(session, 'b.js', ops.utf8(text), noDelay);
    assert.equal(port.state.storage.text('b.js'), text);
    assert.equal(new TextDecoder().decode(await ops.storageRead(session, 'b.js', noDelay)), text);
    await ops.sdList(session);
    assert.equal(Buffer.from(await ops.sdRead(session, '/x.txt', noDelay)).toString(), 'hello sd');
    await session.recover();
    assert.equal(session.connected, true);
    await session.close();
  });

  test('regression: connects although the device still holds a half reply from earlier attempts', { timeout: 30000 }, async () => {
    const port = createFakePipBoy({ packetPerLine: true, silentPrompt: true });
    // Reproduce the 11:26 state of the previous build: board check + ONE release command.
    await port.open({});
    const reader = port.readable.getReader();
    const w = port.writable.getWriter();
    await w.write(new TextEncoder().encode(buildCommand('process.env.BOARD', { requestId: 'c8ec54f07d0da681', kind: 'board' }) + RELEASE_LINE));
    let seen = '';
    while (!seen.includes('"value":"PI')) seen += new TextDecoder().decode((await reader.read()).value);
    assert.match(seen, /"value":"PI$/, 'left a 63-byte half frame behind');
    reader.releaseLock();
    w.releaseLock();
    await port.close();

    const logs = [];
    const session = new SerialSession({ promptDelayMs: 5, writePauseMs: 0, releaseIntervalMs: 5, events: { log: (l, m) => logs.push(m) } });
    await session.open(port);
    assert.equal(session.connected, true);
    assert.ok(logs.some((m) => /release command\(s\) · \d+ stale frame\(s\) · reply received/.test(m)));
    await session.close();
  });

  test('regression: an old command left unexecuted by a previous page is discarded and explained', async () => {
    const port = createFakePipBoy({ holdLastTransfer: true, silentPrompt: true });
    // What the previous build left behind: a board check that was written but never flushed.
    await port.open({});
    const w = port.writable.getWriter();
    await w.write(new TextEncoder().encode('\x10print("< << "+JSON.stringify({requestId:"0ldc0ffee0000000",kind:"board",value:process.env.BOARD})+" >> >")\n'));
    w.releaseLock();
    await port.close();

    const logs = [];
    const session = new SerialSession({ promptDelayMs: 20, writePauseMs: 0, events: { log: (level, m) => logs.push({ level, m }) } });
    await session.open(port);
    assert.equal(session.connected, true);
    const stale = logs.find((l) => l.m.startsWith('Stale frame discarded'));
    assert.ok(stale, 'the leftover reply is reported');
    assert.match(stale.m, /got request 0ldc0ffee0000000 kind board/);
    assert.equal(stale.level, 'info', 'persisted to the server log');
    await session.close();
  });

  test('a reply that arrives after its timeout is reported as late', { timeout: 8000 }, async () => {
    const logs = [];
    let release;
    const port = createFakePipBoy({
      hooks: {
        beforeEval(code, { emit }) {
          if (code.includes('"slow"')) {
            const id = code.match(/requestId:"([0-9a-f]+)"/)[1];
            release = () => emit(`< << {"requestId":"${id}","kind":"value","value":"slow"} >> >\r\n>`);
            return false;
          }
          return true;
        },
      },
    });
    const session = new SerialSession({ promptDelayMs: 5, writePauseMs: 0, events: { log: (level, m) => logs.push({ level, m }) } });
    await session.open(port);
    await assert.rejects(session.transaction('"slow"', 'value', { timeout: 300 }), /timeout/);
    release();
    await new Promise((r) => setTimeout(r, 30));
    const late = logs.find((l) => l.m.startsWith('Late reply'));
    assert.ok(late, 'late reply logged');
    assert.equal(late.level, 'error');
    await session.close();
  });

  test('USB writes go out whole; the IDE slow-write option still splits them', async () => {
    const port = createFakePipBoy();
    const session = new SerialSession({ promptDelayMs: 5, probeOnConnect: false });
    await session.open(port);
    let before = port.state.writes;
    await session.command('1');
    assert.equal(port.state.writes - before, 1, 'command and its release lines in one write');
    await session.close();

    const slow = new SerialSession({ promptDelayMs: 5, writeChunk: 19, writePauseMs: 0, probeOnConnect: false });
    await slow.open(port);
    before = port.state.writes;
    await slow.command('1');
    assert.ok(port.state.writes - before >= Math.ceil(200 / 19), `expected many small writes, got ${port.state.writes - before}`);
    await slow.close();
  });

  test('wake probe picks timer mode only when device timers release output', { timeout: 60000 }, async () => {
    for (const timerWake of [false, true]) {
      const port = createFakePipBoy({ packetPerLine: true, silentPrompt: true, lineDelayMs: 2, timerWake, storage: { 'f.bin': 'z'.repeat(3000) } });
      const logs = [];
      const session = new SerialSession({ promptDelayMs: 5, releaseIntervalMs: 20, events: { log: (l, m) => logs.push({ l, m }) } });
      await session.open(port);
      assert.equal(session.wakeMode, timerWake ? 'timer' : 'release');
      assert.ok(logs.some((x) => x.m.startsWith('Wake probe:')));
      assert.ok(!logs.some((x) => x.l === 'error'), 'a failed probe is not an error');
      // Transfers work in both modes and the probe leaves nothing behind.
      assert.equal(Buffer.from(await ops.storageRead(session, 'f.bin')).toString(), 'z'.repeat(3000));
      assert.equal(session.stats.staleFrames, 0);
      await session.close();
    }
  });

  test('unplugging the cable cleans up the session', async () => {
    const { port, session } = await connected();
    port.unplug();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(session.port, null);
    assert.equal(session.connected, false);
    assert.match(session.disconnectReason, /lost|disconnected/i);
  });

  test('recover() sends Ctrl-C and re-verifies', async () => {
    const { port, session } = await connected();
    await session.recover();
    assert.equal(session.connected, true);
    assert.ok(port.state.sentBytes > 0);
    await session.close();
  });
});

describe('frame handling', () => {
  test('a frame from another request is discarded as stale', async () => {
    const { session } = await connected({
      hooks: {
        beforeEval(code, { emit }) {
          if (code.includes('"value"')) return true;
          // Inject an unrelated frame before every response.
          emit('< << {"requestId":"deadbeef","kind":"value","value":1} >> >\r\n');
          return true;
        },
      },
    });
    const value = await session.command('1+1');
    assert.equal(value, 2);
    assert.ok(session.stats.staleFrames >= 1);
    await session.close();
  });

  test('file contents containing the frame terminator are returned intact', async () => {
    const tricky = 'a >> > b < << c\n"quoted" > end';
    const { session } = await connected({ storage: { 'odd.txt': tricky } });
    const bytes = await ops.storageRead(session, 'odd.txt', noDelay);
    assert.equal(Buffer.from(bytes).toString('latin1'), tricky);
    const direct = await session.command('require("Storage").read("odd.txt")');
    assert.equal(direct, tricky);
    await session.close();
  });

  test('device exceptions reject the transaction with the device message', async () => {
    const { session } = await connected();
    await assert.rejects(session.command('require("nope")'), /Device exception: .*nope/);
    // The session stays usable.
    assert.equal(await session.command('2*21'), 42);
    await session.close();
  });

  test('the word MEMORY in file names does not trigger safe mode', async () => {
    const { session } = await connected({ sd: { '/MEMORY.TXT': 'x', '/low_memory_notes.txt': 'LOW_MEMORY is fine here' } });
    const names = await ops.sdList(session);
    assert.deepEqual(names.sort(), ['MEMORY.TXT', 'low_memory_notes.txt']);
    assert.equal(session.memoryLimited, false);
    const bytes = await ops.sdRead(session, '/low_memory_notes.txt', noDelay);
    assert.equal(Buffer.from(bytes).toString(), 'LOW_MEMORY is fine here');
    assert.equal(session.memoryLimited, false);
    await session.close();
  });

  test('a real interpreter LOW_MEMORY error enters safe mode and blocks commands', async () => {
    const { port, session } = await connected();
    port.state.lowMemoryNext = true;
    await assert.rejects(session.command('1'), /LOW_MEMORY/);
    assert.equal(session.memoryLimited, true);
    await assert.rejects(session.command('1'), /safe mode/);
    // Reconnecting clears safe mode.
    await session.close();
    await session.open(port);
    assert.equal(session.memoryLimited, false);
    await session.close();
  });

  test('a syntax error printed outside a frame fails the transaction instead of timing out', async () => {
    const { session } = await connected();
    const started = Date.now();
    await assert.rejects(session.command('1+'), /Device error: Uncaught|Device exception/);
    assert.ok(Date.now() - started < 2000);
    await session.close();
  });

  test('transactions are serialised', async () => {
    const { session } = await connected();
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => session.command(`${n}*10`)));
    assert.deepEqual(results, [10, 20, 30, 40, 50]);
    await session.close();
  });
});

describe('Storage (internal flash)', () => {
  test('storageList uses Storage.list, not the SD card', async () => {
    const { port, session } = await connected({ storage: { 'app.js': 'x', '.boot0': 'y' }, sd: { '/song.mp3': 'z' } });
    const names = await ops.storageList(session);
    assert.deepEqual(names.sort(), ['.boot0', 'app.js']);
    assert.ok(port.state.lines.some((l) => l.includes('require(\\"Storage\\").list()') || l.includes('require("Storage").list()')));
    await session.close();
  });

  test('regression: the original unsized chunked write fails on Espruino Storage', async () => {
    const { session } = await connected();
    // What the old dashboard sent: first chunk without a total size, then a second chunk at offset 192.
    await session.command('require("Storage").write("x.js","' + 'a'.repeat(192) + '",0)');
    await assert.rejects(session.command('require("Storage").write("x.js","bbb",192)'), /Too much data/);
    await session.close();
  });

  test('writes a file larger than one chunk and verifies it', async () => {
    const { port, session } = await connected();
    const text = 'console.log("hello");\n'.repeat(60); // ~1.3 KB, many chunks
    const result = await ops.storageWrite(session, 'hello.js', ops.utf8(text), noDelay);
    assert.equal(result.size, text.length);
    assert.equal(port.state.storage.text('hello.js'), text);
    await session.close();
  });

  test('preserves UTF-8 text byte-for-byte', async () => {
    const { port, session } = await connected();
    const text = JSON.stringify({ station: 'Radio Nüklear ☢', note: 'café — 日本' });
    await ops.storageWrite(session, 'companion-radio.json', ops.utf8(text), noDelay);
    assert.equal(port.state.storage.text('companion-radio.json'), text);
    const back = await ops.storageRead(session, 'companion-radio.json', noDelay);
    assert.equal(new TextDecoder().decode(back), text);
    await session.close();
  });

  test('round-trips binary data', async () => {
    const { session } = await connected();
    const bytes = new Uint8Array(1000).map((_, i) => (i * 37) & 0xff);
    await ops.storageWrite(session, 'blob.bin', bytes, noDelay);
    const back = await ops.storageRead(session, 'blob.bin', noDelay);
    assert.deepEqual([...back], [...bytes]);
    await session.close();
  });

  test('rejects unsafe names, empty and oversized files before touching the device', async () => {
    const { port, session } = await connected();
    const before = port.state.lines.length;
    await assert.rejects(ops.storageWrite(session, '../evil', ops.utf8('x')), /safe 1–28/);
    await assert.rejects(ops.storageWrite(session, 'a'.repeat(29), ops.utf8('x')), /safe 1–28/);
    await assert.rejects(ops.storageWrite(session, 'empty.txt', new Uint8Array(0)), /empty/);
    await assert.rejects(ops.storageWrite(session, 'big.bin', new Uint8Array(70_000)), /65 KB/);
    assert.equal(port.state.lines.length, before);
    await session.close();
  });

  test('delete erases and verifies', async () => {
    const { port, session } = await connected({ storage: { 'old.js': 'x' } });
    await ops.storageDelete(session, 'old.js');
    assert.equal(port.state.storage.read('old.js'), undefined);
    await session.close();
  });

  test('storageRead returns null for a missing file', async () => {
    const { session } = await connected();
    assert.equal(await ops.storageRead(session, 'missing.txt', noDelay), null);
    await session.close();
  });

  test('a rebuild refuses a device that reports no board name, before anything is erased', async () => {
    const { port, session } = await connected({ board: null, storage: { 'a.js': 'print(1)' } });
    await assert.rejects(ops.storageRebuild(session, [['a.js', new Uint8Array([1])]]), /didn.t report that it.s a Pip-Boy/);
    assert.equal(port.state.storage.read('a.js'), 'print(1)');
    await session.close();
  });

  test('lacksFirmware spots a backup without Pip-OS', () => {
    assert.equal(ops.lacksFirmware([['a.js', new Uint8Array(1)]]), true);
    assert.equal(ops.lacksFirmware([['a.js', new Uint8Array(1)], [ops.FIRMWARE_FILE, new Uint8Array(1)]]), false);
  });

  test('backup and restore round-trip all files, including binary', async () => {
    const source = { 'a.js': 'print(1)', 'b.json': '{"x":"ü"}', 'c.bin': '\x00\x01\xff\xfe>> >' };
    const { session } = await connected({ storage: source });
    const { backup, skipped } = await ops.storageBackup(session);
    assert.deepEqual(skipped, []);
    assert.equal(backup.version, 2);
    await session.close();

    const fresh = await connected();
    const entries = ops.parseStorageBackup(JSON.parse(JSON.stringify(backup)));
    await ops.storageRestore(fresh.session, entries);
    for (const [name, content] of Object.entries(source)) {
      assert.equal(fresh.port.state.storage.read(name), content, name);
    }
    await fresh.session.close();
  });

  test('parseStorageBackup accepts v1 byte-string backups and rejects bad input', () => {
    const v1 = { format: 'espruino-storage-backup', version: 1, files: { 'x.txt': 'hi\xff' } };
    const [[name, bytes]] = ops.parseStorageBackup(v1);
    assert.equal(name, 'x.txt');
    assert.deepEqual([...bytes], [104, 105, 255]);
    assert.throws(() => ops.parseStorageBackup({ format: 'nope', files: {} }), /Invalid/);
    assert.throws(() => ops.parseStorageBackup({ format: 'espruino-storage-backup', files: { '../x': 'a' } }), /safe/);
    assert.throws(() => ops.parseStorageBackup({ format: 'espruino-storage-backup', files: [] }), /Invalid/);
  });
});

describe('SD card', () => {
  test('SD operations require a verified SD card', async () => {
    const { session } = await connected({ sd: { '/a.txt': 'x' } });
    await assert.rejects(ops.sdRead(session, '/a.txt', noDelay), /SD not verified/);
    await ops.sdList(session);
    assert.equal(session.sdAvailable, true);
    await session.close();
  });

  test('uploads and downloads with chunk checksums', async () => {
    const { port, session } = await connected({ sd: {} });
    await ops.sdList(session);
    const bytes = new Uint8Array(1000).map((_, i) => (i * 13 + 7) & 0xff);
    await ops.sdWrite(session, '/data.bin', bytes, noDelay);
    assert.equal(port.state.sd.files.get('/data.bin').length, 1000);
    const back = await ops.sdRead(session, '/data.bin', noDelay);
    assert.deepEqual([...back], [...bytes]);
    await session.close();
  });

  test('rejects traversal in SD paths', async () => {
    const { session } = await connected({ sd: {} });
    await ops.sdList(session);
    await assert.rejects(ops.sdRead(session, '/../etc/passwd', noDelay), /no \.\./);
    await assert.rejects(ops.sdRead(session, 'relative.txt', noDelay), /absolute/);
    await session.close();
  });

  test('a failing read still closes the handle and keeps the original error', async () => {
    const { port, session } = await connected({ sd: { '/a.txt': 'hello world' } });
    await ops.sdList(session);
    // The file reports 11 bytes but the handle returns nothing: an unexpected end of file.
    port.state.sd.open = () => ({ read: () => undefined, close() {} });
    await assert.rejects(ops.sdRead(session, '/a.txt', noDelay), /Unexpected end of SD file/);
    assert.ok(port.state.lines.some((l) => l.includes('__pbRead.close()')), 'handle closed');
    await session.close();
  });
});

describe('SD folders and full dump', () => {
  const sd = {
    '/readme.txt': 'hello',
    '/MUSIC/Track 01.wav': 'RIFF0001',
    '/MUSIC/Live Set/b.wav': 'BBB',
    '/VIDEO/big.avi': 'v'.repeat(3000),
  };

  test('lists folders, walks the tree, makes and deletes entries', async () => {
    const { port, session } = await connected({ sd, sdDirs: ['/EMPTY'] });
    const root = await ops.sdListDir(session, '/');
    assert.deepEqual(root.map((e) => `${e.name}${e.dir ? '/' : ''}`), ['EMPTY/', 'MUSIC/', 'VIDEO/', 'readme.txt']);
    const music = await ops.sdListDir(session, '/MUSIC');
    assert.deepEqual(music.map((e) => e.path), ['/MUSIC/Live Set', '/MUSIC/Track 01.wav']);
    assert.equal(music[1].size, 8);

    const { entries, truncated } = await ops.sdWalk(session, '/');
    assert.equal(truncated, false);
    assert.ok(entries.some((e) => e.path === '/MUSIC/Live Set/b.wav'));
    const limited = await ops.sdWalk(session, '/', { maxEntries: 3 });
    assert.equal(limited.truncated, true);
    assert.equal(limited.entries.length, 3);

    await ops.sdMkdir(session, '/SAVES');
    assert.ok(port.state.sd.statSync('/SAVES').dir);
    await ops.sdDelete(session, '/readme.txt');
    assert.throws(() => port.state.sd.statSync('/readme.txt'));
    await assert.rejects(ops.sdRead(session, '/MUSIC'), /is a folder/);
    assert.equal(Buffer.from(await ops.sdRead(session, '/MUSIC/Live Set/b.wav')).toString(), 'BBB');
    await session.close();
  });

  test('dumpDevice saves Storage byte-exactly, SD under the limit, info and manifest (packet model)', { timeout: 60000 }, async () => {
    const port = createFakePipBoy({
      packetPerLine: true, silentPrompt: true, sd,
      storage: { 'app.js': 'Pip.radioOn()', '.boot0': 'boot', 'log\u0001': '\x00\xff>> >' },
    });
    const session = fast();
    await session.open(port);
    const saved = new Map();
    const manifest = await ops.dumpDevice(session, {
      sdMaxFileBytes: 1000,
      save: async (rel, bytes) => saved.set(rel, Buffer.from(bytes)),
    });
    assert.deepEqual([...saved.keys()].slice(-1), ['manifest.json'], 'manifest written last');
    assert.equal(saved.get('storage/log%01').toString('latin1'), '\x00\xff>> >');
    assert.equal(saved.get('storage/%2Eboot0').toString(), 'boot');
    assert.equal(saved.get('sd/MUSIC/Live Set/b.wav').toString(), 'BBB');
    assert.ok(!saved.has('sd/VIDEO/big.avi'));
    assert.match(manifest.sd.entries.find((e) => e.path === '/VIDEO/big.avi').skipped, /larger than 1000/);
    assert.equal(manifest.device.env.BOARD, 'PIPBOY');
    for (const m of ['audioStart', 'audioStop', 'radioOn', 'remove', 'setVolume', 'kickIdleTimer', 'powerButtonHandler']) {
      assert.ok(manifest.device.globalShapes.Pip.own.includes(m), m);
    }
    assert.deepEqual(manifest.device.globalShapes.BIG_TABLE, { type: 'object', length: 5000 });
    assert.deepEqual(manifest.device.globalShapes.Graphics.proto, ['drawString', 'setColor', 'flip']);
    assert.deepEqual(manifest.errors, []);
    const device = JSON.parse(saved.get('device.json'));
    assert.equal(device.version, '2v24.99');
    await session.close();
  });

  /** Cap every transaction timeout so timeout paths run fast in tests. */
  const quickTimeouts = (session, ms = 400) => {
    const orig = session.transaction.bind(session);
    session.transaction = (e, k, o = {}) => orig(e, k, { ...o, timeout: Math.min(o.timeout ?? ms, ms) });
  };

  test('regression (12:36 real dump): a device that goes silent aborts quickly, keeps a partial manifest, and resumes', { timeout: 60000 }, async () => {
    const files = { '/A/1.wav': 'one', '/A/2.wav': 'two', '/A/3.wav': 'three', '/B/4.wav': 'four', '/B/5.wav': 'five', '/B/6.wav': 'six' };
    let reads = 0;
    const port = createFakePipBoy({
      sd: files,
      storage: { 'app.js': 'x' },
      hooks: {
        beforeEval(code, { state }) {
          if (code.includes('E.openFile') && ++reads === 3) state.respond = false; // goes silent on the 3rd file
          return true;
        },
      },
    });
    const logs = [];
    const session = new SerialSession({ promptDelayMs: 5, writePauseMs: 0, releaseIntervalMs: 5, events: { log: (l, m) => logs.push({ l, m }) } });
    await session.open(port);
    quickTimeouts(session);
    const saved = new Map();
    const save = async (rel, bytes) => saved.set(rel, Buffer.from(bytes));
    const t0 = Date.now();
    await assert.rejects(ops.dumpDevice(session, { save, onEvent: (l, m) => logs.push({ l, m }) }), (e) => e instanceof ops.DeviceSilentError);
    assert.ok(Date.now() - t0 < 8000, `aborted in ${Date.now() - t0} ms instead of timing out file after file`);
    const partial = JSON.parse(saved.get('manifest.json'));
    assert.equal(partial.complete, false);
    assert.match(partial.aborted, /stopped answering/);
    assert.equal(partial.sd.entries.filter((e) => e.file).length, 2);
    assert.ok(logs.some((x) => x.l === 'error' && /Dump: timeout on .* raw tail/.test(x.m)), 'diagnostics logged');
    await session.close();

    // Reconnect (device answers again) and resume: only the missing files are read.
    port.state.respond = true;
    reads = -1000;
    const s2 = fast();
    await s2.open(port);
    const before = new Set(saved.keys());
    saved.clear();
    const done = await ops.dumpDevice(s2, { save, previous: partial });
    assert.equal(done.complete, true);
    assert.equal(done.resumed, 1);
    assert.equal(done.sd.entries.filter((e) => e.file).length, 6);
    const reread = [...saved.keys()].filter((k) => k.startsWith('sd/'));
    assert.deepEqual(reread.sort(), ['sd/A/3.wav', 'sd/B/4.wav', 'sd/B/5.wav', 'sd/B/6.wav']);
    assert.ok(!saved.has('device.json') && before.has('device.json'), 'device info reused');
    assert.ok(!saved.has('storage/app.js'), 'Storage reused');
    await s2.close();
  });

  test('a one-off timeout is retried when the device is still answering', { timeout: 30000 }, async () => {
    let dropped = false;
    const port = createFakePipBoy({
      sd: { '/x.txt': 'payload' },
      hooks: {
        beforeEval(code) {
          if (!dropped && code.includes('__pbRead.read(')) {
            dropped = true;
            return false; // swallow the first chunk read once
          }
          return true;
        },
      },
    });
    const session = fast();
    await session.open(port);
    quickTimeouts(session);
    const saved = new Map();
    const m = await ops.dumpDevice(session, { save: async (rel, b) => saved.set(rel, Buffer.from(b)) });
    assert.equal(m.complete, true);
    assert.equal(saved.get('sd/x.txt').toString(), 'payload');
    assert.deepEqual(m.errors, []);
    await session.close();
  });

  test('OS metadata on the card is skipped and recorded', async () => {
    const { session } = await connected({
      sd: { '/.DS_Store': 'mac', '/._FW.JS': 'appledouble', '/System Volume Information/IndexerVolumeGuid': 'win', '/FW.JS': 'code' },
    });
    const saved = [];
    const m = await ops.dumpDevice(session, { save: async (rel) => saved.push(rel) });
    assert.ok(saved.includes('sd/FW.JS'));
    assert.ok(!saved.some((p) => /DS_Store|\._FW|System Volume/.test(p)));
    assert.deepEqual(m.sd.osJunkSkipped.sort(), ['/.DS_Store', '/._FW.JS', '/System Volume Information']);
    assert.equal(ops.isOsJunk('MUSIC'), false);
    await session.close();
  });

  test('a dump without an SD card still completes and records the error', async () => {
    const { session } = await connected({ storage: { 'a.js': '1' } });
    session.transaction = ((orig) => (e, k, o) => (k === 'sd' ? Promise.reject(new Error('Device exception: Error: Unable to mount media : NO_FILESYSTEM')) : orig(e, k, o)))(session.transaction.bind(session));
    const saved = [];
    const manifest = await ops.dumpDevice(session, { save: async (rel) => saved.push(rel) });
    assert.ok(saved.includes('storage/a.js'));
    assert.match(manifest.sd.error, /NO_FILESYSTEM/);
    assert.equal(manifest.errors.length, 1);
    await session.close();
  });

  test('cancelling a dump stops it and leaves a partial (resumable) manifest', async () => {
    const { session } = await connected({ storage: { 'a.js': '1', 'b.js': '2', 'c.js': '3' } });
    const saved = new Map();
    const result = await session.run('dump', () =>
      ops.dumpDevice(session, {
        save: async (rel, bytes) => {
          saved.set(rel, Buffer.from(bytes));
          if (rel.startsWith('storage/')) session.requestCancel();
        },
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.row.status, 'cancelled');
    const m = JSON.parse(saved.get('manifest.json'));
    assert.equal(m.complete, false);
    assert.match(m.aborted, /cancelled/i);
    assert.equal(m.storage.filter((f) => f.file).length, 1);
    await session.close();
  });
});

describe('Pip-Boy sleep (13:21 logs)', () => {
  const opts = (extra = {}) => ({ promptDelayMs: 5, writePauseMs: 0, releaseIntervalMs: 5, ...extra });

  test('keep-alive stops an idle connected Pip-Boy from falling asleep', { timeout: 10000 }, async () => {
    const port = createFakePipBoy({ idleTimeoutMs: 300 });
    const session = new SerialSession(opts({ keepAwakeMs: 100 }));
    await session.open(port);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(port.state.asleep, undefined, 'never slept');
    assert.ok(port.state.kicks >= 4, `idle timer kicked ${port.state.kicks} times`);
    await session.close();
  });

  test('a long transfer keeps it awake too (idle-timer reset piggybacked on commands)', { timeout: 20000 }, async () => {
    const port = createFakePipBoy({ idleTimeoutMs: 300, lineDelayMs: 3, storage: { 'big.bin': 'q'.repeat(40_000) } });
    const session = new SerialSession(opts({ keepAwakeMs: 100 }));
    await session.open(port);
    const t0 = Date.now();
    const bytes = await ops.storageRead(session, 'big.bin');
    assert.ok(Date.now() - t0 > 300, 'transfer outlasted the idle timeout');
    assert.equal(bytes.length, 40_000);
    assert.equal(port.state.asleep, undefined);
    await session.close();
  });

  test('without keep-alive it sleeps; the state is reported; Wake only acts when asleep', { timeout: 15000 }, async () => {
    const port = createFakePipBoy({ idleTimeoutMs: 1000, silentPrompt: true });
    const logs = [];
    const session = new SerialSession(opts({ keepAwake: false, probeOnConnect: false, events: { log: (l, m) => logs.push({ l, m }) } }));
    await session.open(port);
    assert.equal((await session.readPipState()).sleeping, false);
    assert.equal(await session.wake(), 'not asleep (false)');
    assert.equal(port.state.switchedOff, undefined, 'Wake must never press "power" on an awake Pip-Boy');

    await new Promise((r) => setTimeout(r, 1300));
    assert.equal(port.state.asleep, true);
    const asleep = await session.readPipState(); // still answers, via release commands
    assert.equal(asleep.sleeping, true);
    assert.equal(asleep.usbPower, true);
    assert.equal(asleep.idleTimeout, 1000);
    assert.ok(logs.some((x) => x.l === 'error' && /sleeping=true.*Wake Pip-Boy/.test(x.m)));

    assert.equal(await session.wake(), 'waking');
    assert.equal(port.state.asleep, false);
    assert.equal(port.state.switchedOff, undefined);
    await session.close();
  });

  test('connect reports a Pip-Boy that is already asleep and still verifies it', { timeout: 15000 }, async () => {
    const port = createFakePipBoy({ idleTimeoutMs: 50, silentPrompt: true });
    await new Promise((r) => setTimeout(r, 150)); // fell asleep before we connected
    const session = new SerialSession(opts());
    await session.open(port);
    assert.equal(session.connected, true);
    assert.equal(session.pipState.sleeping, true);
    assert.equal(session.wakeMode, 'release', 'probe correctly finds timers do not help while asleep');
    await session.close();
  });
});

describe('operations', () => {
  test('run() records one terminal outcome per operation', async () => {
    const { session } = await connected({ storage: { 'a.js': '1' } });
    const ok = await session.run('File listing', () => ops.storageList(session));
    assert.equal(ok.ok, true);
    assert.equal(ok.row.status, 'verified');
    assert.equal(ok.row.next, 'continue');
    const bad = await session.run('Read missing', async () => {
      throw new Error('File not found');
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.row.status, 'failed');
    assert.equal(session.history.length, 2);
    await session.close();
  });

  test('run() refuses to start before the board is verified', async () => {
    const session = fast();
    await assert.rejects(session.run('x', async () => {}), /Verify the Espruino REPL first/);
  });

  test('cancellation stops a multi-chunk write at a chunk boundary', async () => {
    const { session } = await connected();
    const result = await session.run('Write', () =>
      ops.storageWrite(session, 'big.js', new Uint8Array(5000).fill(65), {
        chunkDelayMs: 0,
        onProgress: (p) => {
          if (p > 0.2) session.requestCancel();
        },
      }),
    );
    assert.equal(result.ok, false);
    assert.equal(result.row.status, 'cancelled');
    await session.close();
  });

  test('classify maps errors to agent outcomes', () => {
    const c = (msg, extra = {}) => SerialSession.classify(new Error(msg), { memoryLimited: false, portOpen: true, ...extra }).status;
    assert.equal(c('REPL transaction timeout'), 'timeout');
    assert.equal(c('x', { portOpen: false }), 'disconnected');
    assert.equal(c('x', { memoryLimited: true }), 'low-memory-safe-mode');
    assert.equal(c('Operation cancelled'), 'cancelled');
    assert.equal(c('No verified REPL connection'), 'unavailable');
    assert.equal(c('Outbound write failed; outcome uncertain'), 'uncertain-write');
    assert.equal(c('Deletion not verified'), 'unavailable');
    assert.equal(c('Size mismatch'), 'failed');
  });
});
