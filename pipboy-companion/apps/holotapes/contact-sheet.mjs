#!/usr/bin/env node
// Screenshots of every holotape in the emulator, in one PNG for reviewing the layout:
//
//   node apps/holotapes/contact-sheet.mjs [out.png]
//
// Each holotape runs on the starter Pip-Boy (emulator/starter), as the emulator page's Run button
// runs it. Four screens each: as it opens, then after a few turns and presses of the wheel.
// The PNG goes next to this file as contact-sheet.png unless given. Exits 1 on an error.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Espruino } from '../../emulator/runtime/espruino.js';
import { BOARDS } from '../../emulator/runtime/boards.js';
import { MemFS } from '../../emulator/runtime/memfs.js';
import { loadDumpSd, loadDumpStorage } from '../../emulator/runtime/dump.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', '..');
const out = process.argv[2] ?? path.join(HERE, 'contact-sheet.png');
const COLS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const index = JSON.parse(await readFile(path.join(ROOT, 'apps/index.json'), 'utf8'));
const starter = path.join(ROOT, 'emulator/starter');
const manifest = JSON.parse(await readFile(path.join(starter, 'manifest.json'), 'utf8'));
const rd = (rel) => readFile(path.join(starter, ...rel.split('/')));
const fs = new MemFS();
await loadDumpSd(manifest, rd, fs);
// the holotapes as they are now in apps/, not the starter's copy
for (const h of index.holotapes) for (const f of h.files) fs.writeFile('/' + f.path, await readFile(path.join(ROOT, 'apps', f.file)));

let console_ = '';
const emu = await Espruino.start({ board: BOARDS.pipboy, wasm: await readFile(path.join(ROOT, 'emulator/dist/pipboy_wasm.wasm')), fs, onOutput: (t) => { console_ += t; } });
await loadDumpStorage(manifest, rd, emu);
await sleep(1500);

const { width: W, height: H } = emu.lcd;
const shots = [];
const shot = async () => { await sleep(350); shots.push(Uint16Array.from(emu.pixels)); };
const press = async () => { emu.setButton('BTN7', true); await sleep(80); emu.setButton('BTN7', false); await sleep(120); };
const turn = async (n) => { for (let i = 0; i < Math.abs(n); i++) { emu.turnEncoder('knob1', Math.sign(n)); await sleep(60); } };

for (const h of index.holotapes) {
  const file = h.files.find((f) => /^USER\/[^/]+\.JS$/.test(f.path)).path.slice(5);
  emu.write(`\x10runHolotape(${JSON.stringify(file)})\n`);
  await shot();
  await press(); await turn(2); await press();
  await shot();
  await turn(3); await press(); await turn(1); await press();
  await shot();
  await turn(2); await press(); await press();
  await shot();
}
emu.stop();

// Lay the screenshots out in a grid and encode an RGB PNG
const rows = Math.ceil(shots.length / COLS);
const sheetW = W * COLS, sheetH = H * rows;
const raw = Buffer.alloc((sheetW * 3 + 1) * sheetH);
shots.forEach((px, k) => {
  const ox = (k % COLS) * W, oy = Math.floor(k / COLS) * H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = px[y * W + x], o = (oy + y) * (sheetW * 3 + 1) + 1 + (ox + x) * 3;
      raw[o] = ((c >> 11) * 527 + 23) >> 6;
      raw[o + 1] = (((c >> 5) & 0x3f) * 259 + 33) >> 6;
      raw[o + 2] = ((c & 0x1f) * 527 + 23) >> 6;
    }
  }
});
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(sheetW, 0); ihdr.writeUInt32BE(sheetH, 4);
ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
await writeFile(out, Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
]));
const errors = console_.match(/ERROR:.*|Uncaught.*/g);
console.log(`${shots.length} screens -> ${out}${errors ? `\nErrors:\n${errors.join('\n')}` : ''}`);
process.exit(errors ? 1 : 0);
