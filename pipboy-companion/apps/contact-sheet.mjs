#!/usr/bin/env node
// Render every page of a Pip-Boy app in the emulator, with the first and the last list item
// selected, into one PNG for reviewing the layout:
//
//   node apps/contact-sheet.mjs <app>.min.js <pages per tab> [out.png]
//   node apps/contact-sheet.mjs apps/mojave/mojave.min.js 3,4,4,1,1
//
// <pages per tab> is how many thumbwheel pages each mode-dial tab has. The PNG goes next to
// the app as contact-sheet.png unless given. Exits 1 if the app printed an error.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { Espruino } from '../emulator/runtime/espruino.js';
import { BOARDS } from '../emulator/runtime/boards.js';
import { MemFS } from '../emulator/runtime/memfs.js';
import { loadDumpSd } from '../emulator/runtime/dump.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [appFile, pagesArg, outArg] = process.argv.slice(2);
if (!appFile || !pagesArg) {
  console.error('Usage: node apps/contact-sheet.mjs <app>.min.js <pages per tab, e.g. 3,4,4,1,1> [out.png]');
  process.exit(2);
}
const PAGES = pagesArg.split(',').map(Number);
const out = outArg ?? path.join(path.dirname(appFile), 'contact-sheet.png');
const storageName = path.basename(appFile);
const COLS = 4;

/** The SD card from the newest dump in data/dumps, if any, so apps can play its videos. */
async function sdCard() {
  const fs = new MemFS();
  const dumps = path.join(HERE, '..', 'data', 'dumps');
  const ids = (await readdir(dumps).catch(() => [])).sort().reverse();
  for (const id of ids) {
    try {
      const manifest = JSON.parse(await readFile(path.join(dumps, id, 'manifest.json'), 'utf8'));
      await loadDumpSd(manifest, (rel) => readFile(path.join(dumps, id, ...rel.split('/'))), fs);
      break;
    } catch {}
  }
  return fs;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let console_ = '';
const emu = await Espruino.start({
  board: BOARDS.pipboy,
  wasm: await readFile(path.join(HERE, '../emulator/dist/pipboy_wasm.wasm')),
  fs: await sdCard(),
  onOutput: (t) => { console_ += t; },
});
emu.storageWrite(storageName, await readFile(appFile));
emu.write(`load(${JSON.stringify(storageName)})\n`);
await sleep(2500); // the app's boot screen

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
