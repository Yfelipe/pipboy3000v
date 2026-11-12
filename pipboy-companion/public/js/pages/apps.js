// Apps: the catalog in apps/index.json with one-click install / update / remove, your own
// .js files, and other apps found in the Pip-Boy's Storage.
import { $, escapeHtml, empty, notify, iconRefresh, pickFiles, confirmDialog } from '../ui.js';
import { device, session, onDeviceChange } from '../device/state.js';
import { installApp, removeApp, launcherFor, installExtension, removeExtension, setStartApp, updateLoader, sendToSd, removeFromSd } from '../device/bundles.js';
import { STORAGE_MAX_BYTES } from '../serial/device-ops.js';
import { formatSize, validateStorageName } from '../../../shared/validate.js';

let catalog = null; // [{ ...entry, bytes }]
let catalogError = null;
let extensions = []; // the same, for apps/index.json "extensions"
let loader = null; // the extension loader (.boot0)
let holotapes = []; // apps/index.json "holotapes": [{ ...entry, files: [{ path, bytes }] }], run from the SD card

async function loadCatalog() {
  try {
    const res = await fetch('/apps/index.json');
    if (!res.ok) throw new Error(`apps/index.json: ${res.status}`);
    const index = await res.json();
    const get = async (file) => {
      const r = await fetch(`/apps/${file}`);
      return r.ok ? new Uint8Array(await r.arrayBuffer()) : null;
    };
    const withBytes = async (entry) => ({
      ...entry,
      bytes: await get(entry.file),
      // files that go on the SD card with it (an app's companion extras)
      sdFiles: (await Promise.all((entry.sdFiles ?? []).map(async (f) => ({ path: f.path, bytes: await get(f.file) })))).filter((f) => f.bytes),
    });
    catalog = await Promise.all(index.apps.map(withBytes));
    extensions = await Promise.all((index.extensions ?? []).map(withBytes));
    loader = index.loader ? await withBytes(index.loader) : null;
    holotapes = await Promise.all((index.holotapes ?? []).map(async (h) => ({
      ...h,
      files: (await Promise.all(h.files.map(async (f) => ({ path: f.path, bytes: await get(f.file) })))).filter((f) => f.bytes),
    })));
  } catch (e) {
    catalogError = e.message;
    catalog = [];
  }
  render();
}

function statusOf(app) {
  if (!session.connected || !device.info) return null;
  const file = device.file(app.storageName);
  if (!file) return 'missing';
  return app.bytes && file[1] !== app.bytes.length ? 'outdated' : 'installed';
}

/** "Open at power-on" switch for an installed app. */
function startToggle(storageName, title) {
  const on = device.info?.startApp === storageName;
  return (
    `<label class="check start-toggle"><input type="checkbox" data-start-app="${escapeHtml(storageName)}" data-start-title="${escapeHtml(title)}"${on ? ' checked' : ''}${device.busy ? ' disabled' : ''}>` +
    ` Open at power-on instead of the stock interface</label>`
  );
}

function card(app) {
  const status = statusOf(app);
  const tag = {
    installed: '<span class="tag ok">INSTALLED</span>',
    outdated: '<span class="tag warn">UPDATE AVAILABLE</span>',
    missing: '<span class="tag">NOT INSTALLED</span>',
  }[status] ?? '';
  const id = escapeHtml(app.id);
  const busy = device.busy ? ' disabled' : '';
  const primary =
    status === 'installed'
      ? `<button class="btn secondary" data-app-install="${id}"${busy}>Reinstall</button>`
      : `<button class="btn" data-app-install="${id}"${busy}><i data-lucide="download"></i> ${status === 'outdated' ? 'Update' : 'Install'}</button>`;
  const remove = status === 'installed' || status === 'outdated' ? `<button class="btn danger" data-app-remove="${id}"${busy}>Remove</button>` : '';
  const start = status === 'installed' || status === 'outdated' ? startToggle(app.storageName, app.name) : '';
  return (
    `<article class="app-card"><div class="app-card-head"><h3>${escapeHtml(app.name)}</h3>${tag}</div>` +
    `<p>${escapeHtml(app.description ?? '')}</p>` +
    `<p class="help">${app.bytes ? formatSize(app.bytes.length) : 'file missing'} · <code>${escapeHtml(app.storageName)}</code>${app.sdFiles?.length ? ` · plus ${formatSize(app.sdFiles.reduce((n, f) => n + f.bytes.length, 0))} of extras on the SD card` : ''}</p>` +
    `<div class="row">${app.bytes ? primary : ''}${remove}` +
    `<a class="btn secondary" href="/emulator/?app=${encodeURIComponent(app.id)}" target="_blank" rel="noopener"><i data-lucide="monitor-play"></i> Try in emulator</a></div>${start}</article>`
  );
}

function otherApps() {
  if (!device.info) return [];
  const known = new Set((catalog ?? []).map((a) => a.storageName));
  return device.info.files.filter(([n]) => /\.js$/i.test(n) && !n.startsWith('.') && !/^ext\..+\.js$/.test(n) && !known.has(n));
}

function extCard(ext) {
  const status = statusOf(ext);
  const id = escapeHtml(ext.id);
  const busy = device.busy ? ' disabled' : '';
  const tag = { installed: '<span class="tag ok">INSTALLED</span>', outdated: '<span class="tag warn">UPDATE AVAILABLE</span>', missing: '<span class="tag">NOT INSTALLED</span>' }[status] ?? '';
  const main = status === 'installed'
    ? `<button class="btn danger" data-ext-remove="${id}"${busy}>Remove</button>`
    : `<button class="btn" data-ext-install="${id}"${busy}><i data-lucide="plus"></i> ${status === 'outdated' ? 'Update' : 'Install'}</button>` +
      (status === 'outdated' ? `<button class="btn danger" data-ext-remove="${id}"${busy}>Remove</button>` : '');
  return (
    `<article class="app-card"><div class="app-card-head"><h3>${escapeHtml(ext.name)}</h3>${tag}</div>` +
    `<p>${escapeHtml(ext.description ?? '')}</p><p class="help">${ext.bytes ? formatSize(ext.bytes.length) : 'file missing'} · <code>${escapeHtml(ext.storageName)}</code></p>` +
    `<div class="row">${ext.bytes && loader?.bytes ? main : ''}</div></article>`
  );
}

/** A holotape lives only on the SD card, which the device summary doesn't list: no status tag. */
function holotapeCard(h) {
  const id = escapeHtml(h.id);
  const busy = device.busy ? ' disabled' : '';
  const size = h.files.reduce((n, f) => n + f.bytes.length, 0);
  return (
    `<article class="app-card"><div class="app-card-head"><h3>${escapeHtml(h.name)}</h3></div>` +
    `<p>${escapeHtml(h.description ?? '')}</p><p class="help">${formatSize(size)} on the SD card · no Storage used</p>` +
    `<div class="row">${h.files.length ? `<button class="btn" data-holotape-install="${id}"${busy}><i data-lucide="download"></i> Copy to the SD card</button>` : ''}` +
    `<button class="btn danger" data-holotape-remove="${id}"${busy}>Remove</button>` +
    `<a class="btn secondary" href="/emulator/?app=${encodeURIComponent(h.id)}" target="_blank" rel="noopener"><i data-lucide="monitor-play"></i> Try in emulator</a></div></article>`
  );
}

function loaderNotice() {
  const f = loader && device.file(loader.storageName);
  const anyExt = device.info?.files.some(([n]) => /^ext\..+\.js$/.test(n));
  const show = session.connected && f && anyExt && loader.bytes && f[1] !== loader.bytes.length;
  $('loader-notice').hidden = !show;
}

function render() {
  loaderNotice();
  $('extensions-catalog').innerHTML = extensions.length ? extensions.map(extCard).join('') : '<p class="help">No extensions in the catalog.</p>';
  $('holotapes-catalog').innerHTML = holotapes.length ? holotapes.map(holotapeCard).join('') : '<p class="help">No holotapes in the catalog.</p>';
  if (!catalog) {
    $('apps-catalog').innerHTML = '<p class="help">Loading apps…</p>';
  } else {
    $('apps-catalog').innerHTML = catalog.length
      ? catalog.map(card).join('')
      : empty('No apps in the catalog', catalogError ?? 'apps/index.json lists none.');
  }
  const others = otherApps();
  $('apps-other-total').textContent = session.connected && device.info ? `${others.length} FOUND` : '';
  $('apps-other').innerHTML = !session.connected
    ? '<p class="help">Connect to see the apps already on your Pip-Boy.</p>'
    : others.length
      ? others
          .map(
            ([n, size]) =>
              `<div class="item"><div class="item-main"><strong>${escapeHtml(n)}</strong><span>${formatSize(Math.max(0, size))}</span>${startToggle(n, n)}</div>` +
              `<div class="item-actions"><button class="mini danger" data-other-remove="${escapeHtml(n)}"${device.busy ? ' disabled' : ''}>Remove</button></div></div>`,
          )
          .join('')
      : '<p class="help">None. Apps you install from a file show up here.</p>';
  iconRefresh();
}

async function installOwn() {
  const [file] = await pickFiles({ accept: '.js,application/javascript,text/javascript' });
  if (!file) return;
  let name;
  try {
    if (!/\.js$/i.test(file.name)) throw new Error('Choose a JavaScript (.js) file.');
    if (!file.size) throw new Error('That file is empty.');
    if (file.size > STORAGE_MAX_BYTES) throw new Error(`That file is ${formatSize(file.size)}; apps must be under ${formatSize(STORAGE_MAX_BYTES)}.`);
    name = validateStorageName(file.name);
  } catch (e) {
    return notify(e.message, true);
  }
  if (device.file(name)) {
    const ok = await confirmDialog({ title: `Replace ${name}?`, body: `${name} is already on the Pip-Boy. Replace it with the file you chose?`, confirm: 'Replace' });
    if (!ok) return;
  }
  await installApp({ title: name, storageName: name, bytes: new Uint8Array(await file.arrayBuffer()), launcher: launcherFor(name) });
}

export function initApps() {
  $('apps-catalog').addEventListener('click', (e) => {
    const install = e.target.closest('[data-app-install]');
    const remove = e.target.closest('[data-app-remove]');
    const app = catalog?.find((a) => a.id === (install ?? remove)?.dataset[install ? 'appInstall' : 'appRemove']);
    if (!app) return;
    const common = { title: app.name, storageName: app.storageName, launcher: app.launcher ?? launcherFor(app.storageName), sdFiles: app.sdFiles };
    if (install) installApp({ ...common, bytes: app.bytes });
    else removeApp(common);
  });
  $('apps-other').addEventListener('click', (e) => {
    const b = e.target.closest('[data-other-remove]');
    if (b) removeApp({ title: b.dataset.otherRemove, storageName: b.dataset.otherRemove, launcher: launcherFor(b.dataset.otherRemove) });
  });
  $('app-install-own').addEventListener('click', installOwn);
  $('loader-update').addEventListener('click', () => loader && updateLoader(loader));
  document.querySelector('#apps').addEventListener('change', (e) => {
    const t = e.target.closest('[data-start-app]');
    if (!t) return;
    const name = t.dataset.startApp;
    t.checked = device.info?.startApp === name; // the job decides; render shows the result
    setStartApp(device.info?.startApp === name ? null : name, t.dataset.startTitle);
  });
  $('extensions-catalog').addEventListener('click', (e) => {
    const install = e.target.closest('[data-ext-install]');
    const remove = e.target.closest('[data-ext-remove]');
    const ext = extensions.find((x) => x.id === (install ?? remove)?.dataset[install ? 'extInstall' : 'extRemove']);
    if (!ext || !loader) return;
    if (install) installExtension(ext, loader);
    else removeExtension(ext, loader);
  });
  $('holotapes-catalog').addEventListener('click', (e) => {
    const install = e.target.closest('[data-holotape-install]');
    const remove = e.target.closest('[data-holotape-remove]');
    const h = holotapes.find((x) => x.id === (install ?? remove)?.dataset[install ? 'holotapeInstall' : 'holotapeRemove']);
    if (!h) return;
    if (install) {
      sendToSd(`Copy ${h.name} to the SD card`, h.files.map((f) => ({ path: f.path, bytes: f.bytes })), {
        finish: `${h.name} is on the SD card. Find it in INV › APPS in the stock interface (restart the Pip-Boy if the menu is already open).`,
      });
    } else {
      removeFromSd(`Remove ${h.name}`, h.files.map((f) => f.path), { what: `${h.name} is`, finish: `${h.name} was removed.` });
    }
  });
  onDeviceChange(render);
  render();
  void loadCatalog();
}
