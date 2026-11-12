// Pip-OS 1.33 (Espruino 2v29) against the emulator: the firmware's own settings through the
// dashboard's expressions, Pip.blitFile (FEEDS / ID) and the formats in public/js/pipimage.js.
// The firmware tests need a 1.33 dump in data/dumps (dumps hold personal data: none is checked in).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SerialSession } from '../public/js/serial/session.js';
import { expr } from '../public/js/serial/protocol.js';
import { pack2bpp, unpack2bpp, dither, quantize, normaliseLists, FEED, palettes } from '../public/js/pipimage.js';
import { Espruino } from '../emulator/runtime/espruino.js';
import { BOARDS } from '../emulator/runtime/boards.js';
import { MemFS } from '../emulator/runtime/memfs.js';
import { serialPort } from '../emulator/runtime/serial-port.js';
import { loadDumpSd, loadDumpStorage } from '../emulator/runtime/dump.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wasm = () => readFile(path.join(ROOT, 'emulator/dist/pipboy_wasm.wasm'));

async function dump133() {
  const dir = path.join(ROOT, 'data', 'dumps');
  for (const id of (await readdir(dir).catch(() => [])).sort().reverse()) {
    try {
      const m = JSON.parse(await readFile(path.join(dir, id, 'manifest.json'), 'utf8'));
      const ver = m.storage?.find((f) => f.name === 'VERSION');
      const fw = ver ? (await readFile(path.join(dir, id, ver.file), 'utf8')).trim() : '';
      if (m.complete && Number.parseFloat(fw) >= 1.33) return { dir: path.join(dir, id), manifest: m };
    } catch {}
  }
  return null;
}

test('image files: 2 bit packing round-trips and matches the firmware layout', () => {
  const levels = Uint8Array.from({ length: 8 }, (_, i) => i & 3);
  const bytes = pack2bpp(levels, 8, 1);
  assert.deepEqual([...bytes], [0b00011011, 0b00011011]); // msb first, as Graphics { msb: true }
  assert.deepEqual([...unpack2bpp(bytes, 8, 1)], [...levels]);
  assert.equal(pack2bpp(new Uint8Array(FEED.width * FEED.height), FEED.width, FEED.height).length, 24800); // = DATA/HANK.img
  assert.deepEqual([...quantize(Float32Array.from([0, 40, 50, 127, 128, 255]))], [0, 0, 1, 1, 2, 3]);
  const mid = dither(new Float32Array(400).fill(128), 20, 20, { contrast: 1 });
  const avg = mid.reduce((a, b) => a + b, 0) / mid.length;
  assert.ok(avg > 1.3 && avg < 1.7, `dithered grey averages ${avg}`);
});

test('lists: normalising keeps ids and ticks, fills in what is missing, drops junk', () => {
  const n = normaliseLists({ categories: [{ id: 'c1', name: 'Shopping', items: [{ id: 'i1', text: 'Nuka Cola', done: true, updated: 5 }, null, { text: 'Fancy Lads' }] }, 'junk'] });
  assert.equal(n.categories.length, 1);
  assert.deepEqual(n.categories[0].items[0], { id: 'i1', text: 'Nuka Cola', done: true, updated: 5 });
  assert.equal(n.categories[0].items.length, 2);
  assert.match(n.categories[0].items[1].id, /^[a-z0-9]{8}$/);
  assert.equal(n.categories[0].items[1].done, false);
  assert.deepEqual(normaliseLists(null), { categories: [] });
});

test('emulator: Pip.blitFile copies rows of a raw image file into a Graphics buffer', async () => {
  const fs = new MemFS();
  const img = new Uint8Array(100 * 10).map((_, i) => (i * 7) & 0xff); // 400x10, 2 bit
  fs.writeFile('/IMG.img', img);
  let out = '';
  const emu = await Espruino.start({ board: BOARDS.pipboy, wasm: await wasm(), fs, onOutput: (t) => { out += t; } });
  emu.write('var b=Graphics.createArrayBuffer(400,4,2,{msb:true});var f=E.openFile("IMG.img","r");' +
    'Pip.blitFile(b,f,{y:3,height:4,srcWidth:400,srcHeight:5});f.close();print("R="+JSON.stringify([].slice.call(new Uint8Array(b.buffer))))\n');
  await sleep(300);
  const got = JSON.parse(/R=(\[.*?])/.exec(out)[1]);
  assert.deepEqual(got.slice(0, 200), [...img.slice(300, 500)]); // rows 3 and 4
  assert.ok(got.slice(200).every((v) => v === 0), 'rows past srcHeight are cleared');
  emu.stop();
});

test('Pip-OS 1.33 firmware: settings are read and saved live through the firmware', async (t) => {
  const found = await dump133();
  if (!found) return t.skip('no Pip-OS 1.33 dump in data/dumps');
  const { dir, manifest } = found;
  const rd = (rel) => readFile(path.join(dir, ...rel.split('/')));
  const fs = new MemFS();
  await loadDumpSd(manifest, rd, fs);
  let out = '';
  const emu = await Espruino.start({ board: BOARDS.pipboy, wasm: await wasm(), fs, onOutput: (x) => { out += x; } });
  t.after(() => emu.stop());
  await loadDumpStorage(manifest, rd, emu);
  for (let i = 0; i < 40 && !/showing main menu/.test(out); i++) await sleep(250);
  assert.match(out, /Booting 2v29\.400 - 1\.33/);
  const session = new SerialSession({ promptDelayMs: 20, releaseIntervalMs: 5, probeOnConnect: false, keepAwake: false });
  await session.open(serialPort(emu));
  t.after(() => session.close());
  const s = await session.command(expr.pipSettings(), 10_000, { replyBytes: 2000 });
  assert.equal(s.live, true);
  assert.ok(Number.isFinite(s.settings.idleTimeout));
  assert.ok('fallbackMode' in s.settings, 'Pip-OS 1.32+ has fallbackMode');
  assert.equal(await session.command(expr.pipSettingsWrite({ fallbackMode: 0, userName: 'Test Dweller' })), 'live');
  const saved = JSON.parse(new TextDecoder().decode(fs.readFile('/settings.json')));
  assert.equal(saved.fallbackMode, 0);
  assert.equal(saved.userName, 'Test Dweller');
  assert.equal(await session.command('settings.fallbackMode'), 0);
  // the clock is set through the firmware's Pip.setDateAndTime (the emulator keeps the host's time)
  assert.equal(typeof (await session.command(expr.pipSetTime(Date.now()))), 'number');
});

test('Pip-OS 1.33 firmware: extensions, messages, display colour and the device summary', async (t) => {
  const found = await dump133();
  if (!found) return t.skip('no Pip-OS 1.33 dump in data/dumps');
  const { dir, manifest } = found;
  const rd = (rel) => readFile(path.join(dir, ...rel.split('/')));
  const fs = new MemFS();
  await loadDumpSd(manifest, rd, fs);
  let out = '';
  const emu = await Espruino.start({ board: BOARDS.pipboy, wasm: await wasm(), fs, onOutput: (x) => { out += x; } });
  t.after(() => emu.stop());
  await loadDumpStorage(manifest, rd, emu);
  emu.storageWrite('.boot0', await readFile(path.join(ROOT, 'apps/extensions/min/loader.js')));
  emu.storageWrite('ext.inbox.js', await readFile(path.join(ROOT, 'apps/extensions/min/inbox.js')));
  const booted = async () => {
    out = '';
    emu.reboot();
    for (let i = 0; i < 40 && !/showing main menu/.test(out); i++) await sleep(250);
    await sleep(2500); // the main menu appears after the boot animation
  };
  await booted();
  const session = new SerialSession({ promptDelayMs: 20, releaseIntervalMs: 5, probeOnConnect: false, keepAwake: false });
  await session.open(serialPort(emu));
  t.after(() => session.close());
  assert.deepEqual(await session.command('Object.keys(MODEINFO[1].submenu)'), ['STATUS', 'CONNECT', 'DIAGNOSTICS', 'INBOX'], 'the loader ran the Inbox extension');

  // The summary says Pip-OS is running and how far its clock is out
  const sum = await session.command(expr.deviceSummary(), 15_000, { replyBytes: 2000 });
  assert.equal(sum.pipos, true);
  assert.ok(Math.abs(sum.now - Date.now()) < 60_000);

  // A message pops up live and lands in USER/MESSAGES.json for the inbox
  const res = await session.command(expr.pipMessage('Meet at the Red Rocket at noon', 1794100000000), 10_000);
  assert.deepEqual(res, { live: true, app: false, count: 1, inbox: true });
  const inbox = JSON.parse(new TextDecoder().decode(fs.readFile('/USER/MESSAGES.json')));
  assert.deepEqual(inbox, [{ text: 'Meet at the Red Rocket at noon', at: 1794100000000, read: true }]);

  // Display colour: computed on the device as Pip-OS does it; our preview formula matches it
  const color = { r: 255, g: 112, b: 0, scanline: 100, overscan: 140 };
  assert.equal(await session.command(expr.pipPalette(color), 10_000), 'live');
  const saved = JSON.parse(new TextDecoder().decode(fs.readFile('/settings.json')));
  assert.deepEqual(saved.color, color);
  const device = saved.palette.split(',').map((b) => new Uint16Array(Uint8Array.from(Buffer.from(b, 'base64')).buffer));
  assert.deepEqual(device.map((p) => [...p]), palettes(color).map((p) => [...p]));

  // SD card space: reported on the device; the emulator's host filesystem has none to report
  const space = await session.command(expr.sdFree(), 10_000);
  assert.ok(space === null || space.total > 0);

  // Holding the torch button while it starts skips every extension
  await session.close();
  emu.setButton('BTN4', true);
  await booted();
  emu.setButton('BTN4', false);
  const again = new SerialSession({ promptDelayMs: 20, releaseIntervalMs: 5, probeOnConnect: false, keepAwake: false });
  await again.open(serialPort(emu));
  t.after(() => again.close());
  assert.deepEqual(await again.command('Object.keys(MODEINFO[1].submenu)'), ['STATUS', 'CONNECT', 'DIAGNOSTICS']);
});

test('Pip-OS 1.33 firmware: media remote, radio presets, notes, the scrolling header and start-at-power-on', async (t) => {
  const found = await dump133();
  if (!found) return t.skip('no Pip-OS 1.33 dump in data/dumps');
  const { dir, manifest } = found;
  const rd = (rel) => readFile(path.join(dir, ...rel.split('/')));
  const fs = new MemFS();
  await loadDumpSd(manifest, rd, fs);
  fs.writeFile('/NOTES/Water_chip.txt', new TextEncoder().encode('The water chip has failed.\n\nTry Vault 15.'));
  // a holotape on the SD card, as the dashboard copies it (apps/index.json "holotapes")
  fs.mkdirp('/USER');
  fs.mkdirp('/APPINFO');
  fs.writeFile('/USER/HACKING.JS', await readFile(path.join(ROOT, 'apps/holotapes/sd/USER/HACKING.JS')));
  fs.writeFile('/APPINFO/HACKING.json', await readFile(path.join(ROOT, 'apps/holotapes/sd/APPINFO/HACKING.json')));
  let out = '';
  const emu = await Espruino.start({ board: BOARDS.pipboy, wasm: await wasm(), fs, onOutput: (x) => { out += x; } });
  t.after(() => emu.stop());
  await loadDumpStorage(manifest, rd, emu);
  emu.storageWrite('.boot0', await readFile(path.join(ROOT, 'apps/extensions/min/loader.js')));
  for (const id of ['remote', 'radio', 'notes']) emu.storageWrite(`ext.${id}.js`, await readFile(path.join(ROOT, `apps/extensions/min/${id}.js`)));
  emu.storageWrite('companion-radio.json', JSON.stringify([{ name: 'Diamond City', frequency: 101.7 }, { name: 'Bad', frequency: 140 }]));
  // The emulator has no USB: stand in for E.setUSBHID / E.sendUSBHID (runs before Pip-OS, like .boot0)
  emu.storageWrite('.boot1', 'E.setUSBHID=function(o){global.hidDesc=o.reportDescriptor};E.sendUSBHID=function(d){(global.hidLog=global.hidLog||[]).push([].slice.call(d).join());return true};');
  const boot = async () => {
    out = '';
    emu.reboot();
    for (let i = 0; i < 40 && !/showing main menu/.test(out); i++) await sleep(250);
    await sleep(2500);
  };
  await boot();
  let session = new SerialSession({ promptDelayMs: 20, releaseIntervalMs: 5, probeOnConnect: false, keepAwake: false });
  await session.open(serialPort(emu));
  const run = (code) => session.command(code, 10_000, { replyBytes: 1500 });

  assert.deepEqual(await run('Object.keys(MODEINFO[2].submenu).slice(-1).concat(Object.keys(MODEINFO[3].submenu).slice(-1))'), ['REMOTE', 'NOTES']);
  assert.equal(await run('hidDesc.length'), 90, 'keyboard + media keys descriptor');
  // the remote: wheel up = volume up, press = play/pause, thumbwheel = next; the stock terminal's reports get report ID 1
  await run('(function(){MODEINFO[2].submenu.REMOTE();hidLog=[];Pip.emit("knob1",1);Pip.emit("knob1",0);Pip.emit("knob2",1);return 1})()'); // events run on the next idle
  await sleep(300);
  const keys = await run('(function(){Pip.removeSubmenu();E.sendUSBHID([0,0,4,0,0,0,0,0]);return hidLog.filter(function(r){return r!="2,0,0"})})()');
  assert.deepEqual(keys, ['2,233,0', '2,205,0', '2,181,0', '1,0,0,4,0,0,0,0,0']);
  // radio presets join the stock radio menu (out-of-band frequencies are ignored)
  const menu = await run('(function(){var got,s=E.showMenu;E.showMenu=function(m){got=Object.keys(m)};submenuRadio();E.showMenu=s;if(Pip.removeSubmenu)Pip.removeSubmenu();return got})()');
  assert.deepEqual(menu.slice(-1), ['DIAMOND C 101.7']);
  assert.equal(menu.filter((k) => /140/.test(k)).length, 0);
  // notes
  const notes = await run('(function(){var got,s=E.showMenu;E.showMenu=function(m){got=Object.keys(m)};MODEINFO[3].submenu.NOTES();E.showMenu=s;return got})()');
  assert.deepEqual(notes, ['', 'WATER CHIP']);
  // holotapes: INV > APPS lists the file and runs it on the firmware's page buffer. The menu shows
  // the APPINFO name when the firmware can read that folder, and the file's own name otherwise.
  const apps = await run('(function(){var got,s=E.showMenu;E.showMenu=function(m){got=m};submenuApps();E.showMenu=s;var k=Object.keys(got).filter(function(n){return /HACKING/.test(n)});got[k[0]]();return k})()');
  assert.equal(apps.length, 1, JSON.stringify(apps));
  await sleep(300);
  assert.equal(await run('(function(){Pip.emit("knob1",-1);Pip.emit("knob1",0);return typeof Pip.removeSubmenu})()'), 'function');
  await sleep(300);
  await run('(Pip.removeSubmenu(),delete Pip.removeSubmenu,1)');
  // the header scrolls instead of failing when a tab has more names than fit
  assert.equal(await run('(function(){sm0=5;drawHeader(3);sm0=0;drawHeader(3);return 1})()'), 1);
  assert.doesNotMatch(out, /Uncaught|failed:/);

  // Start at power-on: the app opens on a restart, and load() (its way out) gives the stock interface
  // the same code the dashboard writes (public/js/device/bundles.js startAppCode; that module needs a browser)
  emu.storageWrite('.bootPowerOn', '// companion-startapp\nif (!BTN4.read() && require("Storage").read("pipos-x.min.js") !== undefined) load("pipos-x.min.js");\n');
  await session.close();
  out = '';
  emu.reboot();
  await sleep(5000);
  session = new SerialSession({ promptDelayMs: 20, releaseIntervalMs: 5, probeOnConnect: false, keepAwake: false });
  await session.open(serialPort(emu));
  t.after(() => session.close());
  assert.equal(await session.command('typeof MODEINFO'), 'undefined', 'the app is running, not Pip-OS');
  await session.close();
  emu.write('load()\n');
  for (let i = 0; i < 40 && !/showing main menu/.test(out.split('load()').pop()); i++) await sleep(250);
  session = new SerialSession({ promptDelayMs: 20, releaseIntervalMs: 5, probeOnConnect: false, keepAwake: false });
  await session.open(serialPort(emu));
  assert.equal(await session.command('typeof MODEINFO'), 'object', 'load() returns to the stock interface');
});
