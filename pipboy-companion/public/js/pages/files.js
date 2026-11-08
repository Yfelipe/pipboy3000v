// Files: the Pip-Boy's Storage (built-in flash) and its SD card, each with its actions on
// the rows and one toolbar. Every action is a single click (plus a confirmation when it
// deletes or overwrites); nothing needs a file "selected" first.
import { $, escapeHtml, empty, notify, iconRefresh, download, pickFiles, confirmDialog, promptDialog } from '../ui.js';
import { log } from '../activity.js';
import { device, session, onDeviceChange, storageUsage, refreshInfo } from '../device/state.js';
import { runJob } from '../device/jobs.js';
import { freeUpSpace, uploadToStorage, copyToSd } from '../device/bundles.js';
import { storageMeter, needsConnection } from '../device/views.js';
import { workspace } from './workspace.js';
import * as ops from '../serial/device-ops.js';
import { expr } from '../serial/protocol.js';
import { createZip } from '../zip.js';
import { formatSize, validateStorageName, validateSdPath, sdJoin } from '../../../shared/validate.js';

// ------------------------------------------------------------------ tabs
let tab = 'storage';

export function showFilesTab(name) {
  tab = name === 'sd' ? 'sd' : 'storage';
  for (const t of ['storage', 'sd']) {
    const button = $(`tab-${t}`);
    button.setAttribute('aria-selected', String(t === tab));
    button.tabIndex = t === tab ? 0 : -1;
    $(`files-${t}`).hidden = t !== tab;
  }
  if (tab === 'sd' && session.connected && sdCwd === null && device.info?.sd && !device.busy) void openSd('/');
}

// --------------------------------------------------------------- Storage
// Files the firmware needs: deleting them can stop the Pip-Boy from starting.
const SYSTEM_FILES = new Set(['.bootcde', '.boot0', '.boot1', '.boot2', '.boot3', 'VERSION', 'FW.js', '.bootrst']);
const kindOf = (name) => (SYSTEM_FILES.has(name) || name.startsWith('.') ? 'system' : /\.js$/i.test(name) ? 'app' : 'data');

function renderStorage() {
  $('storage-meter').innerHTML = session.connected ? storageMeter(storageUsage()) : '';
  const trash = device.info?.stats?.trashBytes ?? 0;
  $('storage-free').classList.toggle('attention', trash > 4096);
  for (const id of ['storage-upload', 'storage-free', 'storage-refresh']) $(id).hidden = !session.connected;
  if (!session.connected) {
    $('device-files').innerHTML = needsConnection('the files in Storage');
    return;
  }
  const files = [...(device.info?.files ?? [])].sort((a, b) => kindOf(a[0]).localeCompare(kindOf(b[0])) || a[0].localeCompare(b[0]));
  const busy = device.busy ? ' disabled' : '';
  $('device-files').innerHTML = !device.info
    ? '<p class="help">Reading…</p>'
    : files.length
      ? files
          .map(([name, size]) => {
            const kind = kindOf(name);
            const n = escapeHtml(name);
            let safe = true;
            try {
              validateStorageName(name);
            } catch {
              safe = false; // internal names (e.g. StorageFile chunks) can't be handled one by one
            }
            return (
              `<div class="item" data-storage-name="${n}"><div class="item-main"><strong>${n}</strong>` +
              `<span>${size >= 0 ? formatSize(size) : 'size unknown'} · ${{ system: 'firmware / system file', app: 'app', data: 'data' }[kind]}</span></div>` +
              (safe
                ? `<div class="item-actions"><button class="mini" data-storage-get="${n}"${busy}>Download</button>` +
                  `<button class="mini danger" data-storage-delete="${n}"${busy}>Delete</button></div>`
                : '') +
              `</div>`
            );
          })
          .join('')
      : empty('Storage is empty', 'Restore a backup to put the firmware back.');
  iconRefresh();
}

async function uploadStorageFile() {
  const [file] = await pickFiles();
  if (!file) return;
  let name;
  try {
    name = validateStorageName(file.name);
    if (!file.size) throw new Error('That file is empty; Storage can’t hold empty files.');
    if (file.size > ops.STORAGE_MAX_BYTES) throw new Error(`That file is ${formatSize(file.size)}. Storage files must be under ${formatSize(ops.STORAGE_MAX_BYTES)}; put bigger files on the SD card.`);
  } catch (e) {
    return notify(e.message, true);
  }
  if (device.file(name)) {
    const ok = await confirmDialog({
      title: `Replace ${name}?`,
      body: `${name} is already in Storage.${kindOf(name) === 'system' ? ' It’s a firmware file: a wrong file can stop the Pip-Boy from starting.' : ''}`,
      confirm: 'Replace',
      danger: kindOf(name) === 'system',
    });
    if (!ok) return;
  }
  await uploadToStorage(name, new Uint8Array(await file.arrayBuffer()));
}

function downloadStorageFile(name) {
  return runJob(
    `Download ${name}`,
    async (j) => {
      j.step(`Reading ${name} from the Pip-Boy`);
      const bytes = await ops.storageRead(session, name, { onProgress: j.progress });
      if (bytes === null) throw new Error(`${name} is no longer on the Pip-Boy`);
      download(name, new Blob([bytes]), 'application/octet-stream');
      j.finish(`${name} downloaded.`);
    },
    { refresh: false },
  );
}

async function deleteStorageFile(name) {
  const system = kindOf(name) === 'system';
  const ok = await confirmDialog({
    title: `Delete ${name}?`,
    body: system
      ? [`${name} is part of the Pip-Boy’s firmware. Without it the Pip-Boy may not start until you restore a backup.`, 'Make a backup first if you don’t have one.']
      : `${name} will be deleted from the Pip-Boy. Its space becomes reusable after “Free up space”.`,
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await runJob(`Delete ${name}`, async (j) => {
    j.step(`Deleting ${name}`);
    await ops.storageDelete(session, name);
    j.finish(`${name} was deleted.`);
  });
}

// ---------------------------------------------------------------- SD card
let sdCwd = null; // null until listed
let sdEntries = [];
let sdError = null;

function renderSd() {
  const listed = sdCwd !== null && session.connected;
  const busy = device.busy;
  for (const id of ['sd-up', 'sd-upload', 'sd-mkdir', 'sd-zip', 'sd-refresh']) $(id).hidden = !session.connected;
  $('sd-up').disabled = busy || !listed || sdCwd === '/';
  const parts = listed && sdCwd !== '/' ? sdCwd.slice(1).split('/') : [];
  $('sd-breadcrumb').innerHTML = listed
    ? [`<button data-sd-open="/">SD card</button>`, ...parts.map((p, i) => `<span aria-hidden="true">›</span><button data-sd-open="${escapeHtml('/' + parts.slice(0, i + 1).join('/'))}"${i === parts.length - 1 ? ' aria-current="location"' : ''}>${escapeHtml(p)}</button>`)].join('')
    : '';
  if (!session.connected) {
    $('sd-files').innerHTML = needsConnection('the SD card');
    return;
  }
  if (device.info && !device.info.sd) {
    $('sd-files').innerHTML = empty('No SD card found', 'Check the card is in the Pip-Boy, then reconnect.');
    return;
  }
  if (!listed) {
    $('sd-files').innerHTML = sdError
      ? `<div class="empty"><strong>Couldn’t read the SD card</strong><p>${escapeHtml(sdError)}</p><button class="btn small mt-12" data-sd-open="/">Try again</button></div>`
      : `<div class="empty"><strong>SD card</strong><p>Open it to browse its folders.</p><button class="btn small mt-12" data-sd-open="/"${busy ? ' disabled' : ''}>Open the SD card</button></div>`;
    return;
  }
  const dis = busy ? ' disabled' : '';
  $('sd-files').innerHTML = sdEntries.length
    ? sdEntries
        .map((e) => {
          const p = escapeHtml(e.path);
          const n = escapeHtml(e.name);
          return e.dir
            ? `<div class="item folder"><button class="item-main link" data-sd-open="${p}"${dis}><strong><i data-lucide="folder"></i> ${n}</strong><span>Folder</span></button>` +
                `<div class="item-actions"><button class="mini" data-sd-zip="${p}"${dis} aria-label="Download ${n} as a zip">Download</button>` +
                `<button class="mini danger" data-sd-delete="${p}" data-sd-dir="1"${dis}>Delete</button></div></div>`
            : `<div class="item"><div class="item-main"><strong>${n}</strong><span>${e.size >= 0 ? formatSize(e.size) : 'size unknown'}</span></div>` +
                `<div class="item-actions"><button class="mini" data-sd-get="${p}"${dis}>Download</button>` +
                `<button class="mini" data-sd-keep="${p}"${dis} title="Copy to this computer’s workspace">Keep</button>` +
                `<button class="mini danger" data-sd-delete="${p}"${dis}>Delete</button></div></div>`;
        })
        .join('')
    : empty('This folder is empty', 'Upload files into it with “Upload files…”.');
  iconRefresh();
}

async function listInto(dir) {
  sdEntries = await ops.sdListDir(session, dir);
  sdCwd = dir;
  sdError = null;
}

// Free space on the card: fs.getFree on Espruino 2v29+ (Pip-OS 1.33), read once per connection
let sdSpace; // undefined = not read yet, null = not reported
let sdSpaceSession = null;
function renderSdSpace() {
  const el = $('sd-space');
  el.hidden = !session.connected || !sdSpace;
  if (sdSpace) {
    const used = sdSpace.total - sdSpace.free;
    el.innerHTML = storageMeter({ total: sdSpace.total, free: sdSpace.free, trash: 0, used, exact: true }).replace('Storage:', 'SD card:');
  }
}
function readSdSpace() {
  if (sdSpaceSession === session.sessionId) return;
  sdSpaceSession = session.sessionId;
  runJob('Check SD card space', async () => {
    const r = await session.transaction(expr.sdFree(), 'value', { timeout: 15_000 });
    sdSpace = r && r.total > 0 ? r : null;
  }, { refresh: false, quiet: true }).then(renderSdSpace);
}

function openSd(dir) {
  return runJob(
    'Open SD folder',
    async (j) => {
      j.step(`Listing ${dir === '/' ? 'the SD card' : dir}`);
      try {
        await listInto(dir);
      } catch (e) {
        sdError = e.message;
        throw e;
      }
      j.finish(`Showing ${dir === '/' ? 'the SD card' : dir}.`);
    },
    { refresh: false, quiet: true },
  ).then((r) => {
    renderSd();
    if (r.ok) readSdSpace();
    return r;
  });
}

async function uploadSd() {
  const files = await pickFiles({ multiple: true });
  if (!files.length) return;
  const folder = sdCwd ?? '/';
  const list = [];
  for (const f of files) {
    try {
      validateSdPath(sdJoin(folder, f.name));
      if (f.size > ops.SD_MAX_BYTES) throw new Error(`${f.name} is over ${formatSize(ops.SD_MAX_BYTES)}; copy it with a card reader.`);
    } catch (e) {
      notify(e.message, true);
      continue;
    }
    list.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  }
  if (!list.length) return;
  const r = await copyToSd(folder, list, { existing: sdCwd === null ? [] : sdEntries });
  if (r?.ok) await openSd(folder);
}

async function newFolder() {
  const folder = sdCwd ?? '/';
  const name = await promptDialog({ title: 'New folder', label: `Folder name (in ${folder === '/' ? 'the SD card' : folder})`, placeholder: 'e.g. MUSIC', maxLength: 64, confirm: 'Create' });
  if (!name) return;
  const target = sdJoin(folder, name);
  try {
    validateSdPath(target);
  } catch (e) {
    return notify(e.message, true);
  }
  const r = await runJob(`Create folder ${name}`, async (j) => {
    j.step(`Creating ${target}`);
    await ops.sdMkdir(session, target);
    await listInto(folder);
    j.finish(`Created ${target}.`);
  }, { refresh: false });
  if (r.ok) renderSd();
}

/** Recursively read a folder into a zip download. */
function zipFolder(dir) {
  return runJob(`Download ${dir === '/' ? 'the SD card' : dir}`, async (j) => {
    j.step('Finding every file in the folder');
    const { entries, truncated } = await ops.sdWalk(session, dir);
    const base = dir === '/' ? '' : dir.slice(1) + '/';
    const prefix = dir === '/' ? '/' : dir + '/';
    const files = entries.filter((e) => !e.dir);
    const total = files.reduce((n, e) => n + Math.max(0, e.size), 0) || 1;
    j.step(`Copying ${files.length} file(s), ${formatSize(total)}`);
    let done = 0;
    const zipEntries = [];
    for (const e of entries) {
      session.checkCancelled('Cancelled while copying the folder');
      const rel = base + e.path.slice(prefix.length);
      if (e.dir) {
        zipEntries.push({ name: `${rel}/` });
        continue;
      }
      const bytes = await ops.sdRead(session, e.path, { onProgress: (f) => j.progress((done + f * Math.max(0, e.size)) / total) });
      zipEntries.push({ name: rel, bytes });
      done += Math.max(0, e.size);
    }
    if (truncated) log(`The zip of ${dir} is incomplete: too many files or folders too deep`, 'error');
    const name = dir === '/' ? 'sd-card.zip' : `${dir.split('/').pop()}.zip`;
    download(name, new Blob([createZip(zipEntries)]), 'application/zip');
    j.finish(`${name} downloaded (${files.length} file(s)).${truncated ? ' Some files were left out; see Activity.' : ''}`);
  }, { refresh: false });
}

function getSdFile(path, { keep = false } = {}) {
  const name = path.split('/').pop();
  return runJob(`${keep ? 'Keep' : 'Download'} ${name}`, async (j) => {
    j.step(`Reading ${name} from the SD card`);
    const bytes = await ops.sdRead(session, path, { onProgress: j.progress });
    if (keep) {
      const saved = await workspace.saveCopy(name, new Blob([bytes]));
      j.finish(`${name} copied to the workspace as ${saved.name}.`);
    } else {
      download(name, new Blob([bytes]), 'application/octet-stream');
      j.finish(`${name} downloaded.`);
    }
  }, { refresh: false });
}

async function deleteSd(path, isDir) {
  const ok = await confirmDialog({
    title: `Delete ${path.split('/').pop()}?`,
    body: isDir ? `The folder ${path} is deleted from the SD card. It must be empty first.` : `${path} is deleted from the SD card.`,
    confirm: 'Delete',
    danger: true,
  });
  if (!ok) return;
  const r = await runJob(`Delete ${path.split('/').pop()}`, async (j) => {
    j.step(`Deleting ${path}`);
    await ops.sdDelete(session, path);
    await listInto(sdCwd ?? '/');
    j.finish(`${path} was deleted.`);
  }, { refresh: false });
  renderSd();
  return r;
}

// ------------------------------------------------------------------- init
function render() {
  if (!session.connected) {
    sdCwd = null;
    sdEntries = [];
  }
  renderStorage();
  renderSd();
  renderSdSpace();
}

export function initFiles() {
  $('tab-storage').addEventListener('click', () => showFilesTab('storage'));
  $('tab-sd').addEventListener('click', () => showFilesTab('sd'));
  document.querySelector('#files .tabs').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    showFilesTab(tab === 'storage' ? 'sd' : 'storage');
    $(`tab-${tab}`).focus();
  });

  $('storage-upload').addEventListener('click', uploadStorageFile);
  $('storage-free').addEventListener('click', () => freeUpSpace());
  $('storage-refresh').addEventListener('click', () => refreshInfo());
  $('device-files').addEventListener('click', (e) => {
    const get = e.target.closest('[data-storage-get]');
    if (get) return downloadStorageFile(get.dataset.storageGet);
    const del = e.target.closest('[data-storage-delete]');
    if (del) return deleteStorageFile(del.dataset.storageDelete);
  });

  $('sd-up').addEventListener('click', () => openSd(sdCwd.split('/').slice(0, -1).join('/') || '/'));
  $('sd-refresh').addEventListener('click', () => openSd(sdCwd ?? '/'));
  $('sd-upload').addEventListener('click', uploadSd);
  $('sd-mkdir').addEventListener('click', newFolder);
  $('sd-zip').addEventListener('click', () => zipFolder(sdCwd ?? '/'));
  const sdClick = (e) => {
    const open = e.target.closest('[data-sd-open]');
    if (open) return openSd(open.dataset.sdOpen);
    const zip = e.target.closest('[data-sd-zip]');
    if (zip) return zipFolder(zip.dataset.sdZip);
    const get = e.target.closest('[data-sd-get]');
    if (get) return getSdFile(get.dataset.sdGet);
    const keep = e.target.closest('[data-sd-keep]');
    if (keep) return getSdFile(keep.dataset.sdKeep, { keep: true });
    const del = e.target.closest('[data-sd-delete]');
    if (del) return deleteSd(del.dataset.sdDelete, !!del.dataset.sdDir);
  };
  $('sd-files').addEventListener('click', sdClick);
  $('sd-breadcrumb').addEventListener('click', sdClick);

  document.addEventListener('pagechange', (e) => {
    if (e.detail === 'files') showFilesTab(tab);
  });
  onDeviceChange(render);
  render();
}
