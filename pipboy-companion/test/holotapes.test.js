// Holotapes (apps/holotapes): small apps the stock interface runs from the SD card's USER
// folder. Each is run here the way INV > APPS runs it (eval of the file), on the emulated
// Pip-Boy, with a stand-in for the firmware's page buffer that records what is drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Espruino } from '../emulator/runtime/espruino.js';
import { BOARDS } from '../emulator/runtime/boards.js';
import { MemFS } from '../emulator/runtime/memfs.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// bC: every drawing call is accepted; the strings of the latest frame are kept in S
const PAGE_BUFFER =
  'var S=[];var bC={};' +
  '"clear,setFontMonofonto16,setFontMonofonto18,setFontMonofonto23,setFontAlign,setColor,fillRect,drawRect,drawLine,setFontMonofonto36,drawCircle,fillCircle,fillPoly,flip"' +
  '.split(",").forEach(function(m){bC[m]=function(){if(m=="clear")S=[];return bC}});' +
  'bC.drawString=function(s){S.push(String(s));return bC};bC.buffer=new Uint8Array(21000).buffer;';

async function holotape(t, file, before = '', extra = [], prepare = () => {}) {
  const fs = new MemFS();
  fs.mkdirp('/USER');
  prepare(fs);
  for (const rel of extra) {
    fs.mkdirp('/' + path.dirname(rel));
    fs.writeFile('/' + rel, await readFile(path.join(ROOT, 'apps/holotapes/sd', rel)));
  }
  fs.writeFile(`/USER/${file}`, await readFile(path.join(ROOT, 'apps/holotapes/sd/USER', file)));
  let out = '';
  const emu = await Espruino.start({ board: BOARDS.pipboy, wasm: await readFile(path.join(ROOT, 'emulator/dist/pipboy_wasm.wasm')), fs, onOutput: (x) => { out += x; } });
  t.after(() => emu.stop());
  const run = async (code) => {
    out = '';
    emu.write(`\x10print("R="+JSON.stringify(${code})+"=R")\n`);
    for (let i = 0; i < 40 && !/=R/.test(out); i++) await sleep(25);
    const m = /R=(.*)=R/.exec(out);
    assert.ok(m, `no reply from the Pip-Boy: ${out}`);
    return JSON.parse(m[1]);
  };
  emu.write(`\x10${PAGE_BUFFER}${before}\n`);
  await run(`(eval(require("fs").readFile("USER/${file}")),1)`); // as the stock APPS menu runs it
  return { run, frame: () => run('S'), fs };
}

const likeness = (a, b) => [...a].filter((c, i) => c === b[i]).length;

test('holotape catalogue: every file exists, and the names fit the stock APPS menu', async () => {
  const index = JSON.parse(await readFile(path.join(ROOT, 'apps/index.json'), 'utf8'));
  assert.ok(index.holotapes.length >= 1);
  for (const h of index.holotapes) {
    assert.match(h.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(h.name && h.description);
    const launcher = h.files.find((f) => /^USER\/[A-Z0-9]{1,8}\.JS$/.test(f.path));
    assert.ok(launcher, `${h.id}: needs a USER/<8.3 name>.JS file (what INV > APPS lists)`);
    for (const f of h.files) {
      assert.match(f.path, /^(USER|APPINFO|CLOCK|LEVELUP)\/[A-Za-z0-9]{1,8}\.(JS|json|IMG|WAV)$/, `${h.id}: ${f.path} (8.3 names: the SD card is FAT)`);
      assert.ok((await readFile(path.join(ROOT, 'apps', f.file))).length > 0, f.file);
    }
    // APPINFO/<ID>.json gives the menu its display name; id is the launcher's name without .JS
    const info = h.files.find((f) => f.path.startsWith('APPINFO/'));
    const meta = JSON.parse(await readFile(path.join(ROOT, 'apps', info.file), 'utf8'));
    assert.equal(`USER/${meta.id}.JS`, launcher.path);
    assert.ok(meta.name);
  }
});

test('terminal hacking: its word list is 6-letter words with no repeats', async () => {
  const src = await readFile(path.join(ROOT, 'apps/holotapes/hack.js'), 'utf8');
  const words = /var WORDS = \(([\s\S]*?)\)\.split/.exec(src)[1].replace(/["+\s]/g, '').split(',');
  assert.ok(words.length >= 40);
  assert.equal(new Set(words).size, words.length);
  for (const w of words) assert.match(w, /^[A-Z]{6}$/);
});

test('terminal hacking: deals 8 words, scores each guess by likeness, and ends in or locked out', async (t) => {
  const { run, frame } = await holotape(t, 'HACKING.JS');
  let s = await frame();
  assert.ok(s.includes('ROBCO TERMLINK'));
  const words = s.filter((x) => /^[A-Z]{6}$/.test(x));
  assert.equal(new Set(words).size, 8, 'eight different words');
  assert.ok(s.includes('WHEEL: CHOOSE   PRESS: GUESS'));

  const guesses = [];
  for (let i = 0; i < 4; i++) {
    await run('(Pip.emit("knob1",0),1)'); // press: guess the highlighted word
    s = await frame();
    guesses.push(words[i]);
    if (s.includes('ACCESS GRANTED') || s.includes('TERMINAL LOCKED')) break;
    await run('(Pip.emit("knob1",-1),1)'); // wheel: next word
  }
  const log = s.filter((x) => x.startsWith('>'));
  if (s.includes('ACCESS GRANTED')) {
    assert.ok(log.includes('>EXACT MATCH'));
    assert.equal(log[log.indexOf('>EXACT MATCH') - 1], `>${guesses.at(-1)}`);
  } else {
    assert.equal(guesses.length, 4, 'locked after four wrong guesses');
    const answer = /^>([A-Z]{6}) WAS IT$/.exec(log.at(-1))[1];
    assert.ok(words.includes(answer) && !guesses.includes(answer));
    // the last three guesses are still on screen with their likeness
    for (const g of guesses.slice(-2)) assert.equal(log[log.indexOf(`>${g}`) + 1], `>DENIED ${likeness(g, answer)}/6`);
  }
  assert.ok(s.includes('PRESS THE WHEEL TO PLAY AGAIN'));

  // Press again: a new game. Guessing the same word twice costs nothing.
  await run('(Pip.emit("knob1",0),1)');
  s = await frame();
  assert.ok(!s.some((x) => x.startsWith('>')), 'the log is empty in a new game');
  // Leaving (the thumbwheel or mode dial calls Pip.removeSubmenu) gives the wheel back
  assert.equal(await run('(Pip.removeSubmenu(),Pip.emit("knob1",0),S.filter(function(x){return x[0]==">"}).length)'), 0);
});

test('lockpicking: the lock opens on the sweet spot, binds off it, and a worn pin breaks', async (t) => {
  // Math.random fixed at 0.5 puts the sweet spot at 92 degrees; the pin starts at 90
  const { run, frame } = await holotape(t, 'LOCKPICK.JS', 'Math.random=function(){return 0.5};');
  let s = await frame();
  assert.ok(s.includes('LOCKPICKING') && s.includes('LOCK: NOVICE'));
  await run('(Pip.emit("knob1",0),1)'); // try the lock where the pin is
  s = await frame();
  assert.ok(s.includes('LOCK OPENED') && s.includes('TURNED 100%'), JSON.stringify(s));
  await run('(Pip.emit("knob1",0),1)'); // on to the next lock
  s = await frame();
  assert.ok(s.includes('LOCK: ADVANCED') && s.includes('FIND THE SWEET SPOT'));

  // Ten clicks of the wheel: 40 degrees off. The lock turns part of the way and binds.
  await run('(function(){for(var i=0;i<10;i++)Pip.emit("knob1",1);return 1})()');
  await run('(Pip.emit("knob1",0),1)');
  s = await frame();
  assert.ok(s.includes('IT BINDS'));
  const far = Number(/TURNED (\d+)%/.exec(s.join(' '))[1]);
  assert.ok(far > 0 && far < 90, `turned ${far}%`);
  // Closer to the sweet spot it turns further
  await run('(function(){for(var i=0;i<5;i++)Pip.emit("knob1",-1);Pip.emit("knob1",0);return 1})()');
  s = await frame();
  assert.ok(Number(/TURNED (\d+)%/.exec(s.join(' '))[1]) > far);
  // Two more tries that bind wear the pin out
  await run('(function(){Pip.emit("knob1",0);Pip.emit("knob1",0);return 1})()');
  s = await frame();
  assert.ok(s.includes('THE PIN BROKE'), JSON.stringify(s));
  assert.equal(await run('(Pip.removeSubmenu(),1)'), 1);
});

test('Cap Collector: caps in the crate score, nukes cost lives, and leaving stops the game', async (t) => {
  // Math.random fixed at 0.5: every item is a cap falling down the middle, where the crate starts
  const { run, frame } = await holotape(t, 'CAPS.JS', 'Math.random=function(){return 0.5};');
  assert.ok((await frame()).includes('WHEEL: MOVE   PRESS: START'));
  await run('(Pip.emit("knob1",0),1)');
  await sleep(4500);
  let s = await frame();
  const caps = Number(/CAPS (\d+)/.exec(s.join(' '))[1]);
  assert.ok(caps >= 1, `caught ${caps}`);
  // Now everything is a mini nuke at the left; move the crate under them (6 clicks up = left)
  await run('(function(){Math.random=function(){return 0.1};for(var i=0;i<6;i++)Pip.emit("knob1",1);return 1})()');
  for (let i = 0; i < 30 && !(s = await frame()).includes('GAME OVER'); i++) await sleep(500);
  assert.ok(s.includes('GAME OVER'), JSON.stringify(s));
  assert.ok(s.some((x) => /^\d+ CAPS   BEST \d+$/.test(x)));
  // play again, then leave: the interval is cleared, so the screen stops changing
  await run('(Pip.emit("knob1",0),Pip.removeSubmenu(),S=["left"],1)');
  await sleep(400);
  assert.deepEqual(await frame(), ['left']);
});

test('FM scan: finds the stations that stand out, saves them, tunes, and leaves the radio as it was', async (t) => {
  // a stand-in for the firmware's radio: two stations (and a weaker neighbour) over a noise floor
  const radio = 'global.rd={f:0,on:false,enable:function(v){this.on=!!v;Pip.radioOn=!!v},freqSet:function(f){this.f=f},' +
    'getRSSI:function(){var f=this.f;return Math.abs(f-101.7)<0.05?60:Math.abs(f-96.3)<0.05?50:Math.abs(f-101.6)<0.05?30:12}};';
  const { run, frame, fs } = await holotape(t, 'FMSCAN.JS', radio);
  assert.ok((await frame()).includes('PRESS THE WHEEL TO SCAN (ABOUT 10 S)'));
  await run('(Pip.emit("knob1",0),1)');
  await sleep(1000);
  assert.equal(await run('rd.on'), true, 'the radio is on while scanning');
  let s = [];
  for (let i = 0; i < 40 && !(s = await frame()).some((x) => /MHZ$/.test(x) && x !== '87.5 - 108.0 MHZ'); i++) await sleep(500);
  assert.deepEqual(s.filter((x) => /^\d+\.\d MHZ/.test(x)), ['96.3 MHZ', '101.7 MHZ']);
  assert.equal(await run('rd.on'), false, 'and off again afterwards, as it was');
  const saved = JSON.parse(new TextDecoder().decode(fs.readFile('/USER/FMSCAN.json')));
  assert.deepEqual(saved.stations.map((x) => x.frequency), [96.3, 101.7]);
  await run('(Pip.emit("knob1",-1),Pip.emit("knob1",0),1)'); // the second station: tune
  assert.deepEqual(await run('[rd.on,rd.f]'), [true, 101.7]);
  assert.ok((await frame()).includes('101.7 MHZ <'));
  await run('(Pip.removeSubmenu(),1)');
});

test('FM scan without the stock interface says where to run it', async (t) => {
  const { frame } = await holotape(t, 'FMSCAN.JS');
  assert.ok((await frame()).includes('INTERFACE. RUN THIS FROM INV > APPS.'));
});

test('stand clock: time and date, a logo from the SD card, and a name when the image is missing', async (t) => {
  const { run, frame } = await holotape(t, 'CLOCK.JS', '', ['CLOCK/VAULTTEC.IMG']);
  let s = await frame();
  assert.ok(s.some((x) => /^\d\d:\d\d$/.test(x)), JSON.stringify(s));
  assert.ok(s.some((x) => /^[A-Z]+DAY \d+ [A-Z]{3} \d{4}$/.test(x)));
  assert.ok(!s.includes('VAULT-TEC'), 'the logo is drawn, not the name');
  assert.ok(await run('E.sum(new Uint8Array(bC.buffer))') > 0, 'the image was copied into the page buffer');
  await run('(Pip.emit("knob1",-1),1)'); // next face: its image isn't on this card
  s = await frame();
  assert.ok(s.includes('ROBCO INDUSTRIES'));
  await run('(Pip.removeSubmenu(),1)');
});

test('level up: each ticked list item earns 10 XP once, levels follow, and XP is kept on the card', async (t) => {
  const item = (id, done) => ({ id, text: id, done, updated: 1 });
  const lists = (ticked) => new TextEncoder().encode(JSON.stringify({ categories: [{ id: 'c', name: 'To do', items: [1, 2, 3, 4, 5, 6, 7].map((n) => item(`i${n}`, n <= ticked)) }] }));
  const { run, frame, fs } = await holotape(t, 'LEVELUP.JS', '', ['LEVELUP/VAULTBOY.IMG'], (f) => f.writeFile('/USER/customLists.json', lists(5)));
  let s = await frame();
  // five tasks: 50 XP, which is level 2
  assert.ok(s.includes('LEVEL UP!') && s.includes('LEVEL 2') && s.includes('+50 XP: 5 NEW') && s.includes('TASKS DONE 5 OF 7'), JSON.stringify(s));
  assert.ok(s.includes('50 / 150 XP'));
  assert.ok(await run('E.sum(new Uint8Array(bC.buffer))') > 0, 'Vault Boy was copied into the page buffer');
  let saved = JSON.parse(new TextDecoder().decode(fs.readFile('/USER/XP.json')));
  assert.equal(saved.xp, 50);
  assert.deepEqual(Object.keys(saved.seen).sort(), ['i1', 'i2', 'i3', 'i4', 'i5']);
  // counting again gives nothing twice
  await run('(Pip.emit("knob1",0),1)');
  s = await frame();
  assert.ok(s.includes('NOTHING NEW YET') && !s.includes('LEVEL UP!') && s.includes('LEVEL 2'));
  // one more ticked, one unticked: +10, and nothing is taken away
  fs.writeFile('/USER/customLists.json', new TextEncoder().encode(JSON.stringify({ categories: [{ id: 'c', name: 'To do', items: [item('i1', false), item('i6', true)] }] })));
  await run('(Pip.emit("knob1",0),1)');
  s = await frame();
  assert.ok(s.includes('+10 XP: 1 NEW') && s.includes('60 / 150 XP') && s.includes('TASKS DONE 1 OF 2'), JSON.stringify(s));
  await run('(Pip.removeSubmenu(),1)');
});
