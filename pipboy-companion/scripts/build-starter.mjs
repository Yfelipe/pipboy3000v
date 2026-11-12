// Build emulator/starter/: a Pip-Boy for the emulator that needs no device, in the same format
// as a dashboard dump (see emulator/runtime/dump.js). It holds only this project's own files:
// the companion's apps with their extras, its holotapes, a small boot menu (emulator/starter-src/launcher.js),
// sample notes, lists, messages and radio presets, and the Vault Boy STAT videos from
// assets/official/STAT. No Pip-OS: it belongs to The Wand Company. Add the official update (https://www.thewandcompany.com/pip-boy/upgrade/) on the emulator's Load tab
// to run the stock interface.
//
// Run: npm run starter:build (also part of npm run apps:build)
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'emulator', 'starter');
const read = (rel) => readFile(path.join(ROOT, rel));
const text = (s) => new TextEncoder().encode(s);
const json = (v) => text(JSON.stringify(v));

const now = Date.UTC(2026, 10, 1, 12); // fixed, so a rebuild only changes what really changed
const H = 3600_000;

// [name in Storage, file in the starter folder (no leading dots: they aren't served), bytes]
const storage = [
  ['.bootcde', 'storage/bootcde.js', await read('emulator/starter-src/launcher.js')],
  ['mojave.min.js', 'storage/mojave.min.js', await read('apps/mojave/mojave.min.js')],
  ['pipos-x.min.js', 'storage/pipos-x.min.js', await read('apps/pipos-x/pipos-x.min.js')],
  ['capital.min.js', 'storage/capital.min.js', await read('apps/capital/capital.min.js')],
  ['pip2000.min.js', 'storage/pip2000.min.js', await read('apps/pip2000/pip2000.min.js')],
  ['endurance.min.js', 'storage/endurance.min.js', await read('apps/endurance/endurance.min.js')],
  ['tars.min.js', 'storage/tars.min.js', await read('apps/tars/tars.min.js')],
  ['companion-radio.json', 'storage/companion-radio.json', json([
    { name: 'Radio New Vegas', frequency: 101.7 },
    { name: 'Diamond City Radio', frequency: 96.3 },
    { name: 'Classical Radio', frequency: 88.9 },
  ])],
];

const holotapes = JSON.parse(await read('apps/index.json')).holotapes ?? [];
const holotapeFiles = [];
for (const h of holotapes) for (const f of h.files) holotapeFiles.push(['/' + f.path, await read('apps/' + f.file)]);

// Vault Boy for the apps' STAT pages: the STAT/VB*.avi animations in assets/official/STAT (the
// owner has permission to use them: see AGENTS.md). Without that folder the apps draw their own figure.
const statVideos = [];
for (const f of (await readdir(path.join(ROOT, 'assets/official/STAT')).catch(() => [])).filter((n) => /^VB\d+\.avi$/i.test(n)).sort()) {
  statVideos.push(['/STAT/' + f, await read('assets/official/STAT/' + f)]);
}

const dirs = ['/ALARM', '/APPINFO', '/CLOCK', '/ENDURANC', '/LEVELUP', '/BOOT', '/DATA', '/INV', '/LOGS', '/MAP', '/MISC', '/NOTES', '/RADIO', '/STAT', '/UI', '/USER'];
const sd = [
  // the firmware's settings, in its own format (no name assigned)
  ['/settings.json', json({
    idleTimeout: 300000, clock12hr: false, longPressToWake: false, timezone: 0, century: 20, fallbackMode: 0,
    alarm: { time: now, enabled: false, repeat: false, soundIndex: 0, soundFiles: [], snooze: 10 },
  })],
  ['/USER/MOJAVE.JS', text('load("mojave.min.js");\n')],
  ['/USER/MOJAVE.EXT', await read('apps/mojave/sd/USER/MOJAVE.EXT')],
  ['/USER/PIPOSX.JS', text('load("pipos-x.min.js");\n')],
  ['/USER/PIPOSX.EXT', await read('apps/pipos-x/sd/USER/PIPOSX.EXT')],
  ['/USER/CAPITAL.JS', text('load("capital.min.js");\n')],
  ['/USER/CAPITAL.EXT', await read('apps/capital/sd/USER/CAPITAL.EXT')],
  ['/USER/PIP2000.JS', text('load("pip2000.min.js");\n')],
  ['/USER/PIP2000.EXT', await read('apps/pip2000/sd/USER/PIP2000.EXT')],
  ['/USER/ENDURANC.JS', text('load("endurance.min.js");\n')],
  ['/USER/ENDURANC.EXT', await read('apps/endurance/sd/USER/ENDURANC.EXT')],
  ['/ENDURANC/TITLE.IMG', await read('apps/endurance/sd/ENDURANC/TITLE.IMG')],
  ['/ENDURANC/GARGANTU.IMG', await read('apps/endurance/sd/ENDURANC/GARGANTU.IMG')],
  ['/ENDURANC/MURPH.IMG', await read('apps/endurance/sd/ENDURANC/MURPH.IMG')],
  ['/USER/TARS.JS', text('load("tars.min.js");\n')],
  ['/USER/TARS.EXT', await read('apps/tars/sd/USER/TARS.EXT')],
  ...statVideos,
  ...holotapeFiles, // the stock interface's INV > APPS runs these; so does the starter menu
  ['/USER/customLists.json', json({
    categories: [
      { id: 'supplies', name: 'Supplies', items: [
        { id: 'stim', text: 'Stimpaks', done: true, updated: now - 2 * H },
        { id: 'radx', text: 'Rad-X', done: false, updated: now - 2 * H },
        { id: 'water', text: 'Purified water', done: false, updated: now - 2 * H },
      ] },
      { id: 'todo', name: 'To do', items: [
        { id: 'emu', text: 'Try both apps in the emulator', done: false, updated: now - H },
        { id: 'conn', text: 'Connect a real Pip-Boy', done: false, updated: now - H },
      ] },
    ],
  })],
  ['/USER/CHAR.json', json({ level: 12, special: [6, 7, 5, 4, 8, 6, 5] })], // a sample character sheet
  ['/USER/MESSAGES.json', json([
    { text: 'Welcome to the Pip-Boy Companion emulator. Messages sent from the dashboard\'s Home page land here.', at: now - 3 * H, read: false },
  ])],
  ['/NOTES/Welcome.txt', text(
    'This is the emulator\'s starter Pip-Boy.\n\n' +
    'It has the companion\'s two apps, Mojave UI and PIP-OS X, with sample notes, lists, messages and radio presets.\n\n' +
    'Pip-OS itself isn\'t included: it belongs to The Wand Company. To run the stock interface, add the official update on the emulator\'s Load tab, or load a dump of your own Pip-Boy. The update comes from The Wand Company\'s Pip-Boy upgrade page:\n\nhttps://www.thewandcompany.com/pip-boy/upgrade/\n',
  )],
  ['/NOTES/Controls.txt', text(
    'Mode dial: tabs\nThumbwheel: pages\nWheel: scroll\nWheel press: select\nPLAY: radio\nTorch: flashlight\nPower: back to the starter menu\n',
  )],
];

await rm(OUT, { recursive: true, force: true });
const write = async (rel, bytes) => {
  await mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
  await writeFile(path.join(OUT, rel), bytes);
};
for (const [, file, bytes] of storage) await write(file, bytes);
for (const [p, bytes] of sd) await write('sd' + p, bytes);

const device = { env: { VERSION: '2v29.400', BOARD: 'PIPBOY', STORAGE: 131072 }, starter: true };
const manifest = {
  format: 'pipboy-dump',
  version: 1,
  tool: 'pipboy-companion starter (scripts/build-starter.mjs)',
  created_at: new Date(now).toISOString(),
  complete: true,
  starter: true,
  device,
  storage: storage.map(([name, file, bytes]) => ({ name, file, size: bytes.length })),
  sd: {
    included: true,
    entries: [
      ...dirs.map((p) => ({ path: p, dir: true, size: 0 })),
      ...sd.map(([p, bytes]) => ({ path: p, dir: false, size: bytes.length, file: 'sd' + p })),
    ],
  },
  errors: [],
};
await write('device.json', text(JSON.stringify(device, null, 2)));
await write('manifest.json', text(JSON.stringify(manifest, null, 2)));
console.log(`emulator/starter: ${storage.length} Storage files, ${sd.length} SD files`);
