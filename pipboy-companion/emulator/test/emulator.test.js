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
import { pipOsUpdatePlan, silentWav, pipOsReleases, latestPipOs, PIPOS_VARIANTS, pipOsVariantFor } from '../runtime/pipos.js';
import { unzip } from '../runtime/unzip.js';
import { deflateRawSync } from 'node:zlib';

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

test('fs.getFree() reports the emulated SD card (16 GB, less what is on it)', async () => {
  const fs = new MemFS();
  fs.writeFile('/a.bin', new Uint8Array(100000));
  const { eval: run } = await boot('pipboy', { fs });
  const field = async (k) => Number((await run(`require("fs").getFree().${k}`)).slice(1));
  const free = { sectorSize: await field('sectorSize'), totalSectors: await field('totalSectors'), freeSectors: await field('freeSectors') };
  assert.equal(free.sectorSize, 512);
  assert.equal(free.totalSectors * 512, 16 * 1024 ** 3);
  assert.equal((free.totalSectors - free.freeSectors) * 512, fs.usedBytes());
  assert.ok(fs.usedBytes() >= 100000);
});

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

describe('Audio', () => {
  test('Pip.audioStart plays a WAV in real time through onAudio, and audioStopped fires at its end', async () => {
    // our own test tone: 0.5 s of 440 Hz, 16 kHz mono 16 bit
    const n = 8000, wav = new Uint8Array(44 + n * 2), v = new DataView(wav.buffer);
    [...'RIFF'].forEach((c, i) => (wav[i] = c.charCodeAt(0))); v.setUint32(4, 36 + n * 2, true);
    [...'WAVEfmt '].forEach((c, i) => (wav[8 + i] = c.charCodeAt(0)));
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, 16000, true);
    v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    [...'data'].forEach((c, i) => (wav[36 + i] = c.charCodeAt(0))); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / 16000) * 12000), true);
    const fs = new MemFS();
    fs.writeFile('/TONE.WAV', wav);
    const heard = [];
    const { emu, eval: run } = await boot('pipboy', { fs, onAudio: (samples, rate) => heard.push([performance.now(), samples.length, rate, Math.max(...samples)]) });
    await run('Pip.on("audioStopped",function(){global.stopped=1});Pip.audioStart("TONE.WAV")');
    const t0 = performance.now();
    await sleep(250);
    assert.equal(await run('Pip.audioIsPlaying()'), '=true');
    const early = heard.reduce((a, h) => a + h[1], 0);
    assert.ok(early > 2000 && early < 6500, `paced in real time: ${early} samples after 250 ms`);
    await sleep(700);
    const total = heard.reduce((a, h) => a + h[1], 0);
    assert.ok(total >= n && total < n + 100, `all of it played: ${total} samples`);
    assert.equal(heard[0][2], 16000);
    assert.ok(Math.max(...heard.map((h) => h[3])) > 11000, 'the tone, not silence');
    assert.equal(await run('Pip.audioIsPlaying()'), '=false');
    assert.equal(await run('global.stopped'), '=1');
    assert.ok(performance.now() - t0 > 450, 'took about as long as the sound lasts');
    emu.stop();
  });
});

describe('I2C', () => {
  test('a chip in the board profile answers; an empty address throws, as on a real bus', async () => {
    const { emu, eval: run } = await boot('fo3');
    assert.equal(await run('I2C1.setup({scl:B6,sda:B7});I2C1.readFrom(0x0f,1)[0]'), '=0'); // KXTJ3: register 0 after power-up
    assert.equal(await run('I2C1.writeTo(0x0f,0x0f);I2C1.readFrom(0x0f,1)[0]'), '=53'); // WHO_AM_I
    assert.match(await run('try{I2C1.readFrom(0x19,1)}catch(e){print("CAUGHT",e.message)}'), /CAUGHT I2C1: no device at address 25/);
    emu.setAcceleration(0.5, -0.25, 1);
    assert.equal(await run('I2C1.writeTo(0x0f,0x07);JSON.stringify(I2C1.readFrom(0x0f,5))'), '="[32,0,240,0,64]"');
    // a tap pulls ACCEL_INT (C7) low until INT_REL is read
    emu.tap();
    assert.equal(await run('digitalRead(C7)'), '=0');
    await run('I2C1.writeTo(0x0f,0x1a);I2C1.readFrom(0x0f,1)');
    assert.equal(await run('digitalRead(C7)'), '=1');
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

  test('the 512 KB Storage variant is the same Pip-Boy with room for Pip-OS and both apps', async () => {
    const { emu, eval: run } = await boot('pipboy-xl');
    assert.equal(await run('process.env.BOARD'), '="PIPBOY"');
    assert.equal(await run('require("Storage").getStats().totalBytes'), '=524288');
    // Pip-OS (about 97 KB) plus both apps (about 50 KB) would fill 128 KB
    const app = await readFile(path.join(HERE, '..', '..', 'apps', 'pipos-x', 'pipos-x.min.js'));
    emu.storageWrite('.bootcde', new Uint8Array(100_000).fill(0x20));
    emu.storageWrite('mojave.min.js', await readFile(path.join(HERE, '..', '..', 'apps', 'mojave', 'mojave.min.js')));
    emu.storageWrite('pipos-x.min.js', app);
    assert.equal(await run('require("Storage").read("pipos-x.min.js").length'), `=${app.length}`);
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
      // and any title screen after it: the app is running once its header (above y 60) is drawn
      const headerLit = () => { for (let i = 7 * 480; i < 60 * 480; i++) if (emu.pixels[i]) return true; return false; };
      for (let t = 0; t < 40 && !headerLit(); t++) await sleep(250);
      // the screen must change with the mode dial, i.e. the app follows it. The whole screen, not
      // just a header: each app shows its section its own way (tabs, a boxed title, a lit button)
      const header = () => emu.pixels.join();
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

  // Endurance's own controls: the robot's settings are held with a press, changed with the wheel and kept
  test('Endurance: SHIP > ROBOT changes a setting with the wheel and keeps it', async () => {
    const app = appsIndex.apps.find((a) => a.id === 'endurance');
    const device = await boot(app.board, { fs: new MemFS() });
    const { emu, eval: run } = device;
    emu.storageWrite(app.storageName, await readFile(path.join(HERE, '..', '..', 'apps', app.file)));
    emu.write(`load(${JSON.stringify(app.storageName)})\n`);
    await sleep(2500);
    const press = async () => { emu.setButton('BTN7', true); await sleep(100); emu.setButton('BTN7', false); await sleep(300); };
    emu.setSelector('mode', 0); await sleep(400);
    emu.turnEncoder('knob2', 1); await sleep(150);
    emu.turnEncoder('knob2', 1); await sleep(400); // RING, CREW, ROBOT
    await press(); // take hold of HUMOR
    emu.turnEncoder('knob1', 1); await sleep(150);
    emu.turnEncoder('knob1', 1); await sleep(150);
    await press(); // and set it
    const humor = Number((await run('require("Storage").readJSON("robot.json",1)[0]')).slice(1));
    assert.ok(humor === 65 || humor === 85, `two steps of 5 from 75, saved where TARS reads it (got ${humor})`);
    assert.equal(await run('require("Storage").readJSON("robot.json",1)[1]'), '=90', 'the others are untouched');
    assert.doesNotMatch(device.output, /Uncaught|ERROR:/);
  });

  test('Endurance: the title screen, NAV > GARGANTUA and the MURPH clock face come from the SD card, and it runs without them', async () => {
    const app = appsIndex.apps.find((a) => a.id === 'endurance');
    for (const pictures of [true, false]) {
      const fs = new MemFS();
      if (pictures) for (const f of app.sdFiles) fs.writeFile(`/${f.path}`, await readFile(path.join(HERE, '..', '..', 'apps', f.file)));
      const device = await boot(app.board, { fs });
      const { emu } = device;
      emu.storageWrite(app.storageName, await readFile(path.join(HERE, '..', '..', 'apps', app.file)));
      emu.write(`load(${JSON.stringify(app.storageName)})\n`);
      const lit = (x1, y1, x2, y2) => {
        let n = 0;
        for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (emu.pixels[y * emu.lcd.width + x]) n++;
        return n;
      };
      await sleep(2600); // the boot lines are over: the title is up, or (without it) the first page
      if (pictures) assert.ok(lit(40, 135, 440, 175) > 1500 && lit(40, 70, 440, 120) === 0, 'the title alone on the screen');
      else assert.ok(lit(40, 70, 440, 120) > 300, 'no title screen: straight to the first page');
      await sleep(2200);
      emu.setSelector('mode', 3); await sleep(400);
      emu.turnEncoder('knob2', 1); await sleep(900); // ROUTE, GARGANTUA
      const hole = lit(40, 65, 440, 249);
      if (pictures) assert.ok(hole > 12000, `the black hole fills the page (${hole} lit)`);
      else assert.ok(hole > 500 && hole < 6000, `a line of text in its place (${hole} lit)`);
      emu.setSelector('mode', 2); await sleep(400);
      for (let i = 0; i < 7; i++) { emu.turnEncoder('knob2', 1); await sleep(150); } // CLOCK (after NOTES and INBOX)
      await sleep(600);
      const dial = lit(40, 65, 224, 275);
      emu.turnEncoder('knob1', 1); await sleep(900); // the other face
      const murph = lit(40, 65, 224, 275);
      if (pictures) assert.ok(murph > dial * 3, `the photograph replaces the drawn dial (${dial} -> ${murph} lit)`);
      else assert.ok(Math.abs(murph - dial) < 400, 'the drawn dial stays');
      assert.doesNotMatch(device.output, /Uncaught|ERROR:/);
    }
  });

  test('TARS: its console, then a setting changed in SETTINGS is saved where Endurance reads it', async () => {
    const app = appsIndex.apps.find((a) => a.id === 'tars');
    const device = await boot(app.board, { fs: new MemFS() });
    const { emu, eval: run } = device;
    emu.storageWrite('robot.json', JSON.stringify([75, 90, 60, 50]));
    emu.storageWrite(app.storageName, await readFile(path.join(HERE, '..', '..', 'apps', app.file)));
    emu.write(`load(${JSON.stringify(app.storageName)})\n`);
    const lit = (y1, y2) => { let n = 0; for (let i = y1 * 480; i < y2 * 480; i++) if (emu.pixels[i]) n++; return n; };
    await sleep(1500);
    assert.ok(lit(65, 275) > 1500 && lit(7, 60) === 0, 'the console is up, alone');
    await sleep(5000);
    assert.ok(lit(7, 60) > 500, 'then the app, with its header');
    const press = async () => { emu.setButton('BTN7', true); await sleep(100); emu.setButton('BTN7', false); await sleep(300); };
    emu.setSelector('mode', 2); await sleep(600); // SETTINGS
    emu.turnEncoder('knob1', 1); await sleep(200); // HONESTY
    await press(); // take hold of it
    emu.turnEncoder('knob1', 1); await sleep(150);
    await press(); // and let go
    assert.equal(await run('require("Storage").readJSON("robot.json",1)[0]'), '=75', 'humor untouched');
    const honesty = Number((await run('require("Storage").readJSON("robot.json",1)[1]')).slice(1));
    assert.ok(honesty === 85 || honesty === 95, `honesty moved one step (got ${honesty})`);
    assert.doesNotMatch(device.output, /Uncaught|ERROR:/);
  });

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

  // PROTOTYPE FO3 board (espruino/boards/SAPLING_WASM.py, boards.js "fo3"): every control reaches
  // the pin the profile says, under the FO3 firmware's pin names (web/sapling-boot0.js), checked
  // through the control test (web/fo3-controls.js)
  test('FO3 prototype: buttons, both wheels, the page knob and the mode lamps, by the firmware\'s pin names', async () => {
    const device = await boot('fo3');
    const { emu, eval: run } = device;
    assert.equal(await run('process.env.BOARD'), '="SAPLING"');
    assert.equal(await run('require("Storage").getStats().totalBytes'), '=262144');
    emu.storageWrite('.boot0', await readFile(path.join(HERE, '..', 'web', 'sapling-boot0.js')));
    emu.storageWrite('.bootcde', await readFile(path.join(HERE, '..', 'web', 'fo3-controls.js')));
    emu.reboot();
    await sleep(1200);
    const state = async (key) => JSON.parse(JSON.parse((await run(`JSON.stringify(FO3.${key})`)).slice(1))); // REPL shows ="<json>"
    const press = async (id) => { emu.setButton(id, true); await sleep(80); emu.setButton(id, false); await sleep(150); };
    // every name the firmware uses is a pin
    assert.equal(await run('["BTN_STATS","BTN_ITEMS","BTN_DATA","BTN_POWER","ENC1_A","ENC1_B","ENC1_PRESS","ENC2_A","ENC2_B","MODE_SELECTOR","MEAS_ENB","LED_STATS","LED_ITEMS","LED_DATA","LED_TORCH","LED_DOWNFIRE","LCD_BL"].filter(function(n){return !(global[n] instanceof Pin)}).length'), '=0');
    for (const [id, mode, lamps] of [['BTN_ITEMS', 1, '[false,true,false]'], ['BTN_DATA', 2, '[false,false,true]'], ['BTN_STATS', 0, '[true,false,false]']]) {
      await press(id);
      assert.equal(await state('mode'), mode, `${id} -> mode ${mode}`);
      assert.equal(await run('JSON.stringify([LED_STATS.read(),LED_ITEMS.read(),LED_DATA.read()])'), `="${lamps}"`);
    }
    // left wheel, as the firmware reads it: down the list (ArrowDown, a +1 turn) is +1, up is -1
    for (let i = 0; i < 3; i++) { emu.turnEncoder('primary', 1); await sleep(60); }
    emu.turnEncoder('primary', -1); await sleep(60);
    assert.equal(await state('sel'), 2);
    // top wheel, both ways
    emu.turnEncoder('secondary', 1); await sleep(60);
    emu.turnEncoder('secondary', 1); await sleep(60);
    emu.turnEncoder('secondary', -1); await sleep(60);
    assert.equal(await state('secondary'), 1);
    await press('ENC1_PRESS');
    assert.equal(await run('LED_DOWNFIRE.read()'), '=true');
    // the page knob's five positions, decoded as the firmware does
    for (const p of [4, 2, 0]) {
      emu.setSelector('page', p);
      await sleep(250);
      assert.equal(await state('page'), p, `page ${p + 1}`);
    }
    await press('BTN_POWER');
    assert.equal(await state('power'), 1);
    assert.doesNotMatch(device.output, /Uncaught|ERROR/);
  });

  // The real FO3 firmware, when there's a copy to test with: The Wand Company's sapling zip in
  // data/firmware/ (data/ is git-ignored: the firmware is theirs). Its own screens answer each control.
  test('FO3 firmware (sapling zip in data/firmware) boots on the prototype and follows its controls', async (t) => {
    const dir = path.join(HERE, '..', '..', 'data', 'firmware');
    const zip = (await readdir(dir).catch(() => [])).find((f) => /^sapling.*\.zip$/i.test(f));
    if (!zip) return t.skip('no sapling_*.zip in data/firmware');
    const plan = pipOsUpdatePlan(await unzip(new Uint8Array(await readFile(path.join(dir, zip)))));
    assert.equal(plan.board, 'fo3');
    const fs = new MemFS();
    for (const [p, b] of plan.sd) fs.writeFile(p, b);
    const device = await boot('fo3', { fs });
    const { emu, eval: run } = device;
    emu.storageWrite('.boot0', await readFile(path.join(HERE, '..', 'web', 'sapling-boot0.js')));
    for (const [name, b] of plan.storage) emu.storageWrite(name, b);
    emu.setSelector('page', 0);
    emu.reboot();
    await sleep(8000);
    assert.match(device.output, new RegExp(`Booting 2v29\\.400 - ${plan.version.replace(/\./g, '\\.')}`));
    const shot = () => emu.pixels.slice().join();
    const mode = async () => Number((await run('Pip.MODE')).slice(1));
    const page = async () => Number((await run('Pip.MENUX')).slice(1));
    const press = async (id) => { emu.setButton(id, true); await sleep(150); emu.setButton(id, false); await sleep(2500); };
    assert.equal(await mode(), 0, 'STATS at start');
    await press('BTN_ITEMS');
    assert.equal(await mode(), 1, 'ITEMS button');
    emu.setSelector('page', 1); await sleep(2500);
    assert.equal(await page(), 1, 'page knob: second page');
    let before = shot();
    emu.turnEncoder('primary', 1); await sleep(800);
    assert.notEqual(shot(), before, 'left wheel moves the selection');
    await press('BTN_DATA');
    assert.equal(await mode(), 2, 'DATA button');
    await press('BTN_STATS');
    emu.setSelector('page', 2); await sleep(2500); // Skills, with its scrolling description
    before = shot();
    for (let i = 0; i < 4; i++) { emu.turnEncoder('secondary', 1); await sleep(200); }
    await sleep(800);
    assert.notEqual(shot(), before, 'top wheel scrolls the description');
    // the mode lamps fade (a require("timer") task, run by the emulator's utility timer)
    assert.ok(emu.analogOut.get(emu.pin('E7')) > 0.5 && emu.analogOut.get(emu.pin('E8')) < 0.1, 'STATS lamp lit, ITEMS lamp out');
    // its accelerometer is found (so no "hardware version mismatch"), and a tap reaches it
    assert.equal(await run('Pip.accel.isKXTJ3 && Pip.accel.running'), '=true');
    emu.tap();
    await sleep(600);
    assert.equal(emu.levels.get(emu.pin('C7')), 1, 'the firmware read the tap and released ACCEL_INT');
    await run('Pip.radio.setPower(1)');
    await sleep(800);
    assert.equal(await run('Pip.radioOn'), '=true', 'the FM radio answers');
    // STATS > Status > ENG: card space (fs.getFree), clocks and temperature all have answers
    assert.equal(await run('(()=>{try{var m=eval(require("fs").readFileSync("JS/STATUS_ENG.JS"))();m.remove();return "ok"}catch(e){return e.message}})()', 500), '="ok"');
    assert.doesNotMatch(device.output, /Uncaught|not defined|not found|accelerometer|mismatch|I2C\d: no device/);
  });

  // The starter Pip-Boy (emulator/starter): usable with no device and no Pip-OS
  test('the starter Pip-Boy boots to its menu, opens an app, and the app\'s power button comes back', async () => {
    const dir = path.join(HERE, '..', 'starter');
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    // kept in step with the apps (npm run apps:build rebuilds it)
    for (const [name, file] of [['mojave.min.js', 'mojave/mojave.min.js'], ['pipos-x.min.js', 'pipos-x/pipos-x.min.js'], ['capital.min.js', 'capital/capital.min.js'], ['pip2000.min.js', 'pip2000/pip2000.min.js'], ['endurance.min.js', 'endurance/endurance.min.js'], ['tars.min.js', 'tars/tars.min.js']]) {
      const entry = manifest.storage.find((f) => f.name === name);
      assert.deepEqual(await readFile(path.join(dir, entry.file)), await readFile(path.join(HERE, '..', '..', 'apps', file)), `${name} is up to date (npm run starter:build)`);
    }
    const rd = (rel) => readFile(path.join(dir, ...rel.split('/')));
    const fs = new MemFS();
    await loadDumpSd(manifest, rd, fs);
    const device = await boot('pipboy-xl', { fs }); // as the emulator page starts it (Extra Storage)
    const { emu, eval: run } = device;
    assert.deepEqual(await loadDumpStorage(manifest, rd, emu, { asFarAsFits: true }), [], 'everything fits in 512 KB');
    await sleep(1500);
    const lit = () => emu.pixels.reduce((n, p) => n + (p ? 1 : 0), 0);
    assert.ok(lit() > 2000, 'the menu is drawn');
    emu.turnEncoder('knob1', 1); await sleep(200); // PIP-OS X
    emu.setButton('BTN7', true); await sleep(100); emu.setButton('BTN7', false);
    await sleep(3000);
    assert.equal(await run('typeof companionMessage'), '="function"', 'PIP-OS X runs, with its extras from the SD card');
    emu.setButton('BTN10', true); await sleep(100); emu.setButton('BTN10', false);
    await sleep(1500);
    assert.equal(await run('typeof companionMessage'), '="undefined"', 'back at the starter menu');
    // Holotapes are in the menu after the apps, and run on the menu's stand-in for the stock page buffer
    emu.turnEncoder('knob1', 1); await sleep(200);
    emu.turnEncoder('knob1', 1); await sleep(200);
    emu.turnEncoder('knob1', 1); await sleep(200);
    emu.turnEncoder('knob1', 1); await sleep(200);
    emu.turnEncoder('knob1', 1); await sleep(200);
    emu.turnEncoder('knob1', 1); await sleep(200); // past the six apps
    emu.setButton('BTN7', true); await sleep(100); emu.setButton('BTN7', false);
    await sleep(800);
    assert.equal(await run('typeof Pip.removeSubmenu'), '="function"', 'the first holotape is running');
    emu.turnEncoder('knob1', 1); await sleep(150); // its own wheel handling, through Pip's knob1 event
    emu.setButton('BTN7', true); await sleep(100); emu.setButton('BTN7', false); await sleep(300);
    emu.setButton('BTN10', true); await sleep(100); emu.setButton('BTN10', false); await sleep(400);
    assert.equal(await run('typeof Pip.removeSubmenu'), '="undefined"', 'the power button leaves it');
    assert.equal(await run('(runHolotape("HACKING.JS"),typeof Pip.removeSubmenu)'), '="function"', 'runHolotape opens one directly (the emulator page)');
    assert.doesNotMatch(device.output, /Uncaught|ERROR:/);
  });

  test('the starter on a Pip-Boy with 128 KB of Storage: the apps that fit, and a menu that lists only those', async () => {
    const dir = path.join(HERE, '..', 'starter');
    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf8'));
    const rd = (rel) => readFile(path.join(dir, ...rel.split('/')));
    const fs = new MemFS();
    await loadDumpSd(manifest, rd, fs);
    const device = await boot('pipboy', { fs });
    await assert.rejects(loadDumpStorage(manifest, rd, device.emu), /Storage write failed/, 'a real dump that does not fit is an error');
    const left = await loadDumpStorage(manifest, rd, device.emu, { asFarAsFits: true });
    assert.ok(left.length >= 1 && !left.includes('.bootcde'), `the menu itself fits; left out: ${left.join(', ')}`);
    await sleep(1500);
    assert.equal(await device.eval('require("Storage").read(' + JSON.stringify(left[0]) + ') === undefined'), '=true');
    assert.doesNotMatch(device.output, /Uncaught|ERROR:/);
  });

  test('adding the official Pip-OS update: what goes on the SD card and into Storage', () => {
    const t = (s) => new TextEncoder().encode(s);
    const files = new Map([
      ['blueprint/FW.JS', t('Pip.isSDCardInserted();/* Pip-OS */')],
      ['blueprint/VERSION', t('1.33\n')],
      ['blueprint/UI/OK.wav', t('RIFF')],
      ['blueprint/fwupdate.js', t('flasher')],
    ]);
    const plan = pipOsUpdatePlan(files);
    assert.equal(plan.version, '1.33');
    assert.deepEqual(plan.storage.map(([n]) => n), ['.bootcde', 'VERSION']);
    assert.deepEqual(plan.sd.map(([p]) => p).sort(), ['/BOOT/BOOT_DONE.wav', '/FW.JS', '/UI/OK.wav', '/VERSION']);
    assert.equal(silentWav().length, 44 + 3200);
    assert.throws(() => pipOsUpdatePlan(new Map([['x.txt', t('x')]])), /no FW\.JS/);
  });

  test('the Pip-OS release index: newest zip first, only addresses on The Wand Company\'s CDN', async () => {
    // the shape of https://cdn.thewandcompany.com/blueprint/index.json
    const index = [
      { Version: 'v1.32', ReleaseDate: '2026-10-05T14:57:40+00:00', ReleaseNotesHtml: 'blueprint/v1.32/RELEASE_NOTES.html', Assets: ['blueprint/v1.32/assets/blueprint_2v29.362-1.32.zip'] },
      { Version: 'v1.33', ReleaseDate: '2026-10-29T22:44:21+00:00', ReleaseNotesHtml: 'blueprint/v1.33/RELEASE_NOTES.html', Assets: ['blueprint/v1.33/assets/blueprint_2v29.400-1.33.zip'] },
      { Version: 'v9', ReleaseDate: '2030-01-01', Assets: ['https://elsewhere.example/evil.zip'] },
    ];
    const [newest, older, ...rest] = pipOsReleases(index);
    assert.deepEqual(newest, {
      version: '1.33', date: '2026-10-29T22:44:21+00:00',
      zipUrl: 'https://cdn.thewandcompany.com/blueprint/v1.33/assets/blueprint_2v29.400-1.33.zip',
      zipFile: 'blueprint_2v29.400-1.33.zip',
      notesUrl: 'https://cdn.thewandcompany.com/blueprint/v1.33/RELEASE_NOTES.html',
    });
    assert.equal(older.version, '1.32');
    assert.equal(rest.length, 0, 'a zip on another site is left out');
    const fake = async (url) => ({ ok: url === 'https://cdn.thewandcompany.com/blueprint/index.json', json: async () => index });
    assert.equal((await latestPipOs({ fetch: fake })).version, '1.33');
    assert.equal(await latestPipOs({ fetch: async () => { throw new Error('offline'); } }), null);
    // the variants their tool knows (lt plus FO3), and the SD card marker for the Overseer
    assert.deepEqual(PIPOS_VARIANTS.map((v) => [v.id, v.feed]), [['blueprint', 'blueprint'], ['overseer', 'blueprint-overseer'], ['FO3', 'sapling']]);
    const fs = new MemFS();
    assert.equal(pipOsVariantFor(fs).id, 'blueprint');
    fs.writeFile('/MISC/HANK.avi', new Uint8Array(4));
    assert.equal(pipOsVariantFor(fs).id, 'overseer');
  });

  test('unzip reads stored and deflated files and leaves out folders, dotfiles and __MACOSX', async () => {
    const t = (x) => Buffer.from(x);
    const entries = [['blueprint/FW.JS', t('Pip.x();'.repeat(200)), 8], ['blueprint/VERSION', t('1.33'), 0], ['blueprint/UI/', t(''), 0], ['__MACOSX/._FW.JS', t('junk'), 0], ['blueprint/.DS_Store', t('junk'), 0]];
    const locals = [], centrals = [];
    let offset = 0;
    for (const [name, data, method] of entries) {
      const body = method ? deflateRawSync(data) : data, n = t(name);
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(method, 8); h.writeUInt32LE(body.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(n.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(method, 10); c.writeUInt32LE(body.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(offset, 42);
      locals.push(h, n, body); centrals.push(c, n);
      offset += 30 + n.length + body.length;
    }
    const central = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16);
    const files = await unzip(new Uint8Array(Buffer.concat([...locals, central, end])));
    assert.deepEqual([...files.keys()], ['blueprint/FW.JS', 'blueprint/VERSION']);
    assert.equal(Buffer.from(files.get('blueprint/FW.JS')).toString(), 'Pip.x();'.repeat(200));
    // straight into the update plan, as the emulator's "Add the update zip" does
    assert.deepEqual(pipOsUpdatePlan(files).storage.map(([n]) => n), ['.bootcde', 'VERSION']);
    await assert.rejects(unzip(new Uint8Array(100)), /isn’t a zip/);
  });

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

  for (const [title, storageName, file] of [['Capital UI', 'capital.min.js', 'capital/capital.min.js'], ['Mojave UI', 'mojave.min.js', 'mojave/mojave.min.js']]) test(`${title}: STAT > STATUS plays Vault Boy from the SD card's STAT videos, and draws its own figure without them`, async (t) => {
    const dir = path.join(HERE, '..', '..', 'assets', 'official', 'STAT');
    const names = (await readdir(dir).catch(() => [])).filter((n) => /^VB\d+\.avi$/i.test(n)).sort().slice(0, 2);
    if (names.length < 2) return t.skip('no Vault Boy videos in assets/official/STAT');
    const app = await readFile(path.join(HERE, '..', '..', 'apps', ...file.split('/')));
    const open = async (fs) => {
      const device = await boot('pipboy', { fs });
      device.emu.storageWrite(storageName, app);
      device.emu.write(`load(${JSON.stringify(storageName)})\n`);
      await sleep(2500);
      device.emu.setSelector('mode', 0);
      await sleep(1500);
      return device;
    };
    const lit = (emu, x1, y1, x2, y2) => {
      let n = 0;
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) if (emu.pixels[y * emu.lcd.width + x]) n++;
      return n;
    };
    const fs = new MemFS();
    fs.mkdirp('/STAT');
    for (const n of names) fs.writeFile(`/STAT/${n}`, await readFile(path.join(dir, n)));
    const withVideos = await open(fs);
    const first = lit(withVideos.emu, 44, 66, 248, 274);
    assert.ok(first > 1500, `Vault Boy video on screen (${first} lit pixels)`);
    assert.ok(lit(withVideos.emu, 280, 66, 440, 270) > 300, 'the gauge, level and karma beside it');
    // the count and hint under the column ("1/2  WHEEL: CHANGE") are only drawn when there are videos
    assert.ok(lit(withVideos.emu, 280, 262, 440, 276) > 60, 'the video count and wheel hint');
    withVideos.emu.turnEncoder('knob1', 1); // the wheel: the next animation
    await sleep(1500);
    assert.ok(lit(withVideos.emu, 44, 66, 248, 274) > 1500, 'the second video plays');
    assert.doesNotMatch(withVideos.output, /Uncaught|ERROR:/);

    const without = await open(new MemFS());
    assert.ok(lit(without.emu, 44, 66, 248, 274) > 1500, 'the drawn figure and limb bars');
    assert.equal(lit(without.emu, 280, 262, 440, 276), 0, 'no video hint without videos');
    assert.doesNotMatch(without.output, /Uncaught|ERROR:/);
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
