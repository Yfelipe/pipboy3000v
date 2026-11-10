// The emulator page: wires an Espruino instance (runtime/espruino.js) to a canvas, a
// terminal and the board's controls, and loads programs, dumps and SD card files into it.
import { Espruino, rgb565ToRgba } from '../runtime/espruino.js';
import { MemFS } from '../runtime/memfs.js';
import { BOARDS } from '../runtime/boards.js';
import { loadDumpSd, loadDumpStorage } from '../runtime/dump.js';
import { Terminal } from './terminal.js';

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
    onReboot: () => terminal.write('\r\n[reboot]\r\n'),
  });
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
      ledPins.set(emu.pin(info.pin), el); // off until the program drives the pin
    }
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

async function loadDump(label, manifest, readFile) {
  const boardId = manifest.device?.env?.BOARD === 'PIPBOY' ? 'pipboy' : 'espruino';
  const fs = new MemFS();
  setStatus(`Copying SD card from ${label}…`);
  const sd = await loadDumpSd(manifest, readFile, fs, {
    onProgress: (done, total) => setStatus(`Copying SD card from ${label}… ${done}/${total}`),
  });
  await start(boardId, fs);
  await loadDumpStorage(manifest, readFile, emu);
  loaded = label + (sd.skipped.length ? ` (${sd.skipped.length} large SD files not in the dump)` : '');
  updateStatus();
  showSdSummary(sd.skipped);
  showTab('console');
}

async function listDumps() {
  const select = el.dumps;
  let dumps = null;
  try {
    const res = await fetch('/api/dumps');
    if (res.ok) ({ dumps } = await res.json());
  } catch {}
  if (!Array.isArray(dumps)) {
    // Not served by the companion dashboard: only folder loading is available
    select.replaceChildren(new Option('Dashboard not available', ''));
  } else {
    const usable = dumps?.filter((d) => d.complete);
    select.replaceChildren(...usable.map((d) => new Option(`${d.id} · ${d.version ?? '?'}`, d.id)));
    if (!usable.length) select.replaceChildren(new Option('No complete dumps yet', ''));
    const last = prefs.get('dump');
    if (last && usable.some((d) => d.id === last)) select.value = last;
  }
  el.loadDump.disabled = !select.value;
}

el.loadDump.addEventListener('click', action(async () => {
  const id = el.dumps.value;
  if (!id) return;
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
for (const id of ['dump-folder', 'sd-folder']) $(id).webkitdirectory = true;

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
  if (app.board && emu.board.id !== app.board) await start(app.board, emu.fs);
  const code = await (await fetch(`/apps/${app.file}`)).text();
  // Its SD card files (the companion extras), as installing it would add them
  for (const f of app.sdFiles ?? []) {
    const r = await fetch(`/apps/${f.file}`);
    if (r.ok && emu.fs) emu.fs.writeFile(`/${f.path}`, new Uint8Array(await r.arrayBuffer()));
  }
  emu.storageWrite(app.storageName, code);
  emu.write(`load(${JSON.stringify(app.storageName)})\n`);
  el.code.value = code;
  el.appName.value = app.storageName;
  showTab('console');
  canvas.focus();
}

/** Return the catalog, or [] when the page isn't served by the dashboard. */
async function fetchApps() {
  const res = await fetch('/apps/index.json');
  if (!res.ok) throw new Error(res.statusText);
  return (await res.json()).apps;
}

async function listApps() {
  const box = $('apps');
  try {
    const apps = await fetchApps();
    box.replaceChildren(...apps.map((app) => {
      const row = Object.assign(document.createElement('div'), { className: 'app' });
      const install = Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Install & run' });
      install.addEventListener('click', action(() => runApp(app)));
      row.append(
        Object.assign(document.createElement('strong'), { textContent: app.name }),
        Object.assign(document.createElement('p'), { className: 'note', textContent: app.description }),
        install,
      );
      return row;
    }));
    if (!apps.length) box.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'No apps.' }));
  } catch {
    box.replaceChildren(Object.assign(document.createElement('p'), { className: 'note', textContent: 'Apps are listed when the page is served by the dashboard.' }));
  }
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

// ---------------------------------------------------------------- go

for (const board of Object.values(BOARDS)) el.board.append(new Option(board.name, board.id));
listDumps();
listApps();
requestAnimationFrame(draw);
// ?app=<id> (the dashboard's "Try in emulator") installs and runs that catalog app.
const wantedApp = new URLSearchParams(location.search).get('app');
action(async () => {
  await start(BOARDS[prefs.get('board')] ? prefs.get('board') : 'espruino');
  if (!wantedApp) return;
  const app = (await fetchApps()).find((a) => a.id === wantedApp);
  if (!app) throw new Error(`No app "${wantedApp}" in apps/index.json`);
  await runApp(app);
})();
