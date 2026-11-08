#!/usr/bin/env node
// Run an emulated board in the terminal: an Espruino REPL on stdin/stdout.
//
//   node emulator/cli.js                                  generic Espruino board
//   node emulator/cli.js app.js                           ...and send app.js to RAM after boot
//   node emulator/cli.js --board pipboy --dump data/dumps/<id> [--sd /path/to/sdcard]
//   node emulator/cli.js --save app.js                    write app.js as .bootcde and reboot into it
//   node emulator/cli.js --board pipboy --dump <dir> --app apps/mojave/mojave.min.js
//                                                         write it to Storage and load() it, keeping the firmware
//
// Ctrl-C is passed to Espruino (interrupts running code); press Ctrl-] to quit.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Espruino } from './runtime/espruino.js';
import { MemFS } from './runtime/memfs.js';
import { BOARDS } from './runtime/boards.js';
import { loadDumpSd, loadDumpStorage } from './runtime/dump.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUIT = 0x1d; // Ctrl-]

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    board: { type: 'string', default: 'espruino' },
    dump: { type: 'string' },
    sd: { type: 'string' },
    save: { type: 'boolean', default: false },
    app: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
});

if (opts.help) {
  console.log(`Usage: node emulator/cli.js [--board ${Object.keys(BOARDS).join('|')}] [--dump DIR] [--sd DIR] [--save] [--app file.js] [program.js]`);
  process.exit(0);
}

const board = BOARDS[opts.board];
if (!board) throw new Error(`Unknown board "${opts.board}" (${Object.keys(BOARDS).join(', ')})`);

/** Copy a folder on this computer into the emulated SD card. */
async function copyFolder(dir, fs, at = '/') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const src = path.join(dir, entry.name);
    const dst = path.posix.join(at, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirp(dst);
      await copyFolder(src, fs, dst);
    } else if (entry.isFile()) {
      fs.writeFile(dst, await readFile(src));
    }
  }
}

const fs = new MemFS();
let manifest = null;
const readDumpFile = (rel) => readFile(path.join(opts.dump, ...rel.split('/')));
if (opts.dump) {
  manifest = JSON.parse(await readFile(path.join(opts.dump, 'manifest.json'), 'utf8'));
  const { skipped } = await loadDumpSd(manifest, readDumpFile, fs);
  if (skipped.length && !opts.sd) {
    console.error(`(${skipped.length} large SD files were not in the dump; pass --sd with a copy of the card to add them)`);
  }
}
if (opts.sd) await copyFolder(opts.sd, fs);

const emu = await Espruino.start({
  board,
  wasm: await readFile(path.join(HERE, 'dist', board.wasm)),
  fs,
  onOutput: (text) => process.stdout.write(text),
  onLog: (text) => process.stderr.write(text),
});
if (manifest) await loadDumpStorage(manifest, readDumpFile, emu);

const program = positionals[0];
if (program) {
  const code = await readFile(program, 'utf8');
  if (opts.save) {
    emu.storageWrite('.bootcde', code);
    emu.reboot();
  } else {
    // As the Web IDE's "send to RAM": Ctrl-P (0x10) before a line turns echo off for it
    emu.write('\x10' + code.replace(/\n/g, '\n\x10') + '\n');
  }
}

if (opts.app) {
  const name = path.basename(opts.app);
  emu.storageWrite(name, await readFile(opts.app));
  emu.write(`load(${JSON.stringify(name)})\n`);
}

if (process.stdin.isTTY) process.stdin.setRawMode(true);
process.stdin.on('data', (data) => {
  if (data.includes(QUIT)) {
    emu.stop();
    process.stdout.write('\n');
    process.exit(0);
  }
  emu.write(data.toString('utf8'));
});
process.stdin.on('end', () => {
  // Piped input finished: give pending timers a moment, then exit
  setTimeout(() => {
    emu.stop();
    process.exit(0);
  }, 200);
});
