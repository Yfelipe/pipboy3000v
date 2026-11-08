// End-to-end: real server + real UI in headless Chromium.
// Requires Playwright (`npm i -D playwright && npx playwright install chromium`); skipped otherwise.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../../server/app.js';
import { installFakeSerial } from './fake-serial-browser.js';

let chromium = null;
try {
  ({ chromium } = createRequire(import.meta.url)('playwright'));
} catch {
  try {
    ({ chromium } = await import('playwright'));
  } catch {}
}

const quiet = { warn() {}, error() {}, log() {} };

describe('browser end-to-end', { skip: chromium ? false : 'playwright is not installed' }, () => {
  let browser, app, base, dataDir;
  const pageErrors = [];

  async function startServer() {
    app = await createApp({ dataDir, logger: quiet });
    await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
    base = `http://localhost:${app.server.address().port}`;
  }
  const stopServer = () => new Promise((r) => app.server.close(r));

  async function open(page, hash = '') {
    page.on('pageerror', (e) => pageErrors.push(e.message));
    page.on('console', (m) => {
      // CDN fonts/icons may be unreachable in CI; that must not break the app.
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) pageErrors.push(m.text());
    });
    await page.goto(`${base}/${hash}`);
    await page.waitForSelector('body[data-ready="true"]', { timeout: 10_000 });
  }

  before(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), 'pipboy-e2e-'));
    await startServer();
    browser = await chromium.launch();
  });
  after(async () => {
    await browser?.close();
    await stopServer();
    await rm(dataDir, { recursive: true, force: true });
  });

  test('records persist across a page reload and a server restart', async () => {
    const page = await browser.newPage();
    await open(page, '#apps');
    await page.click('#app-notes summary');
    await page.fill('#app-name', 'Holotape Reader');
    await page.fill('#app-version', 'v1.2');
    await page.click('#app-form button[type=submit]');
    await page.waitForSelector('#apps-list .item');

    await page.click('[data-page="radio"]');
    await page.fill('#station-name', 'Radio Nüklear');
    await page.fill('#station-frequency', '101.7');
    await page.click('#radio-form button[type=submit]');
    await page.waitForSelector('#radio-list .item');

    // Duplicate frequency is refused by the server with a readable message.
    await page.fill('#station-name', 'Copycat');
    await page.fill('#station-frequency', '101.7');
    await page.click('#radio-form button[type=submit]');
    await page.waitForSelector('#feedback.show.error');
    assert.match(await page.textContent('#feedback'), /already saved/);

    await page.click('[data-page="settings"]');
    await page.selectOption('#setting-theme', 'Amber');
    await page.click('#settings-form button[type=submit]');
    await page.waitForFunction(() => document.querySelector('#settings-state').textContent === 'SAVED PROFILE');

    await stopServer();
    await startServer();
    await page.goto(`${base}/#dashboard`);
    await page.waitForSelector('body[data-ready="true"]');
    assert.equal(await page.textContent('#record-status'), '3 SAVED RECORDS');
    assert.equal((await page.textContent('#app-count')).trim(), '1');
    assert.equal((await page.textContent('#preset-count')).trim(), '1');
    assert.equal(await page.inputValue('#setting-theme'), 'Amber');
    await page.close();
  });

  test('workspace files are uploaded, listed and kept', async () => {
    const page = await browser.newPage();
    await open(page, '#workspace');
    const local = path.join(dataDir, 'My Song [Live].mp3');
    await writeFile(local, 'ID3 fake audio');
    await page.setInputFiles('#workspace-files', local);
    await page.waitForSelector('#workspace-list .item');
    const listed = await page.textContent('#workspace-list');
    assert.match(listed, /My Song _Live_\.mp3/);
    assert.equal(await readFile(path.join(dataDir, 'workspace', 'My Song _Live_.mp3'), 'utf8'), 'ID3 fake audio');
    await page.reload();
    await page.waitForSelector('body[data-ready="true"]');
    assert.equal((await page.textContent('#file-count')).trim(), '1');
    await page.close();
  });

  test('backup restore previews, then imports atomically', async () => {
    const page = await browser.newPage();
    await open(page, '#backup');
    const file = path.join(dataDir, 'backup.json');
    await writeFile(file, JSON.stringify({
      format: 'pip-boy-companion-backup', version: 1,
      records: [
        { kind: 'radio', name: 'Dup', payload: '{"frequency":"101.7"}', created_at: '2025-01-01T00:00:00Z' },
        { kind: 'radio', name: 'Classical Radio', payload: '{"frequency":"94.5"}', created_at: '2025-01-01T00:00:00Z' },
      ],
    }));
    await page.setInputFiles('#backup-file', file);
    await page.waitForSelector('#restore-preview:not([hidden])');
    assert.match(await page.textContent('#restore-description'), /1 preset\(s\) will be added.*1 preset\(s\) will be skipped/);
    await page.click('#confirm-restore');
    await page.waitForSelector('#restore-preview[hidden]', { state: 'attached' });
    await page.waitForFunction(() => document.querySelector('#preset-count').textContent.trim() === '2');
    await page.close();
  });

  // The fake device evaluates REPL lines with new Function(), which the app's CSP
  // (correctly) forbids. Only this test harness needs eval, so bypass CSP here.
  async function deviceContext(device, { downloads = false } = {}) {
    const context = await browser.newContext({ bypassCSP: true, acceptDownloads: downloads });
    const page = await context.newPage();
    await page.addInitScript(installFakeSerial, device);
    return { context, page };
  }
  const connected = (page) =>
    page.waitForFunction(() => document.querySelector('#connection-status').textContent === 'CONNECTED', null, { timeout: 15_000 });
  const jobDone = (page, timeout = 30_000) =>
    page.waitForFunction(() => ['done', 'failed', 'cancelled'].includes(document.querySelector('#job').dataset.state) && !document.querySelector('#job').hidden, null, { timeout });
  async function choose(page, trigger, files) {
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click(trigger)]);
    await chooser.setFiles(files);
  }

  test('Files: connect from the top bar, list, upload and delete Storage files, browse the SD card', async () => {
    const { context, page } = await deviceContext({
      storage: { 'boot.js': 'print(1)', 'memory-notes.txt': 'MEMORY LOW_MEMORY words' },
      sd: { '/MEMORY.TXT': 'hello' },
    });
    await open(page, '#files');
    // Not connected: the list offers to connect instead of showing disabled controls.
    await page.waitForSelector('#device-files [data-connect]');
    await page.click('#device-connect');
    await connected(page);

    // Storage is listed from Storage.list() right after connecting, not from the SD card.
    await page.waitForSelector('#device-files [data-storage-name="boot.js"]');
    assert.ok(!(await page.textContent('#device-files')).includes('MEMORY.TXT'));
    assert.match(await page.textContent('#storage-meter'), /free/);

    // Upload is one click: pick the file and it's written and verified.
    const local = path.join(dataDir, 'companion.js');
    const text = '// Nüklear ☢\n' + 'print("vault 111");\n'.repeat(40);
    await writeFile(local, text);
    await choose(page, '#storage-upload', local);
    await page.waitForFunction(() => window.__fakeDevice.storage.has('companion.js'), null, { timeout: 15_000 });
    await jobDone(page);
    assert.equal(await page.getAttribute('#job', 'data-state'), 'done');
    const stored = await page.evaluate(() => window.__fakeDevice.storage.get('companion.js'));
    assert.equal(Buffer.from(stored, 'latin1').toString('utf8'), text);
    await page.waitForSelector('#device-files [data-storage-name="companion.js"]');

    // Delete asks first; cancelling keeps the file.
    await page.click('[data-storage-delete="boot.js"]');
    await page.waitForSelector('#dialog[open]');
    await page.click('#dialog-cancel');
    assert.equal(await page.evaluate(() => window.__fakeDevice.storage.has('boot.js')), true);
    await page.click('[data-storage-delete="boot.js"]');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => !window.__fakeDevice.storage.has('boot.js'));
    const history = await page.evaluate(() => window.__pipboySession.history.map((h) => h.status));
    assert.ok(!history.includes('failed'), `history: ${history}`);

    // The SD tab opens the card by itself. A file called MEMORY.TXT must not trigger safe mode.
    await page.click('#tab-sd');
    await page.waitForSelector('#sd-files [data-sd-get="/MEMORY.TXT"]');
    assert.match(await page.textContent('#safe-mode'), /standby/);

    // Radio presets: Send to Pip-Boy writes JSON the device can read back.
    await page.click('[data-page="radio"]');
    await page.click('#device-radio');
    await page.waitForFunction(() => window.__fakeDevice.storage.has('companion-radio.json'));
    const presets = await page.evaluate(() => window.__fakeDevice.storage.get('companion-radio.json'));
    assert.ok(JSON.parse(Buffer.from(presets, 'latin1').toString('utf8')).some((p) => p.name === 'Radio Nüklear'));

    await jobDone(page);
    await page.click('#device-disconnect');
    await page.waitForFunction(() => document.querySelector('#connection-status').textContent === 'NOT CONNECTED');
    await context.close();
  });

  test('a device button connects first when the Pip-Boy is not connected yet', async () => {
    const { context, page } = await deviceContext({ storage: { 'boot.js': 'x' } });
    await open(page, '#settings');
    await page.click('#device-settings'); // one click: connect, save, send
    await page.waitForFunction(() => window.__fakeDevice.storage.has('companion-settings.json'), null, { timeout: 15_000 });
    await connected(page);
    await context.close();
  });

  test('Apps: one-click install adds the APPS menu entry; remove takes both away', async () => {
    const { context, page } = await deviceContext({ storage: { '.bootcde': 'x'.repeat(1000), VERSION: '5' }, sd: { '/MUSIC/a.wav': 'RIFF' } });
    await open(page, '#apps');
    await page.click('#device-connect');
    await connected(page);
    await page.waitForSelector('#apps-catalog [data-app-install="mojave"]');
    assert.match(await page.textContent('#apps-catalog'), /NOT INSTALLED/);

    await page.click('[data-app-install="mojave"]');
    await jobDone(page);
    assert.equal(await page.getAttribute('#job', 'data-state'), 'done');
    const app = await readFile(path.join('apps', 'mojave', 'mojave.min.js'), 'latin1');
    assert.equal(await page.evaluate(() => window.__fakeDevice.storage.get('mojave.min.js')), app);
    assert.equal(await page.evaluate(() => window.__fakeDevice.sd.get('/USER/MOJAVE.JS')), 'load("mojave.min.js");\n');
    const extras = await readFile(path.join('apps', 'mojave', 'sd', 'USER', 'MOJAVE.EXT'), 'latin1');
    assert.equal(await page.evaluate(() => window.__fakeDevice.sd.get('/USER/MOJAVE.EXT')), extras, 'the companion extras go on the SD card');
    assert.match(await page.textContent('#job'), /Restart now/);
    await page.waitForFunction(() => /INSTALLED/.test(document.querySelector('#apps-catalog').textContent) && document.querySelector('[data-app-remove="mojave"]'));

    await page.click('[data-app-remove="mojave"]');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => !window.__fakeDevice.storage.has('mojave.min.js') && !window.__fakeDevice.sd.has('/USER/MOJAVE.JS') && !window.__fakeDevice.sd.has('/USER/MOJAVE.EXT'), null, { timeout: 15_000 });
    await jobDone(page);
    assert.match(await page.textContent('#job'), /Free up space now/);
    await context.close();
  });

  test('Apps: when Storage is full of deleted files, install frees up space, restarts and reconnects', async () => {
    // 120 KB capacity: the firmware plus 60 KB of trash leave no room for the app until rebuilt.
    const { context, page } = await deviceContext(
      { storage: { '.bootcde': 'B'.repeat(50_000), VERSION: '5' }, sd: {}, capacity: 120_000, trash: 60_000 },
      { downloads: true },
    );
    await open(page, '#apps');
    await page.click('#device-connect');
    await connected(page);
    await page.waitForSelector('[data-app-install="pipos-x"]');
    const download = page.waitForEvent('download');
    await page.click('[data-app-install="pipos-x"]');
    await page.waitForSelector('#dialog[open]');
    assert.match(await page.textContent('#dialog-title'), /Make room/);
    await page.click('#dialog-ok');
    assert.match((await download).suggestedFilename(), /^pipboy-storage-backup-.*\.json$/);
    await jobDone(page, 60_000);
    assert.equal(await page.getAttribute('#job', 'data-state'), 'done');
    const dev = await page.evaluate(() => ({ files: [...window.__fakeDevice.storage.keys()].sort(), trash: window.__fakeDevice.trash, reboots: window.__fakeDevice.reboots, resets: window.__fakeDevice.resets }));
    assert.deepEqual(dev.files, ['.bootcde', 'VERSION', 'pipos-x.min.js']);
    assert.equal(dev.trash, 0);
    assert.equal(dev.resets, 1); // stopped the firmware before erasing
    assert.equal(dev.reboots, 1); // and restarted it afterwards
    assert.equal(await page.evaluate(() => window.__fakeDevice.storage.get('.bootcde').length), 50_000);
    await connected(page); // reconnected by itself
    // The backup was kept on this computer and is listed for one-click restore.
    await page.click('[data-page="backup"]');
    await page.waitForSelector('#backup-list [data-backup-restore]');
    await context.close();
  });

  test('Backup: back up, then restore from the list', async () => {
    const { context, page } = await deviceContext({ storage: { 'a.txt': 'AAA', 'b.txt': 'BBB' } }, { downloads: true });
    await open(page, '#backup');
    await page.click('#backup-now'); // connects, then backs up
    await jobDone(page);
    await page.waitForSelector('#backup-list [data-backup-restore]');
    await page.evaluate(() => {
      window.__fakeDevice.storage.set('a.txt', 'changed');
      window.__fakeDevice.storage.set('junk.txt', 'junk');
    });
    await page.click('#backup-list [data-backup-restore]');
    await page.waitForSelector('#dialog[open]');
    assert.match(await page.textContent('#dialog-body'), /a\.txt/);
    await page.click('#dialog-ok');
    await jobDone(page, 60_000);
    assert.equal(await page.getAttribute('#job', 'data-state'), 'done');
    const files = await page.evaluate(() => Object.fromEntries(window.__fakeDevice.storage));
    assert.deepEqual(files, { 'a.txt': 'AAA', 'b.txt': 'BBB' });
    await context.close();
  });

  test('ID, lists & feeds: ID card, lists and feed picture go to the SD card in the firmware formats', async () => {
    const { context, page } = await deviceContext({
      storage: { VERSION: '1.33' },
      sd: { '/USER/customLists.json': JSON.stringify({ categories: [{ id: 'c1', name: 'Shopping list', items: [{ id: 'i1', text: 'Nuka Cola', done: true, updated: 5 }] }] }) },
    });
    await open(page, '#personalise');
    await page.fill('#id-name', 'Lucy MacLean');
    await page.fill('#id-vault', '33');
    await page.click('#id-send'); // connects first
    await page.waitForFunction(() => window.__fakeDevice.sd.has('/USER/IDCARD.json'), null, { timeout: 20_000 });
    await jobDone(page);
    assert.equal(await page.evaluate(() => window.__fakeDevice.sd.get('/USER/IDCARD.img').length), 30_000); // 400x300, 2 bit
    const card = JSON.parse(await page.evaluate(() => window.__fakeDevice.sd.get('/USER/IDCARD.json')));
    assert.equal(card.name, 'Lucy MacLean');
    assert.equal(card.vault, '33');

    // Lists: load (keeps the Pip-Boy's ticks and ids), add an item, send
    await page.click('#lists-load');
    await page.waitForSelector('.list-card');
    await page.click('[data-item-add="0"]');
    await page.keyboard.type('Sugar Bombs');
    await page.click('#lists-send');
    await page.waitForFunction(() => /Sugar Bombs/.test(window.__fakeDevice.sd.get('/USER/customLists.json')), null, { timeout: 20_000 });
    const lists = JSON.parse(await page.evaluate(() => window.__fakeDevice.sd.get('/USER/customLists.json')));
    assert.deepEqual(lists.categories[0].items[0], { id: 'i1', text: 'Nuka Cola', done: true, updated: 5 });
    assert.equal(lists.categories[0].items[1].text, 'Sugar Bombs');

    // Changed on the Pip-Boy since loading (ticked there): sending asks first
    await jobDone(page);
    await page.evaluate(() => window.__fakeDevice.sd.set('/USER/customLists.json', '{"categories":[]}'));
    await page.click('#lists-send');
    await page.waitForSelector('#dialog[open]');
    assert.match(await page.textContent('#dialog-title'), /Replace the lists/);
    await page.click('#dialog-cancel');
    assert.equal(await page.evaluate(() => window.__fakeDevice.sd.get('/USER/customLists.json')), '{"categories":[]}');

    // Feed picture: any image becomes a 400x248 2 bit file
    const png = path.join(dataDir, 'pic.png');
    await writeFile(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP8z8DAwMDAxMDAwMDAAAANHQEDK+mmyAAAAABJRU5ErkJggg==', 'base64'));
    await choose(page, '#feed-pick', png);
    await page.waitForFunction(() => !document.querySelector('#feed-send').disabled);
    await page.click('#feed-send');
    await page.waitForFunction(() => window.__fakeDevice.sd.has('/USER/USERIMG.img'), null, { timeout: 20_000 });
    assert.equal(await page.evaluate(() => window.__fakeDevice.sd.get('/USER/USERIMG.img').length), 24_800);
    await context.close();
  });

  test('Pip-Boy settings: read from settings.json and saved back, keeping other settings', async () => {
    const { context, page } = await deviceContext({
      storage: { VERSION: '1.33' },
      sd: { '/settings.json': JSON.stringify({ idleTimeout: 120000, clock12hr: false, timezone: 13, fallbackMode: 5, rtcCalibration: -47.68, alarm: { enabled: false } }) },
    });
    await open(page, '#pipsettings');
    await page.click('#ps-empty [data-connect]');
    await page.waitForSelector('#ps-form:not([hidden])', { timeout: 15_000 });
    assert.equal(await page.inputValue('#ps-fallback'), '5');
    assert.equal(await page.inputValue('#ps-idle'), '120000');
    assert.match(await page.textContent('#ps-rtc'), /-47\.7 ppm/);
    await page.selectOption('#ps-fallback', '0');
    await page.selectOption('#ps-clock', 'true');
    await page.fill('#ps-name', 'Lucy');
    await page.click('#ps-save');
    await page.waitForFunction(() => /"fallbackMode":0/.test(window.__fakeDevice.sd.get('/settings.json')), null, { timeout: 15_000 });
    const saved = JSON.parse(await page.evaluate(() => window.__fakeDevice.sd.get('/settings.json')));
    assert.deepEqual(
      { fallbackMode: saved.fallbackMode, clock12hr: saved.clock12hr, userName: saved.userName, rtc: saved.rtcCalibration, alarm: saved.alarm },
      { fallbackMode: 0, clock12hr: true, userName: 'Lucy', rtc: -47.68, alarm: { enabled: false } },
    );
    await context.close();
  });

  test('Foundations: extensions, messages, display colour, SD space and clock sync', async () => {
    const { context, page } = await deviceContext({
      storage: { '.bootcde': 'x'.repeat(1000), VERSION: '1.33' },
      sd: { '/settings.json': JSON.stringify({ idleTimeout: 120000, timezone: 13, fallbackMode: 0 }), '/MUSIC/a.wav': 'RIFF' },
      clockOffset: -120_000, // the Pip-Boy's clock is two minutes slow
      sdSize: 16 * 1024 * 1024,
    });
    await open(page, '#apps');
    await page.click('#device-connect');
    await connected(page);

    // The clock is set when it connects
    await page.waitForFunction(() => Math.abs(window.__fakeDevice.clockOffset) < 5000, null, { timeout: 10_000 });

    // Extensions: installing adds the loader (.boot0) and the extension; removing the last takes both
    await page.waitForSelector('[data-ext-install="inbox"]');
    await page.click('[data-ext-install="inbox"]');
    await jobDone(page);
    assert.equal(await page.getAttribute('#job', 'data-state'), 'done');
    const loader = await readFile(path.join('apps', 'extensions', 'min', 'loader.js'), 'latin1');
    assert.equal(await page.evaluate(() => window.__fakeDevice.storage.get('.boot0')), loader);
    assert.ok(await page.evaluate(() => window.__fakeDevice.storage.has('ext.inbox.js')));
    assert.match(await page.textContent('#job'), /Restart now/);
    await page.waitForSelector('[data-ext-remove="inbox"]');
    await page.click('[data-ext-remove="inbox"]');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => !window.__fakeDevice.storage.has('ext.inbox.js') && !window.__fakeDevice.storage.has('.boot0'), null, { timeout: 15_000 });
    await jobDone(page);

    // A message: kept on the SD card (no stock interface here to show it), with a pointer to the Inbox
    await page.click('[data-page="dashboard"]');
    await page.fill('#msg-text', 'Dinner’s ready — café at 6');
    await page.click('#msg-send');
    await page.waitForFunction(() => window.__fakeDevice.sd.has('/USER/MESSAGES.json'), null, { timeout: 10_000 });
    const msgs = JSON.parse(await page.evaluate(() => window.__fakeDevice.sd.get('/USER/MESSAGES.json')));
    assert.equal(msgs[0].text, "Dinner's ready - cafe at 6"); // folded to the Pip-Boy's plain ASCII
    await jobDone(page);
    assert.match(await page.textContent('#job'), /Inbox extension/);

    // Display colour: a preset, applied, saved with the palettes Pip-OS uses
    await page.click('[data-page="pipsettings"]');
    await page.waitForSelector('#ps-colour:not([hidden])', { timeout: 10_000 });
    await page.click('#ps-presets [data-preset="1"]'); // amber
    await page.click('#ps-colour-save');
    await page.waitForFunction(() => /"palette"/.test(window.__fakeDevice.sd.get('/settings.json')), null, { timeout: 10_000 });
    const settings = JSON.parse(await page.evaluate(() => window.__fakeDevice.sd.get('/settings.json')));
    assert.deepEqual(settings.color, { r: 255, g: 112, b: 0, scanline: 128, overscan: 128 });
    assert.equal(settings.palette.split(',').length, 4);
    assert.equal(settings.fallbackMode, 0, 'other settings kept');

    // SD card space on the Files page
    await page.click('[data-page="files"]');
    await page.click('#tab-sd');
    await page.waitForSelector('#sd-space:not([hidden])', { timeout: 10_000 });
    assert.match(await page.textContent('#sd-space'), /free.*of 16\.0 MB/);
    await context.close();
  });

  test('Extensions: new extensions install, start-at-power-on toggles, the loader updates, notes are edited', async () => {
    const { context, page } = await deviceContext({
      storage: { '.bootcde': 'x'.repeat(1000), VERSION: '1.33', '.boot0': '// companion-loader 1\n', 'ext.inbox.js': '// old', 'pipos-x.min.js': 'x' },
      sd: { '/NOTES/Packing_list.txt': 'Stimpaks\nRadAway', '/MUSIC/a.wav': 'RIFF' },
    });
    await open(page, '#apps');
    await page.click('#device-connect');
    await connected(page);

    // An old loader with extensions on the device: offer the update
    await page.waitForSelector('#loader-notice:not([hidden])', { timeout: 10_000 });
    await page.click('#loader-update');
    await jobDone(page);
    const loader = await readFile(path.join('apps', 'extensions', 'min', 'loader.js'), 'latin1');
    assert.equal(await page.evaluate(() => window.__fakeDevice.storage.get('.boot0')), loader);
    await page.waitForSelector('#loader-notice[hidden]', { state: 'attached', timeout: 10_000 });

    // Each new extension installs
    for (const id of ['remote', 'radio', 'notes']) {
      await page.waitForSelector(`[data-ext-install="${id}"]:not([disabled])`);
      await page.click(`[data-ext-install="${id}"]`);
      await page.waitForFunction((n) => window.__fakeDevice.storage.has(n), `ext.${id}.js`, { timeout: 15_000 });
      await jobDone(page);
      assert.equal(await page.getAttribute('#job', 'data-state'), 'done');
      const src = await readFile(path.join('apps', 'extensions', 'min', `${id}.js`), 'latin1');
      assert.equal(await page.evaluate((n) => window.__fakeDevice.storage.get(n), `ext.${id}.js`), src);
    }

    // Start at power-on: on writes our .bootPowerOn, off removes it
    const toggle = '[data-start-app="pipos-x.min.js"]';
    await page.waitForSelector(`${toggle}:not([disabled])`);
    await page.click(toggle);
    await page.waitForFunction(() => window.__fakeDevice.storage.has('.bootPowerOn'), null, { timeout: 10_000 });
    await jobDone(page);
    assert.match(await page.evaluate(() => window.__fakeDevice.storage.get('.bootPowerOn')), /companion-startapp[\s\S]*load\("pipos-x\.min\.js"\)/);
    await page.waitForSelector(`${toggle}:checked:not([disabled])`, { timeout: 10_000 });
    await page.click(toggle);
    await page.waitForFunction(() => !window.__fakeDevice.storage.has('.bootPowerOn'), null, { timeout: 10_000 });
    await jobDone(page);
    await page.waitForSelector(`${toggle}:not(:checked):not([disabled])`, { timeout: 10_000 });

    // Notes: load, edit and rename, new, delete
    await page.click('[data-page="personalise"]');
    await page.click('#notes-load');
    await jobDone(page);
    await page.waitForSelector('#notes-list [data-note="0"]');
    assert.match(await page.textContent('#notes-list'), /Packing list/);
    await page.click('#notes-list [data-note="0"]');
    assert.equal(await page.inputValue('#note-body'), 'Stimpaks\nRadAway');
    await page.fill('#note-title', 'Packing — trip');
    await page.fill('#note-body', 'Stimpaks\nRadAway\nNuka-Cola');
    await page.click('#note-save');
    await page.waitForFunction(() => window.__fakeDevice.sd.has('/NOTES/Packing_trip.txt') && !window.__fakeDevice.sd.has('/NOTES/Packing_list.txt'), null, { timeout: 15_000 });
    assert.equal(await page.evaluate(() => window.__fakeDevice.sd.get('/NOTES/Packing_trip.txt')), 'Stimpaks\nRadAway\nNuka-Cola');
    await jobDone(page);

    await page.click('#notes-new');
    await page.fill('#note-title', 'Codes');
    await page.fill('#note-body', 'Vault door 0451');
    await page.click('#note-save');
    await page.waitForFunction(() => window.__fakeDevice.sd.has('/NOTES/Codes.txt'), null, { timeout: 15_000 });
    await jobDone(page);
    await page.waitForFunction(() => document.querySelectorAll('#notes-list [data-note]').length === 2);

    await page.click('#note-delete');
    await page.click('#dialog-ok');
    await page.waitForFunction(() => !window.__fakeDevice.sd.has('/NOTES/Codes.txt'), null, { timeout: 15_000 });
    await jobDone(page);
    await page.waitForFunction(() => document.querySelectorAll('#notes-list [data-note]').length === 1);
    await context.close();
  });

  test('SD browser: open folders, go up, upload, new folder, zip a folder, and make a complete copy', async () => {
    const { context, page } = await deviceContext(
      {
        storage: { 'app.js': 'Pip.radioOn()', '.boot0': 'boot' },
        sd: { '/MUSIC/Track 01.wav': 'RIFFdata', '/MUSIC/Live Set/b.wav': 'BBB', '/readme.txt': 'hello', '/VIDEO/big.avi': 'x'.repeat(4000) },
      },
      { downloads: true },
    );
    await open(page, '#files');
    await page.click('#device-connect');
    await connected(page);

    await page.click('#tab-sd');
    await page.waitForSelector('#sd-files [data-sd-open="/MUSIC"]');
    await page.click('#sd-files [data-sd-open="/MUSIC"]');
    await page.waitForSelector('#sd-files [data-sd-open="/MUSIC/Live Set"]');
    assert.match(await page.textContent('#sd-files'), /Track 01\.wav/);
    assert.match(await page.textContent('#sd-breadcrumb'), /MUSIC/);

    // Upload into the open folder (name with a space): one click, no separate "send" button.
    const local = path.join(dataDir, 'new song.wav');
    await writeFile(local, 'NEW');
    await choose(page, '#sd-upload', local);
    await page.waitForFunction(() => window.__fakeDevice.sd.get('/MUSIC/new song.wav') === 'NEW', null, { timeout: 15_000 });
    await page.waitForSelector('#sd-files [data-sd-get="/MUSIC/new song.wav"]');

    // Download this folder as a zip.
    const [zipDownload] = await Promise.all([page.waitForEvent('download', { timeout: 30_000 }), page.click('#sd-zip')]);
    assert.equal(zipDownload.suggestedFilename(), 'MUSIC.zip');
    const zipPath = path.join(dataDir, 'MUSIC.zip');
    await zipDownload.saveAs(zipPath);
    const zip = await readFile(zipPath);
    for (const name of ['MUSIC/Track 01.wav', 'MUSIC/Live Set/', 'MUSIC/Live Set/b.wav', 'MUSIC/new song.wav']) {
      assert.ok(zip.includes(Buffer.from(name)), `zip contains ${name}`);
    }

    // Up one folder, make a folder through the dialog.
    await jobDone(page);
    await page.click('#sd-up');
    await page.waitForSelector('#sd-files [data-sd-open="/VIDEO"]');
    await page.click('#sd-mkdir');
    await page.fill('#dialog-input', 'SAVES');
    await page.click('#dialog-ok');
    await page.waitForSelector('#sd-files [data-sd-open="/SAVES"]');

    // Complete copy with a 1 KB SD limit (under Options): big.avi is listed, not downloaded.
    await page.click('[data-page="backup"]');
    await page.click('#backup details.options summary');
    await page.fill('#dump-sd-max', '1');
    await page.click('#dump-start');
    await page.waitForFunction(() => /Dump saved to/.test(document.querySelector('#dump-status').textContent), null, { timeout: 60_000 });
    const [dump] = await app.dumps.list();
    assert.equal(dump.complete, true);
    const manifest = JSON.parse(await readFile(path.join(dump.path, 'manifest.json'), 'utf8'));
    assert.equal(await readFile(path.join(dump.path, 'storage', 'app.js'), 'utf8'), 'Pip.radioOn()');
    assert.equal(await readFile(path.join(dump.path, 'storage', '%2Eboot0'), 'utf8'), 'boot');
    assert.equal(await readFile(path.join(dump.path, 'sd', 'MUSIC', 'Live Set', 'b.wav'), 'utf8'), 'BBB');
    assert.ok(manifest.sd.entries.find((e) => e.path === '/VIDEO/big.avi').skipped);
    assert.deepEqual(manifest.device.globalShapes.Pip.own.sort(), ['audioStart', 'radioOn']);
    await page.waitForFunction((id) => document.querySelector('#dump-list').textContent.includes(id), dump.id, { timeout: 10_000 });
    assert.match(await page.textContent('#dump-list'), /Complete/);
    await context.close();
  });

  test('no uncaught page errors', () => {
    assert.deepEqual(pageErrors, []);
  });
});
