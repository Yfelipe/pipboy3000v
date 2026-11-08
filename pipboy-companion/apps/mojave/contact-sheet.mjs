#!/usr/bin/env node
// Render every page of the Mojave UI in the emulator, with the first and the last list item
// selected, into one PNG for reviewing the layout:
//
//   node apps/mojave/contact-sheet.mjs [out.png]      (default: apps/mojave/contact-sheet.png)
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Espruino } from '../../emulator/runtime/espruino.js';
import { BOARDS } from '../../emulator/runtime/boards.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] ?? path.join(HERE, 'contact-sheet.png');
const PAGES = [3, 4, 4, 1, 1]; // sub-pages per tab: STAT, INV, DATA, MAP, RADIO
const COLS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let console_ = '';
const emu = await Espruino.start({
  board: BOARDS.pipboy,
  wasm: await readFile(path.join(HERE, '../../emulator/dist/pipboy_wasm.wasm')),
  onOutput: (t) => { console_ += t; },
});
emu.storageWrite('mojave.min.js', await readFile(path.join(HERE, 'mojave.min.js')));
emu.write('load("mojave.min.js")\n');
await sleep(2200); // boot text

const { width: W, height: H } = emu.lcd;
const shots = [];
const shot = () => shots.push(Uint16Array.from(emu.pixels));

for (let tab = 0; tab < PAGES.length; tab++) {
  emu.setSelector('mode', tab);
  await sleep(400);
  for (let page = 0; page < PAGES[tab]; page++) {
    await sleep(250);
    shot();
    for (let i = 0; i < 12; i++) { emu.turnEncoder('knob1', 1); await sleep(30); } // to the last item
    await sleep(300);
    shot();
    if (PAGES[tab] > 1) emu.turnEncoder('knob2', 1);
  }
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
