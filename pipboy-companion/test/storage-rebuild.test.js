// Storage clean-up against the real Pip-Boy firmware build (emulator/dist/pipboy_wasm.wasm),
// connected through the same SerialSession the dashboard uses. The emulator's Storage is one
// 128 KB page with the device's stack limit, so deleted files can't be compacted - as on the
// Pip-Boy - and only erasing and rewriting Storage gets their space back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialSession } from '../public/js/serial/session.js';
import * as ops from '../public/js/serial/device-ops.js';
import { Espruino } from '../emulator/runtime/espruino.js';
import { BOARDS } from '../emulator/runtime/boards.js';
import { serialPort } from '../emulator/runtime/serial-port.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('Clean up Storage reclaims deleted space on the single-page Pip-Boy Storage', async () => {
  const emu = await Espruino.start({ board: BOARDS.pipboy, wasm: await readFile(path.join(ROOT, 'emulator/dist/pipboy_wasm.wasm')) });
  // Stand-in firmware: ~100 KB of boot code, like the real .bootcde (103 KB)
  const firmware = `var booted=(global.booted|0)+1;/*${'x'.repeat(100_000)}*/`;
  emu.storageWrite('.bootcde', firmware);
  emu.storageWrite('VERSION', '1.20');
  emu.reboot();

  const session = new SerialSession({ promptDelayMs: 20, writePauseMs: 0, releaseIntervalMs: 5, probeOnConnect: false, keepAwake: false, resetDelayMs: 200 });
  await session.open(serialPort(emu));
  const app = new TextEncoder().encode(`var app=1;/*${'a'.repeat(18_000)}*/`);
  const app2 = new TextEncoder().encode(`var app=2;/*${'b'.repeat(18_500)}*/`);

  // Install, delete, install a slightly bigger version: the deleted copy's space is still in use
  await ops.storageWrite(session, 'app.min.js', app);
  await ops.storageDelete(session, 'app.min.js');
  await assert.rejects(ops.storageWrite(session, 'app.min.js', app2), /Unable to find or create file/);
  const before = await session.command('require("Storage").getStats()');
  assert.ok(before.trashBytes > 18_000, JSON.stringify(before));

  // Clean up: fresh backup + the new app, erase, rewrite
  const { backup, skipped } = await ops.storageBackup(session);
  assert.deepEqual(skipped, []);
  const entries = [...ops.parseStorageBackup(backup), ['app.min.js', app2]];
  const phases = [];
  const after = await ops.storageRebuild(session, entries, { onPhase: (p) => phases.push(p) });
  assert.equal(after.trashBytes, 0);
  assert.ok(after.freeBytes > 9_000, JSON.stringify(after));
  assert.match(phases.join(' | '), /reset.*Erasing.*Writing \.bootcde.*Writing app\.min\.js.*Writing VERSION/);
  assert.deepEqual((await session.command('require("Storage").list()')).sort(), ['.bootcde', 'VERSION', 'app.min.js']);
  assert.equal(await session.command('require("Storage").read("app.min.js").length'), app2.length);
  // The firmware is back and boots
  await session.send('\x10E.reboot();\n');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await session.command('booted'), 1);

  await session.close();
  emu.stop();
});

test('storageRebuild refuses work that would not fit or would leave Storage empty', async () => {
  const session = { command: async () => ({ totalBytes: 131072 }) };
  await assert.rejects(ops.storageRebuild(session, []), /refusing to leave Storage empty/);
  await assert.rejects(ops.storageRebuild(session, [['big', new Uint8Array(131_072)]]), /need .* bytes but Storage holds/);
  await assert.rejects(ops.storageRebuild(session, [['a', new Uint8Array(1)], ['a', new Uint8Array(1)]]), /Duplicate/);
});

test('whole-file verification runs natively on the device (a JS loop trips the watchdog)', async () => {
  const { expr } = await import('../public/js/serial/protocol.js');
  const { crc32 } = await import('../shared/validate.js');
  const v = expr.storageVerify('.bootcde', 16384, 16384);
  assert.match(v, /E\.CRC32/);
  assert.match(v, /kickWatchdog/);
  assert.match(v, /read\("\.bootcde",16384,16384\)/);
  assert.doesNotMatch(v, /for\(/);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926); // the standard check value
});

test('Pip-OS 1.33 firmware (Espruino 2v29): bigger write chunks reach Storage and the SD card intact', async () => {
  const emu = await Espruino.start({ board: BOARDS.pipboy, wasm: await readFile(path.join(ROOT, 'emulator/dist/pipboy_wasm.wasm')) });
  const session = new SerialSession({ promptDelayMs: 20, writePauseMs: 0, releaseIntervalMs: 5, probeOnConnect: false, keepAwake: false });
  await session.open(serialPort(emu));
  const version = await session.command('process.env.VERSION');
  assert.ok(ops.versionAtLeast(version, 2, 29), version);
  assert.equal(ops.versionAtLeast('2v24.449', 2, 29), false);
  session.writeChunkBytes = ops.FAST_WRITE_CHUNK;
  const bytes = new Uint8Array(5000).map((_, i) => (i * 37) & 0xff); // every byte value, binary
  await ops.storageWrite(session, 'blob.bin', bytes);
  assert.deepEqual(await ops.storageRead(session, 'blob.bin'), bytes);
  session.sdAvailable = true;
  await ops.sdWrite(session, '/blob.bin', bytes);
  assert.deepEqual(await ops.sdRead(session, '/blob.bin'), bytes);
  await session.close();
  emu.stop();
});
