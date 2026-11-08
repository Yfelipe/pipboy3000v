// Tests for the WebAssembly builds in dist/ and the host runtime. Run: node --test emulator/test
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Espruino } from '../runtime/espruino.js';
import { expr } from '../../public/js/serial/protocol.js';
import { MemFS } from '../runtime/memfs.js';
import { BOARDS } from '../runtime/boards.js';
import { loadDumpSd, loadDumpStorage } from '../runtime/dump.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const wasm = {};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let running = [];
afterEach(() => {
  for (const emu of running) emu.stop(); // also when a test fails, so timers can't keep node alive
  running = [];
});

async function newestDump() {
  if (process.env.PIPBOY_DUMP) return process.env.PIPBOY_DUMP;
  const dumpsDir = path.join(HERE, '..', '..', 'data', 'dumps');
  for (const id of (await readdir(dumpsDir).catch(() => [])).sort().reverse()) {
    try {
      const m = JSON.parse(await readFile(path.join(dumpsDir, id, 'manifest.json'), 'utf8'));
      if (m.complete && m.device?.env?.BOARD === 'PIPBOY') return path.join(dumpsDir, id);
    } catch {}
  }
  return null;
}

async function boot(boardId, options = {}) {
  const board = BOARDS[boardId];
  wasm[boardId] ??= await WebAssembly.compile(await readFile(path.join(HERE, '..', 'dist', board.wasm)));
  let output = '';
  const emu = await Espruino.start({ board, wasm: wasm[boardId], onOutput: (t) => { output += t; }, ...options });
  running.push(emu);
  return {
    emu,
    /** Type a line at the REPL and return what it printed after the echoed line ("=3" etc). */
    async eval(code, wait = 0) {
      output = '';
      emu.write(`${code}\n`);
      if (wait) await sleep(wait);
      const lines = output.replace(/\r/g, '').split('\n');
      return lines.slice(1).join('\n').replace(/\n?>$/, '').trim();
    },
    get output() { return output; },
  };
}

describe('generic Espruino board', () => {
  test('boots to a REPL that evaluates JavaScript', async () => {
    const { emu, eval: run, output } = await boot('espruino');
    assert.match(output, /espruino\.com/);
    assert.equal(await run('1+2'), '=3');
    assert.equal(await run('process.env.BOARD'), '="ESPRUINO_WASM"');
    emu.stop();
  });

  test('timers run on the host clock', async () => {
    const { emu, eval: run } = await boot('espruino');
    await run('var n=0; setInterval(function(){n++}, 10)');
    await sleep(120);
    const n = Number((await run('n')).slice(1));
    assert.ok(n >= 5 && n <= 15, `expected about 10 ticks, got ${n}`);
    emu.stop();
  });

  test('Storage survives E.reboot() and boot code runs', async () => {
    const { emu, eval: run } = await boot('espruino');
    await run('require("Storage").write(".bootcde", "var booted=42;")');
    let rebooted = 0;
    emu.onReboot = () => rebooted++;
    await run('E.reboot()');
    assert.equal(rebooted, 1);
    assert.equal(await run('booted'), '=42');
    assert.equal(await run('require("Storage").list().join()'), '=".bootcde"');
    emu.stop();
  });

  test('storageWrite writes files larger than RAM can hold at once', async () => {
    const { emu, eval: run } = await boot('espruino');
    const big = 'x'.repeat(200 * 1024);
    emu.storageWrite('big.txt', big);
    assert.equal(await run('require("Storage").read("big.txt").length'), `=${big.length}`);
    emu.stop();
  });

  test('flash images can be saved and restored', async () => {
    const first = await boot('espruino');
    first.emu.storageWrite('note', 'kept');
    const image = first.emu.flashImage();
    first.emu.stop();
    const second = await boot('espruino', { flash: image });
    assert.equal(await second.eval('require("Storage").read("note")'), '="kept"');
    second.emu.stop();
  });

  test('outputs, buttons and setWatch', async () => {
    const changes = [];
    const { emu, eval: run } = await boot('espruino', { onPinChange: (pin, level) => changes.push([pin, level]) });
    await run('digitalWrite(LED1, 1)');
    assert.deepEqual(changes.at(-1), [emu.pin('D2'), 1]);
    // Watches on buttons are debounced (25 ms by default), so presses need to be spaced out
    await run('var presses=0; setWatch(function(){presses++}, BTN1, {edge:"rising", repeat:true})');
    for (const down of [true, false, true]) {
      emu.setButton('BTN1', down);
      await sleep(40);
    }
    assert.equal(await run('presses'), '=2');
    assert.equal(await run('BTN1.read()'), '=true');
    emu.stop();
  });

  test('Graphics draws into the framebuffer', async () => {
    const { emu, eval: run } = await boot('espruino');
    emu.takeDirty();
    await run('g.setColor(1,0,0).fillRect(10,20,12,22)');
    assert.deepEqual(emu.takeDirty(), { x1: 10, y1: 20, x2: 12, y2: 22 });
    assert.equal(emu.pixels[20 * emu.lcd.width + 10], 0xf800);
    assert.equal(emu.takeDirty(), null);
    emu.stop();
  });

  test('require("fs") and E.openFile use the host filesystem', async () => {
    const fs = new MemFS();
    fs.writeFile('/data/in.txt', 'from host');
    const { emu, eval: run } = await boot('espruino', { fs });
    assert.equal(await run('require("fs").readFileSync("data/in.txt")'), '="from host"');
    await run('var f=E.openFile("out.txt","w"); f.write("from device"); f.close()');
    assert.equal(new TextDecoder().decode(fs.readFile('/out.txt')), 'from device');
    assert.match(await run('require("fs").readdirSync("data")'), /"in\.txt"/);
    emu.stop();
  });
});

describe('Pip-Boy board', () => {
  test('identifies as the device and has the Pip library', async () => {
    const { emu, eval: run } = await boot('pipboy');
    assert.equal(await run('process.env.BOARD'), '="PIPBOY"');
    assert.equal(await run('typeof Pip.blitImage'), '="function"');
    assert.equal(await run('require("Storage").getStats().totalBytes'), '=131072');
    assert.equal(await run('process.memory().total'), '=5000');
    emu.stop();
  });

  test('board profile inputs: USB power, SD card, buttons, encoders, mode dial', async () => {
    const { emu, eval: run } = await boot('pipboy');
    assert.equal(await run('[A9.read(), A15.read(), BTN10.read(), BTN7.read()].join()'), '="true,false,false,false"');
    emu.setButton('BTN10', true);
    assert.equal(await run('BTN10.read()'), '=true');
    emu.setButton('BTN10', false);

    await run('var steps=[]; setWatch(function(e){steps.push(BTN9.read())}, BTN8, {edge:"rising", repeat:true, debounce:0})');
    emu.turnEncoder('knob1', 1);
    emu.turnEncoder('knob1', -1);
    await sleep(20);
    assert.equal(await run('steps.join()'), '="false,true"', 'direction shows in B when A rises');

    emu.setSelector('mode', 3);
    // the dial only reads correctly while MEAS_ENB (C4) is pulled low, as on the device
    assert.equal(await run('Math.round(analogRead(A7)*10)'), '=10');
    assert.equal(await run('pinMode(C4,"opendrain");C4.write(0);Math.round(analogRead(A7)*10)'), '=6');
    emu.stop();
  });

  test('device memory: CCM RAM areas and registers', async () => {
    const { emu, eval: run } = await boot('pipboy');
    await run('var a=new Uint8Array(E.toArrayBuffer(E.memoryArea(0x10000000+100, 8))); a[3]=77');
    assert.equal(await run('peek8(0x10000000+103)'), '=77');
    await run('poke32(0x40023874, 0x01000000)');
    assert.equal(await run('peek32(0x40023874)'), '=16777216');
    assert.match(await run('E.nativeCall(1, "void()", "")'), /can't run machine code/);
    emu.stop();
  });

  test('Pip.blitImage draws 2 bit buffers on the screen', async () => {
    const { emu, eval: run } = await boot('pipboy');
    emu.takeDirty();
    await run('var b=Graphics.createArrayBuffer(8,2,2,{msb:true}); b.setColor(3).fillRect(0,0,7,1); Pip.blitImage(b,100,50,{noScanEffect:true})');
    const rect = emu.takeDirty();
    assert.ok(rect && rect.x1 <= 100 && rect.x2 >= 107 && rect.y1 <= 50 && rect.y2 >= 51, JSON.stringify(rect));
    assert.notEqual(emu.pixels[50 * emu.lcd.width + 100], 0);
    emu.stop();
  });

  // Every app in apps/index.json, through every page, must run without printing an error
  const appsIndex = JSON.parse(readFileSync(path.join(HERE, '..', '..', 'apps', 'index.json'), 'utf8'));
  for (const app of appsIndex.apps) {
    test(`runs the ${app.name} app (apps/${app.file}) on every page without errors`, async () => {
      // with its SD card files (the companion extras add pages), as installing it does
      const fs = new MemFS();
      for (const f of app.sdFiles ?? []) fs.writeFile(`/${f.path}`, await readFile(path.join(HERE, '..', '..', 'apps', f.file)));
      fs.writeFile('/NOTES/Test.txt', new TextEncoder().encode('A note'));
      const device = await boot(app.board, { fs });
      const { emu } = device;
      emu.storageWrite(app.storageName, await readFile(path.join(HERE, '..', '..', 'apps', app.file)));
      emu.write(`load(${JSON.stringify(app.storageName)})\n`);
      await sleep(2500); // the app's boot screen
      // the header (top 40 rows) must change with the mode dial, i.e. the app follows it
      const header = () => emu.pixels.slice(0, emu.lcd.width * 40).join();
      const headers = new Set();
      for (let tab = 0; tab < app.pages.length; tab++) {
        emu.setSelector('mode', tab);
        await sleep(350);
        headers.add(header());
        for (let p = 0; p < app.pages[tab]; p++) {
          emu.turnEncoder('knob1', 1);
          await sleep(150);
          if (app.pages[tab] > 1) emu.turnEncoder('knob2', 1);
          await sleep(150);
        }
      }
      assert.doesNotMatch(device.output, /Uncaught|ERROR:/);
      assert.equal(headers.size, app.pages.length, 'every mode dial position shows a different tab');
    });
  }

  // Pip-OS 1.33's screens in our apps, from the same SD card files as the stock firmware
  const SCREENS = { mojave: { id: [1, 4], feeds: [2, 2], lists: [2, 3] }, 'pipos-x': { id: [1, 2], feeds: [2, 2], lists: [2, 3] } };
  for (const app of appsIndex.apps.filter((a) => SCREENS[a.id])) {
    test(`${app.name}: INV > ID, DATA > FEEDS and DATA > LISTS show the SD card's files`, async () => {
      const fs = new MemFS();
      const stripes = (w, h) => Uint8Array.from({ length: (w * h) / 4 }, (_, i) => (Math.floor(i / (w / 4)) % 8 < 4 ? 0xff : 0x00)); // 4 lit rows, 4 dark
      fs.writeFile('/USER/IDCARD.img', stripes(400, 300));
      fs.writeFile('/USER/USERIMG.img', stripes(400, 248));
      fs.writeFile('/USER/customLists.json', new TextEncoder().encode(JSON.stringify({ categories: [{ id: 'c', name: 'Groceries', items: [{ id: 'a', text: 'Nuka Cola', done: false, updated: 1 }] }] })));
      const device = await boot(app.board, { fs });
      const { emu } = device;
      emu.storageWrite(app.storageName, await readFile(path.join(HERE, '..', '..', 'apps', app.file)));
      emu.write(`load(${JSON.stringify(app.storageName)})\n`);
      await sleep(2500);
      const lit = (x1, y1, x2, y2) => {
        let n = 0;
        for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (emu.pixels[y * emu.lcd.width + x]) n++;
        return n;
      };
      const go = async ([tab, page]) => {
        emu.setSelector('mode', tab);
        await sleep(400);
        for (let i = 0; i < page; i++) { emu.turnEncoder('knob2', 1); await sleep(150); }
        await sleep(900);
      };
      const { id, feeds, lists } = SCREENS[app.id];
      await go(id); // the card covers the whole screen, header area included
      assert.ok(lit(60, 12, 420, 40) > 3000, 'ID card drawn over the header');
      assert.ok(lit(60, 292, 420, 308) > 1500, 'and over the footer');
      emu.setSelector('mode', 0);
      await sleep(600);
      await go(feeds);
      assert.ok(lit(60, 70, 420, 280) > 25000, 'feed picture on screen');
      emu.setSelector('mode', 0);
      await sleep(600);
      await go(lists);
      emu.setButton('BTN7', true); await sleep(100); emu.setButton('BTN7', false); await sleep(300); // open Groceries
      emu.turnEncoder('knob1', 1); await sleep(200); // down to the item
      emu.setButton('BTN7', true); await sleep(100); emu.setButton('BTN7', false); await sleep(300); // tick it
      const saved = JSON.parse(new TextDecoder().decode(fs.readFile('/USER/customLists.json')));
      assert.equal(saved.categories[0].items[0].done, true, 'ticked item saved for the stock firmware');
      assert.ok(saved.categories[0].items[0].updated > 1);
      assert.doesNotMatch(device.output, /Uncaught|ERROR:/);
    });
  }

  // The companion extras (apps/<app>/extras.js, on the SD card): NOTES, INBOX, REMOTE, FM presets, messages
  const EXTRAS = { mojave: { inbox: 5, remote: 5 }, 'pipos-x': { inbox: 5, remote: 3 } };
  for (const app of appsIndex.apps.filter((a) => EXTRAS[a.id])) {
    test(`${app.name}: the companion extras from the SD card (inbox, media remote, radio presets, messages)`, async () => {
      const fs = new MemFS();
      for (const f of app.sdFiles) fs.writeFile(`/${f.path}`, await readFile(path.join(HERE, '..', '..', 'apps', f.file)));
      fs.writeFile('/USER/MESSAGES.json', new TextEncoder().encode(JSON.stringify([{ text: 'Hello Courier', at: 1e12, read: false }])));
      const device = await boot(app.board, { fs });
      const { emu, eval: run } = device;
      emu.storageWrite('companion-radio.json', JSON.stringify([{ name: 'Diamond City', frequency: 101.7 }]));
      emu.storageWrite(app.storageName, await readFile(path.join(HERE, '..', '..', 'apps', app.file)));
      emu.write(`load(${JSON.stringify(app.storageName)})\n`);
      await sleep(2500);
      const press = async () => { emu.setButton('BTN7', true); await sleep(100); emu.setButton('BTN7', false); await sleep(300); };
      const go = async (tab, page) => {
        emu.setSelector('mode', 0); await sleep(500);
        emu.setSelector('mode', tab); await sleep(400);
        for (let i = 0; i < page; i++) { emu.turnEncoder('knob2', 1); await sleep(150); }
        await sleep(400);
      };
      // DATA > INBOX: opening a message marks it read for the stock interface's inbox too
      await go(2, EXTRAS[app.id].inbox);
      await press();
      const saved = JSON.parse(new TextDecoder().decode(fs.readFile('/USER/MESSAGES.json')));
      assert.equal(saved[0].read, true);
      await press();
      // INV > REMOTE (the emulator has no USB: stand in for it). Wheel up = volume up, press = play/pause,
      // thumbwheel = next track (it stays on the page)
      await run('E.setUSBHID=function(o){global.hidDesc=o.reportDescriptor};E.sendUSBHID=function(d){(global.hidLog=global.hidLog||[]).push([].slice.call(d).join());return true}');
      await go(1, EXTRAS[app.id].remote);
      emu.turnEncoder('knob1', -1); await sleep(200);
      await press();
      emu.turnEncoder('knob2', 1); await sleep(300);
      assert.equal(await run('hidDesc.length'), '=90');
      assert.equal(await run('JSON.stringify(hidLog.filter(function(r){return r!="2,0,0"}))'), '="[\\"2,233,0\\",\\"2,205,0\\",\\"2,181,0\\"]"');
      // a message from the companion pops up; the wheel dismisses it
      assert.equal(await run('typeof companionMessage'), '="function"');
      const top = () => emu.pixels.slice(emu.lcd.width * 100, emu.lcd.width * 200).join();
      const before = top();
      // the dashboard's own expression (public/js/serial/protocol.js)
      assert.match(await run(expr.pipMessage('Incoming', 2e12)), /live: true,\s*app: true/);
      assert.equal(JSON.parse(new TextDecoder().decode(fs.readFile('/USER/MESSAGES.json'))).pop().read, true, 'shown, so kept as read');
      await sleep(400);
      assert.notEqual(top(), before, 'the popup is drawn');
      await press();
      // RADIO: the FM dial and the preset come first; tuning to them doesn't fail
      await go(4, 0);
      await press(); // the FM dial
      emu.turnEncoder('knob2', 1); await sleep(200); // tunes up 0.1 MHz
      emu.turnEncoder('knob1', 1); await sleep(200);
      await press(); // the preset
      await sleep(300);
      assert.doesNotMatch(device.output, /Uncaught|ERROR:/);
    });
  }

  // The device's own videos (needs a dump's SD card: they hold the device's licensed artwork)
  test('PIP-OS X shows the SD card\'s Vault Boy and map videos on first opening their pages', async (t) => {
    const dir = await newestDump();
    if (!dir) return t.skip('no dump in data/dumps');
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const fs = new MemFS();
    await loadDumpSd(manifest, (rel) => readFile(path.join(dir, ...rel.split('/'))), fs);
    const { emu } = await boot('pipboy', { fs });
    emu.storageWrite('pipos-x.min.js', await readFile(path.join(HERE, '..', '..', 'apps', 'pipos-x', 'pipos-x.min.js')));
    emu.write('load("pipos-x.min.js")\n');
    await sleep(2500);
    // lit pixels inside a screen rectangle
    const lit = (x1, y1, x2, y2) => {
      let n = 0;
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (emu.pixels[y * emu.lcd.width + x]) n++;
      return n;
    };
    emu.setSelector('mode', 0); // STAT > VITALS: Vault Boy between the side panels
    await sleep(1200);
    assert.ok(lit(150, 80, 330, 260) > 2000, 'Vault Boy video on screen');
    emu.setSelector('mode', 3); // MAP > WORLD
    await sleep(1200);
    assert.ok(lit(60, 60, 420, 270) > 5000, 'map video on screen');
  });

  // Uses a real dump when one is present (they hold personal data, so none is checked in)
  test('boots a device dump to the main menu', async (t) => {
    const dumpsDir = path.join(HERE, '..', '..', 'data', 'dumps');
    let dir = process.env.PIPBOY_DUMP;
    if (!dir) {
      const ids = await readdir(dumpsDir).catch(() => []);
      for (const id of ids.sort().reverse()) {
        if (await access(path.join(dumpsDir, id, 'manifest.json')).then(() => true, () => false)) {
          dir = path.join(dumpsDir, id);
          break;
        }
      }
    }
    if (!dir) return t.skip('no dump in data/dumps (set PIPBOY_DUMP to use one elsewhere)');
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    if (manifest.device?.env?.BOARD !== 'PIPBOY' || !manifest.complete) return t.skip('newest dump is not a complete Pip-Boy dump');
    const readDumpFile = (rel) => readFile(path.join(dir, ...rel.split('/')));
    const fs = new MemFS();
    await loadDumpSd(manifest, readDumpFile, fs);
    const device = await boot('pipboy', { fs });
    await loadDumpStorage(manifest, readDumpFile, device.emu);
    await sleep(1000);
    assert.match(device.output, /Normal boot - showing main menu/);
    device.emu.stop();
  });
});
