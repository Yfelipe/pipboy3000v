// Unit tests for the parts of the runtime that don't need a firmware build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MemFS } from '../runtime/memfs.js';
import { rgb565ToRgba } from '../runtime/espruino.js';
import { loadDumpSd } from '../runtime/dump.js';

test('MemFS: files, directories and paths that try to escape', () => {
  const fs = new MemFS();
  fs.writeFile('/a/b/c.txt', 'hi');
  assert.deepEqual(fs.readdir('/a/b'), ['c.txt']);
  assert.equal(new TextDecoder().decode(fs.readFile('a/b/c.txt')), 'hi');
  assert.equal(fs.lookup('/a/../a/b'), null);
  assert.deepEqual([...fs.walk('/')].map(([p]) => p), ['/a/b/c.txt']);
  fs.remove('/a/b/c.txt');
  assert.equal(fs.exists('/a/b/c.txt'), false);
  assert.throws(() => fs.mkdirp('/x/../y'));
});

test('rgb565ToRgba converts a rectangle in place', () => {
  const pixels = new Uint16Array([0xf800, 0x07e0, 0x001f, 0xffff]);
  const rgba = new Uint8ClampedArray(16);
  rgb565ToRgba(pixels, 2, { x1: 1, y1: 0, x2: 1, y2: 1 }, rgba);
  assert.deepEqual([...rgba.slice(4, 8)], [0, 255, 0, 255]);
  assert.deepEqual([...rgba.slice(12, 16)], [255, 255, 255, 255]);
  assert.deepEqual([...rgba.slice(0, 4)], [0, 0, 0, 0], 'outside the rectangle is untouched');
});

test('loadDumpSd copies files and directories and reports what the dump skipped', async () => {
  const manifest = {
    sd: {
      entries: [
        { path: '/UI', dir: true },
        { path: '/EMPTY', dir: true },
        { path: '/UI/OK.wav', file: 'sd/UI/OK.wav', size: 3 },
        { path: '/BOOT/BOOT.avi', size: 3e6, skipped: 'larger than 262144 bytes' },
      ],
    },
  };
  const fs = new MemFS();
  const result = await loadDumpSd(manifest, async (rel) => new TextEncoder().encode(rel), fs);
  assert.deepEqual(result, { files: 1, skipped: ['/BOOT/BOOT.avi'] });
  assert.equal(new TextDecoder().decode(fs.readFile('/UI/OK.wav')), 'sd/UI/OK.wav');
  assert.deepEqual(fs.readdir('/EMPTY'), []);
});

test('Terminal handles the line editing Espruino sends', async () => {
  globalThis.requestAnimationFrame ??= (fn) => setTimeout(fn, 0);
  const { Terminal } = await import('../web/terminal.js');
  const element = { textContent: '', scrollTop: 0, clientHeight: 0, scrollHeight: 0, addEventListener() {} };
  const term = new Terminal(element, () => {});
  term.write('\x1b[?7l>1+1\r\n=2\r\n>abc\x08\x08\x1b[');
  term.write('J'); // escape sequence split across writes
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(element.textContent, '>1+1\n=2\n>a');
});
