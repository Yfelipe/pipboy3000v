// The emulator page: wires an Espruino instance (runtime/espruino.js) to a canvas, a
// terminal and the board's controls, and loads programs, dumps and SD card files into it.
import { Espruino, rgb565ToRgba } from '../runtime/espruino.js';
import { MemFS } from '../runtime/memfs.js';
import { BOARDS } from '../runtime/boards.js';
import { loadDumpSd, loadDumpStorage } from '../runtime/dump.js';
import { pipOsUpdatePlan, pipOsReleaseList, PIPOS_VARIANTS, pipOsVariant, pipOsVariantFor } from '../runtime/pipos.js';
import { unzip } from '../runtime/unzip.js';
import { Terminal } from './terminal.js';
import { AudioOut } from './audio.js';

const $ = (id) => document.getElementById(id);
// Elements used in more than one place, looked up once
const el = {
  code: $('code'),
  board: $('board'),
  appName: $('app-name'),
  terminal: $('terminal'),
  status: $('status'),
  sdSummary: $('sd-summary'),
  loadDump: $('load-dump'),
  dumps: $('dumps'),
};
const canvas = $('screen');
const ctx = canvas.getContext('2d');
const terminal = new Terminal(el.terminal, (data) => emu?.write(data));

const modules = new Map(); // board id -> compiled WebAssembly.Module
let emu = null;
let image = null; // ImageData the size of the screen
let ledPins = new Map(); // pin number -> LED element
let meterPins = new Map(); // pin number -> meter element (analogWrite gauges)
let loaded = ''; // what was loaded, for the status line

// ---------------------------------------------------------------- preferences (per browser)

const prefs = {
  get(key) {
    try { return localStorage.getItem(`emulator.${key}`); } catch { return null; }
  },
  set(key, value) {
    try { localStorage.setItem(`emulator.${key}`, value); } catch {}
  },
};

// ---------------------------------------------------------------- starting a board

async function wasmFor(board) {
  if (!modules.has(board.id)) {
    const response = await fetch(`dist/${board.wasm}`);
    if (!response.ok) throw new Error(`dist/${board.wasm}: ${response.status} (run emulator/build.sh)`);
    modules.set(board.id, await WebAssembly.compileStreaming(response));
  }
  return modules.get(board.id);
}

/**
 * Which Pip-Boy to start for the starter, a dump or Pip-OS: the one with 512 KB of Storage
 * (emulator only, so Pip-OS and both apps fit) unless "Extra Storage" is unticked.
 */
const pipboyId = () => (prefs.get('xl') === '0' ? 'pipboy' : 'pipboy-xl');
const isPipboy = (board) => board?.family === 'pipboy';

/** Start `boardId` with an SD card (MemFS); replaces the running emulator. */
async function start(boardId, fs = new MemFS()) {
  const board = BOARDS[boardId];
  emu?.stop();
  emu = null;
  terminal.clear();
  setStatus(`Starting ${board.name}…`);
  emu = await Espruino.start({
    board,
    wasm: await wasmFor(board),
    fs,
    onOutput: (text) => terminal.write(text),
    onLog: (text) => console.debug(`[${board.id}] ${text.trimEnd()}`),
    onPinChange: (pin, level) => showLed(pin, level),
    onAnalogOut: (pin, duty) => showMeter(pin, duty),
    onAudio: (samples, rate) => audioOut.push(samples, rate),
    onReboot: () => terminal.write('\r\n[reboot]\r\n'),
  });
  // The FO3 prototype: what its native firmware provides (.boot0), and a control test as boot
  // code until FO3 firmware is added
  if (board.boot0 || board.demo) {
    for (const [name, url] of [['.boot0', board.boot0], ['.bootcde', board.demo]]) {
      const res = url && (await fetch(url));
      if (res?.ok) emu.storageWrite(name, new Uint8Array(await res.arrayBuffer()));
    }
    emu.reboot();
  }
  el.board.value = board.id;
  prefs.set('board', board.id);
  canvas.width = emu.lcd.width;
  canvas.height = emu.lcd.height;
  image = ctx.createImageData(emu.lcd.width, emu.lcd.height);
  buildControls(board);
  loaded = '';
  updateStatus();
}

function setStatus(text, isError = false) {
  el.status.textContent = text;
  el.status.classList.toggle('error', isError);
}

function updateStatus() {
  setStatus(`${emu.board.name}${loaded ? ` · ${loaded}` : ''}`);
}

/** Run an async UI action, reporting failures in the status line. */
function action(fn) {
  return async (event) => {
    const button = event?.currentTarget instanceof HTMLButtonElement ? event.currentTarget : null;
    if (button) button.disabled = true;
    try {
      await fn(event);
    } catch (err) {
      console.error(err);
      setStatus(err.message, true);
    } finally {
      if (button) button.disabled = false;
    }
  };
}

// ---------------------------------------------------------------- display

function draw() {
  if (emu && image) {
    const rect = emu.takeDirty();
    if (rect) {
      rgb565ToRgba(emu.pixels, emu.lcd.width, rect, image.data);
      ctx.putImageData(image, 0, 0, rect.x1, rect.y1, rect.x2 - rect.x1 + 1, rect.y2 - rect.y1 + 1);
    }
  }
  requestAnimationFrame(draw);
}

// ---------------------------------------------------------------- controls

const keyActions = new Map(); // KeyboardEvent.code -> { down, up }

function buildControls(board) {
  const box = $('controls');
  box.replaceChildren();
  keyActions.clear();
  ledPins = new Map();
  meterPins = new Map();

  const group = (label) => {
    const el = document.createElement('div');
    el.className = 'control';
    el.append(Object.assign(document.createElement('span'), { className: 'label', textContent: label }));
    box.append(el);
    return el;
  };
  const button = (text, key) => {
    const b = document.createElement('button');
    b.textContent = text;
    if (key) b.append(' ', Object.assign(document.createElement('kbd'), { textContent: keyName(key) }));
    return b;
  };

  for (const [id, info] of Object.entries(board.buttons ?? {})) {
    const b = button(info.label, info.key);
    const press = (down) => {
      emu.setButton(id, down);
      b.classList.toggle('active', down);
    };
    b.addEventListener('pointerdown', (e) => { b.setPointerCapture(e.pointerId); press(true); });
    b.addEventListener('pointerup', () => press(false));
    b.addEventListener('pointercancel', () => press(false));
    box.append(b);
    if (info.key) keyActions.set(info.key, { down: () => press(true), up: () => press(false) });
  }

  for (const [id, info] of Object.entries(board.encoders ?? {})) {
    const g = group(info.label);
    [-1, 1].forEach((dir, i) => {
      const b = button(dir < 0 ? '◀' : '▶', info.keys?.[i]);
      b.addEventListener('click', () => emu.turnEncoder(id, dir));
      g.append(b);
      if (info.keys?.[i]) keyActions.set(info.keys[i], { down: () => emu.turnEncoder(id, dir), repeat: true });
    });
  }

  for (const [id, info] of Object.entries(board.selectors ?? {})) {
    const g = group(info.label);
    const buttons = info.positions.map((pos, index) => {
      const b = button(pos.label, info.keys?.[index]);
      b.addEventListener('click', () => select(index));
      g.append(b);
      if (info.keys?.[index]) keyActions.set(info.keys[index], { down: () => select(index) });
      return b;
    });
    const select = (index) => {
      emu.setSelector(id, index);
      buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === index)));
    };
    select(emu.selectorPositions[id] ?? 0);
  }

  const leds = Object.entries(board.leds ?? {});
  if (leds.length) {
    const g = group('LEDs');
    for (const [name, info] of leds) {
      const el = Object.assign(document.createElement('span'), { className: 'led', title: name });
      el.style.setProperty('--c', info.color);
      el.dataset.activeLow = info.activeLow ? '1' : '';
      g.append(el);
      ledPins.set(emu.pin(info.pin), el);
      const pin = emu.pin(info.pin);
      if (emu.levels.has(pin)) showLed(pin, emu.levels.get(pin)); // as the program left it (e.g. boot code that already ran)
    }
  }

  // A board with an accelerometer (the FO3): tap it, or shake it for a second
  if (board.motion) {
    const g = group('Motion');
    const tap = button('Tap', 'KeyA');
    const doTap = () => emu.tap();
    tap.addEventListener('click', doTap);
    keyActions.set('KeyA', { down: doTap });
    const shake = button('Shake', 'KeyK');
    const doShake = () => {
      let n = 0;
      const t = setInterval(() => {
        const r = () => (Math.random() * 2 - 1) * 1.5;
        emu.setAcceleration(r(), r(), 1 + r());
        if (++n >= 20) { clearInterval(t); emu.setAcceleration(0, 0, 1); }
      }, 50);
    };
    shake.addEventListener('click', doShake);
    keyActions.set('KeyK', { down: doShake });
    g.append(tap, shake);
  }

  // analogWrite() outputs as needle gauges, for boards that list meters
  for (const info of Object.values(board.meters ?? {})) {
    const g = group(info.label);
    const el = Object.assign(document.createElement('span'), { className: 'meter', title: `${info.label} (analogWrite on ${info.pin})` });
    el.append(Object.assign(document.createElement('i'), { className: 'needle' }));
    g.append(el);
    meterPins.set(emu.pin(info.pin), el);
    if (info.light) {
      ledPins.set(emu.pin(info.light), el); // its backlight lights the dial
      if (emu.levels.has(emu.pin(info.light))) showLed(emu.pin(info.light), emu.levels.get(emu.pin(info.light)));
    }
    showMeter(emu.pin(info.pin), emu.analogOut.get(emu.pin(info.pin)) ?? 0);
  }

  const firstEncoder = Object.keys(board.encoders ?? {})[0];
  canvas.onwheel = firstEncoder
    ? (e) => { e.preventDefault(); emu.turnEncoder(firstEncoder, Math.sign(e.deltaY)); }
    : null;
  $('hint').hidden = keyActions.size === 0;
}

function keyName(code) {
  return code.replace(/^Key|^Digit/, '').replace('Arrow', '').replace('BracketLeft', '[').replace('BracketRight', ']')
    .replace('Period', '.').replace('Comma', ',').replace('Escape', 'Esc');
}

function showMeter(pin, duty) {
  const el = meterPins.get(pin);
  if (el) el.style.setProperty('--duty', String(Math.max(0, Math.min(1, duty))));
}

function showLed(pin, level) {
  const el = ledPins.get(pin);
  if (el) el.classList.toggle('on', el.dataset.activeLow ? !level : !!level);
}

canvas.addEventListener('keydown', (e) => {
  const act = keyActions.get(e.code);
  if (!act || e.metaKey || e.ctrlKey || e.altKey) return;
  e.preventDefault();
  if (e.repeat && !act.repeat) return;
  act.down();
});
canvas.addEventListener('keyup', (e) => keyActions.get(e.code)?.up?.());
canvas.addEventListener('blur', () => keyActions.forEach((a) => a.up?.()));
canvas.addEventListener('pointerdown', () => canvas.focus());

// ---------------------------------------------------------------- programs

/** Type a program into the REPL. Ctrl-P (0x10) at the start of a line stops it being echoed. */
function sendToRepl(code) {
  emu.write('\x10' + code.replace(/\r?\n/g, '\n\x10') + '\n');
}

$('run-ram').addEventListener('click', () => {
  emu.write('\x10reset();\n');
  sendToRepl(el.code.value);
  showTab('console');
});

$('run-flash').addEventListener('click', action(() => {
  emu.storageWrite('.bootcde', el.code.value);
  emu.reboot();
  showTab('console');
}));

$('run-app').addEventListener('click', action(() => {
  const name = el.appName.value.trim();
  if (!name || name.length > 28 || /["\\]/.test(name)) throw new Error('Storage names are 1 to 28 characters, without quotes');
  emu.storageWrite(name, el.code.value);
  emu.write(`load(${JSON.stringify(name)})\n`);
  showTab('console');
}));

$('open-js').addEventListener('change', action(async (e) => {
  const file = e.target.files[0];
  if (file) {
    el.code.value = await file.text();
    el.appName.value = file.name.slice(-28);
  }
  e.target.value = '';
}));

$('reset').addEventListener('click', () => emu.write('reset();\n'));
$('reboot').addEventListener('click', action(() => emu.reboot()));
$('ctrl-c').addEventListener('click', () => emu.write('\x03'));
$('clear-terminal').addEventListener('click', () => terminal.clear());
el.board.addEventListener('change', action(() => start(el.board.value)));

// ---------------------------------------------------------------- dumps, SD card, Storage

/** Storage file name -> size, for what the last dump put there (so runApp can tell an app is already installed). */
const inStorage = new Map();

async function loadDump(label, manifest, readFile, { asFarAsFits = false } = {}) {
  const boardId = manifest.device?.env?.BOARD === 'PIPBOY' ? pipboyId() : 'espruino';
  const fs = new MemFS();
  setStatus(`Copying SD card from ${label}…`);
  const sd = await loadDumpSd(manifest, readFile, fs, {
    onProgress: (done, total) => setStatus(`Copying SD card from ${label}… ${done}/${total}`),
  });
  await start(boardId, fs);
  const left = await loadDumpStorage(manifest, readFile, emu, { asFarAsFits });
  inStorage.clear();
  for (const f of manifest.storage ?? []) if (!left.includes(f.name)) inStorage.set(f.name, f.size);
  loaded = label + (sd.skipped.length ? ` (${sd.skipped.length} large SD files not in the dump)` : '') +
    (left.length ? ` (no room for ${left.join(', ')} in 128 KB of Storage: tick Extra Storage on the Load tab)` : '');
  updateStatus();
  showSdSummary(sd.skipped);
  showTab('console');
}

// The starter Pip-Boy (emulator/starter, made by scripts/build-starter.mjs): the companion's
// apps and sample files, no device needed. Pip-OS isn't in it; see addPipOs below.
const STARTER = 'starter';
const starterFile = async (rel) => {
  const res = await fetch(`starter/${rel.split('/').map(encodeURIComponent).join('/')}`);
  if (!res.ok) throw new Error(`starter/${rel}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};
async function loadStarter() {
  const manifest = JSON.parse(new TextDecoder().decode(await starterFile('manifest.json')));
  // On the 128 KB Pip-Boy not every app fits; the menu lists only the ones in Storage
  await loadDump('Starter Pip-Boy (no Pip-OS: add the official update on the Load tab)', manifest, starterFile, { asFarAsFits: true });
}

/**
 * Add the official Pip-OS update (the unzipped folder from The Wand Company): its files go on
 * the SD card, FW.JS becomes the boot code. Storage starts again with Pip-OS, then the starter's
 * apps as far as they fit (Pip-OS takes most of the 128 KB, as on the device).
 */
async function addPipOs(bytes) {
  const plan = pipOsUpdatePlan(bytes);
  if (plan.board === 'fo3') return addFo3(plan);
  const fs = isPipboy(emu?.board) ? emu.fs : new MemFS();
  for (const [p, b] of plan.sd) fs.writeFile(p, b);
  await start(pipboyId(), fs);
  for (const [name, b] of plan.storage) emu.storageWrite(name, b);
  const starter = JSON.parse(new TextDecoder().decode(await starterFile('manifest.json')));
  const left = [];
  for (const f of starter.storage.filter((s) => s.name !== '.bootcde')) {
    try {
      emu.storageWrite(f.name, await starterFile(f.file));
    } catch {
      left.push(f.name);
    }
  }
  // an app that didn't fit leaves the APPS menu too
  for (const name of left) {
    const stem = name.replace(/\.min\.js$|\.js$/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8);
    for (const ext of ['JS', 'EXT']) if (fs.exists(`/USER/${stem}.${ext}`)) fs.remove(`/USER/${stem}.${ext}`);
  }
  terminal.clear(); // the blank-Storage boot above has nothing useful to say
  emu.reboot();
  loaded = `Pip-OS ${plan.version ?? ''}`.trim() + (left.length ? ` · no room for ${left.join(', ')}` : '');
  updateStatus();
  showTab('console');
}

/**
 * FO3 firmware (from The Wand Company's sapling zip) onto the FO3 prototype board: a fresh SD
 * card with the update's files, FW.JS as boot code, and the board's .boot0 (its pin names and
 * native stand-ins, written by start()).
 */
async function addFo3(plan) {
  const fs = new MemFS();
  for (const [p, b] of plan.sd) fs.writeFile(p, b);
  await start('fo3', fs);
  for (const [name, b] of plan.storage) emu.storageWrite(name, b);
  terminal.clear();
  emu.reboot();
  loaded = `FO3 firmware ${plan.version ?? ''}`.trim();
  updateStatus();
  showTab('console');
}

/** The dashboard's saved copies, or null when this page isn't served by the dashboard. */
async function fetchDumps() {
  try {
    const res = await fetch('/api/dumps');
    if (!res.ok) return null;
    const { dumps } = await res.json();
    return Array.isArray(dumps) ? dumps : null;
  } catch {
    return null;
  }
}

async function listDumps() {
  const select = el.dumps;
  const dumps = await fetchDumps(); // null when the page isn't served by the dashboard
  const usable = (dumps ?? []).filter((d) => d.complete);
  select.replaceChildren(
    new Option('Starter Pip-Boy (no device needed)', STARTER),
    ...usable.map((d) => new Option(`${d.id} · ${d.version ?? '?'}`, d.id)),
  );
  const last = prefs.get('dump');
  if (last && usable.some((d) => d.id === last)) select.value = last;
  el.loadDump.disabled = !select.value;
}

el.loadDump.addEventListener('click', action(async () => {
  const id = el.dumps.value;
  if (!id) return;
  if (id === STARTER) {
    prefs.set('dump', id);
    return loadStarter();
  }
  const base = `/api/dumps/${encodeURIComponent(id)}/files/`;
  const readFile = async (rel) => {
    const res = await fetch(base + rel.split('/').map(encodeURIComponent).join('/'));
    if (!res.ok) throw new Error(`${rel}: ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  const manifest = JSON.parse(new TextDecoder().decode(await readFile('manifest.json')));
  prefs.set('dump', id);
  await loadDump(id, manifest, readFile);
}));

/** Files from an <input webkitdirectory>, keyed by path relative to the chosen folder. */
function folderFiles(input) {
  const files = new Map();
  for (const file of input.files) {
    const rel = file.webkitRelativePath.split('/').slice(1).join('/');
    if (rel && !rel.split('/').some((part) => part.startsWith('.'))) files.set(rel, file);
  }
  input.value = '';
  return files;
}

// Folder pickers: webkitdirectory isn't in the HTML standard (every current browser has it), so it's set here
for (const id of ['dump-folder', 'sd-folder', 'pipos-folder']) $(id).webkitdirectory = true;

$('pipos-folder').addEventListener('change', action(async (e) => {
  const bytes = new Map();
  for (const [rel, file] of folderFiles(e.target)) bytes.set(rel, new Uint8Array(await file.arrayBuffer()));
  await addPipOs(bytes);
}));
$('pipos-zip').addEventListener('change', action(async (e) => {
  const [file] = e.target.files;
  e.target.value = '';
  if (!file) return;
  setStatus(`Unpacking ${file.name}…`);
  await addPipOs(await unzip(new Uint8Array(await file.arrayBuffer())));
}));

// ---------------------------------------------------------------- Pip-OS download
// Variant and version selects from The Wand Company's release indexes. The link stays on their
// upgrade page until a release list arrives.
const pipos = { variant: $('pipos-variant'), version: $('pipos-version'), link: $('pipos-download'), notes: $('pipos-notes'), hint: $('pipos-hint') };
let piposReleases = [];

async function releasesFor(variant) {
  // through the dashboard's server when there is one (The Wand Company's CDN needn't let pages read it)
  try {
    const res = await fetch(`/api/pipos-releases?variant=${encodeURIComponent(variant.id)}`);
    if (res.ok) return (await res.json()).releases;
  } catch {}
  return pipOsReleaseList({ feed: variant.feed }); // a copy of the page opened on its own
}

function showRelease() {
  const r = piposReleases[pipos.version.selectedIndex];
  const ok = r?.zipUrl?.startsWith('https://cdn.thewandcompany.com/');
  pipos.link.href = ok ? r.zipUrl : 'https://www.thewandcompany.com/pip-boy/upgrade/';
  pipos.link.textContent = ok ? `Download ${r.zipFile}` : 'Get Pip-OS from The Wand Company';
  pipos.notes.hidden = !(ok && r.notesUrl);
  if (ok && r.notesUrl) pipos.notes.href = r.notesUrl;
}

async function listReleases() {
  const variant = pipOsVariant(pipos.variant.value) ?? PIPOS_VARIANTS[0];
  prefs.set('pipos-variant', variant.id);
  pipos.hint.textContent = variant.board === 'fo3'
    ? 'FO3 firmware runs on the FO3 prototype board (a best guess at its hardware): adding the zip switches to it.'
    : '';
  pipos.hint.hidden = !pipos.hint.textContent;
  pipos.version.replaceChildren(new Option('Loading…', ''));
  pipos.version.disabled = true;
  piposReleases = (await releasesFor(variant)) ?? [];
  if (pipos.variant.value !== variant.id) return; // changed again meanwhile
  pipos.version.replaceChildren(...(piposReleases.length
    ? piposReleases.map((r, i) => new Option(`${r.version} (${i === 0 ? 'newest' : r.date.slice(0, 10) || 'older'})`, r.version))
    : [new Option('Release list unavailable', '')]));
  pipos.version.disabled = !piposReleases.length;
  showRelease();
}

pipos.variant.replaceChildren(...PIPOS_VARIANTS.map((v) => new Option(v.name, v.id)));
pipos.variant.addEventListener('change', listReleases);
pipos.version.addEventListener('change', showRelease);
/** Pick the variant that matches the emulated SD card (their marker files), unless one was chosen. */
function defaultVariant() {
  const saved = pipOsVariant(prefs.get('pipos-variant'));
  pipos.variant.value = (saved ?? pipOsVariantFor(emu?.fs)).id;
  listReleases();
}

$('dump-folder').addEventListener('change', action(async (e) => {
  const files = folderFiles(e.target);
  const readFile = async (rel) => {
    const file = files.get(rel);
    if (!file) throw new Error(`${rel} is missing from the folder`);
    return new Uint8Array(await file.arrayBuffer());
  };
  const manifest = JSON.parse(new TextDecoder().decode(await readFile('manifest.json')));
  if (manifest.format !== 'pipboy-dump') throw new Error('That folder is not a dump (no pipboy-dump manifest.json)');
  await loadDump(e.target.files[0]?.webkitRelativePath.split('/')[0] ?? 'dump', manifest, readFile);
}));

async function runApp(app) {
  if (app.board && emu.board.id !== app.board && !(app.board === 'pipboy' && isPipboy(emu.board))) {
    await start(app.board === 'pipboy' ? pipboyId() : app.board, emu.fs);
  }
  const code = await (await fetch(`/apps/${app.file}`)).text();
  // Its SD card files (the companion extras), as installing it would add them
  for (const f of app.sdFiles ?? []) {
    const r = await fetch(`/apps/${f.file}`);
    if (r.ok && emu.fs) emu.fs.writeFile(`/${f.path}`, new Uint8Array(await r.arrayBuffer()));
  }
  const name = JSON.stringify(app.storageName);
  if (inStorage.get(app.storageName) !== new TextEncoder().encode(code).length) {
    try {
      emu.storageWrite(app.storageName, code);
      inStorage.set(app.storageName, new TextEncoder().encode(code).length);
    } catch {
      inStorage.delete(app.storageName);
      setStatus(`No room in Storage for ${app.name}, as on a real Pip-Boy with this much in it. Tick Extra Storage on the Load tab and load the starter again.`, true);
    }
  }
  emu.write(`\x10if(require("Storage").read(${name})!==undefined)load(${name})\n`);
  el.code.value = code;
  el.appName.value = app.storageName;
  canvas.focus();
}

/**
 * Run a holotape (apps/index.json "holotapes"): put its files on the SD card, then open it the
 * way the device would. The starter menu runs it itself; under Pip-OS it starts as INV > APPS
 * starts it. Anything else (one of the apps is running) has no page buffer for it to draw into.
 */
async function runHolotape(h) {
  if (!isPipboy(emu?.board) || !emu.fs) await loadStarter();
  let launcher = null;
  for (const f of h.files) {
    const r = await fetch(`/apps/${f.file}`);
    if (!r.ok) throw new Error(`${f.file}: ${r.status}`);
    emu.fs.writeFile(`/${f.path}`, new Uint8Array(await r.arrayBuffer()));
    if (/^USER\/[^/]+\.JS$/.test(f.path)) launcher = f.path.slice(5);
  }
  if (!launcher) throw new Error(`${h.name} has no USER/*.JS file`);
  const file = JSON.stringify(launcher);
  emu.write('\x10if(!global.runHolotape&&typeof submenuApps!="function")load();\n');
  await new Promise((r) => setTimeout(r, 1500)); // the starter menu is back by then
  emu.write(
    `\x10if(global.runHolotape)runHolotape(${file});` +
    `else if(typeof submenuApps=="function"&&global.bC){Pip.removeSubmenu&&Pip.removeSubmenu();delete Pip.removeSubmenu;Pip.remove&&Pip.remove();delete Pip.remove;g.clear(BGRECT);eval(require("fs").readFile("USER/"+${file}))}` +
    `else print("Holotapes run from the starter menu or the stock interface: press the power button to leave this app, then run it again.")\n`,
  );
  canvas.focus();
}

/** The catalog (apps/index.json). Throws when the page isn't served by the dashboard. */
async function fetchIndex() {
  const res = await fetch('/apps/index.json');
  if (!res.ok) throw new Error(res.statusText);
  return res.json();
}

/** Show which tile is running (null: none). */
function markRunning(id) {
  for (const tile of document.querySelectorAll('[data-launch]')) tile.setAttribute('aria-pressed', String(tile.dataset.launch === id));
}

/** The Run tab: a tile for each app and holotape. Its description shows below while it has the pointer or focus. */
async function listApps() {
  const box = $('apps'), about = $('app-about');
  let index;
  try {
    index = await fetchIndex();
  } catch {
    box.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'Apps are listed when the page is served by the dashboard.' }));
    return;
  }
  const idle = 'Point at a tile to see what it is, and click it to run it.';
  const group = (title, items, run) => {
    const section = document.createElement('section');
    const tiles = Object.assign(document.createElement('div'), { className: 'tiles' });
    for (const item of items) {
      const tile = Object.assign(document.createElement('button'), { className: 'tile', type: 'button' });
      tile.dataset.launch = item.id;
      tile.setAttribute('aria-pressed', 'false');
      tile.append(
        Object.assign(document.createElement('strong'), { textContent: item.name }),
        Object.assign(document.createElement('span'), { textContent: item.tag ?? '' }),
      );
      const describe = () => { about.textContent = `${item.name}. ${item.description}`; };
      tile.addEventListener('pointerenter', describe);
      tile.addEventListener('focus', describe);
      tile.addEventListener('click', action(async () => {
        await run(item);
        markRunning(item.id);
        describe();
      }));
      tiles.append(tile);
    }
    section.append(Object.assign(document.createElement('h2'), { textContent: title }), tiles);
    return section;
  };
  box.replaceChildren(group('Apps', index.apps, runApp), group('Holotapes', index.holotapes ?? [], runHolotape));
  about.textContent = idle;
}

async function addToSd(entries) {
  let count = 0;
  for (const [rel, file] of entries) {
    emu.fs.writeFile('/' + rel, new Uint8Array(await file.arrayBuffer()));
    count++;
  }
  el.sdSummary.textContent = `Added ${count} file${count === 1 ? '' : 's'} to the SD card.`;
}

function showSdSummary(skipped) {
  el.sdSummary.textContent = skipped.length
    ? `Not in the dump (too large to copy over USB): ${skipped.join(', ')}. Add them from a copy of the card.`
    : '';
}

$('sd-folder').addEventListener('change', action((e) => addToSd(folderFiles(e.target))));
$('sd-files').addEventListener('change', action(async (e) => {
  await addToSd([...e.target.files].map((f) => [f.name, f]));
  e.target.value = '';
}));

$('storage-files').addEventListener('change', action(async (e) => {
  for (const file of e.target.files) emu.storageWrite(file.name, new Uint8Array(await file.arrayBuffer()));
  terminal.write(`\r\n[wrote ${e.target.files.length} file(s) to Storage]\r\n`);
  e.target.value = '';
}));

$('erase-storage').addEventListener('click', () => {
  if (confirm('Erase every file in the emulated Storage? (The SD card is kept.)')) {
    inStorage.clear();
    emu.write('require("Storage").eraseAll();E.reboot();\n');
  }
});

// ---------------------------------------------------------------- tabs

function showTab(name) {
  for (const tab of document.querySelectorAll('.tabs button')) {
    const selected = tab.dataset.tab === name;
    tab.setAttribute('aria-selected', String(selected));
    $(`tab-${tab.dataset.tab}`).hidden = !selected;
  }
  if (name === 'console') el.terminal.focus();
}
for (const tab of document.querySelectorAll('.tabs button')) tab.addEventListener('click', () => showTab(tab.dataset.tab));

// ---------------------------------------------------------------- sound

const audioOut = new AudioOut();
$('sound').checked = prefs.get('sound') !== '0';
audioOut.enabled = $('sound').checked;
$('sound').addEventListener('change', (e) => {
  audioOut.enabled = e.target.checked;
  prefs.set('sound', e.target.checked ? '1' : '0');
});
$('volume').value = prefs.get('volume') ?? '0.8';
audioOut.setVolume(Number($('volume').value));
$('volume').addEventListener('input', (e) => {
  audioOut.setVolume(Number(e.target.value));
  prefs.set('volume', e.target.value);
});

// ---------------------------------------------------------------- go

for (const board of Object.values(BOARDS)) el.board.append(new Option(board.name, board.id));
$('extra-storage').checked = prefs.get('xl') !== '0';
$('extra-storage').addEventListener('change', (e) => prefs.set('xl', e.target.checked ? '1' : '0'));
listDumps();
listApps();
requestAnimationFrame(draw);
// ?app=<id> (the dashboard's "Try in emulator") installs and runs that catalog app or holotape.
const wantedApp = new URLSearchParams(location.search).get('app');
action(async () => {
  // First visit, or "Try in emulator": the starter Pip-Boy, so there's something to use without a device
  if (wantedApp || !BOARDS[prefs.get('board')]) await loadStarter();
  else await start(prefs.get('board'));
  defaultVariant();
  showTab('run'); // loading the starter or a dump shows the console; start on the launcher
  if (!wantedApp) return;
  const index = await fetchIndex();
  const app = index.apps.find((a) => a.id === wantedApp);
  const holotape = (index.holotapes ?? []).find((h) => h.id === wantedApp);
  if (!app && !holotape) throw new Error(`No app "${wantedApp}" in apps/index.json`);
  if (app) await runApp(app);
  else await runHolotape(holotape);
  markRunning(wantedApp);
})();
