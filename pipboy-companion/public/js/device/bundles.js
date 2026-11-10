// Multi-step device tasks behind single buttons: install/remove an app (Storage + APPS-menu
// launcher on the SD card, freeing space first when needed), free up Storage space, back up,
// restore and restart. Pages call these; each one confirms when it must and runs as one job.
import { confirmDialog, download, stamp, notify } from '../ui.js';
import { log } from '../activity.js';
import { workspace } from '../pages/workspace.js';
import * as ops from '../serial/device-ops.js';
import { formatSize, validateStorageName } from '../../../shared/validate.js';
import { runJob, explain } from './jobs.js';
import { session, device, ensureConnected } from './state.js';

const kb = (n) => formatSize(n);

// ------------------------------------------------------------------ space
/**
 * Can `adds` ([name, bytes]) be written now? Uses the last device summary.
 *   { verdict: 'ok' }        enough free space
 *   { verdict: 'cleanup' }   fits once deleted files' space is reclaimed (needs a rebuild + restart)
 *   { verdict: 'full', need, capacity }   doesn't fit even then
 *   { verdict: 'unknown' }   this firmware doesn't report Storage usage; just try
 */
export function spaceFor(adds) {
  const stats = device.info?.stats;
  if (!stats) return { verdict: 'unknown' };
  const needNow = ops.storageFootprint(adds) + 64;
  if (stats.freeBytes >= needNow) return { verdict: 'ok' };
  const replaced = new Set(adds.map(([n]) => n));
  const keep = device.info.files.filter(([n, size]) => !replaced.has(n) && size > 0).map(([n, size]) => [n, { length: size }]);
  const need = ops.storageFootprint([...keep, ...adds]);
  return need <= stats.totalBytes ? { verdict: 'cleanup', need, capacity: stats.totalBytes } : { verdict: 'full', need, capacity: stats.totalBytes };
}

const isOutOfSpace = (e) => /Unable to find or create file/i.test(e?.message ?? '');

// ---------------------------------------------------------------- backups
/** Download a Storage backup and keep a copy in the workspace. */
async function saveBackup(backup, { required = false } = {}) {
  const name = `pipboy-storage-backup-${stamp()}.json`;
  const json = JSON.stringify(backup, null, 2);
  download(name, json);
  try {
    const saved = await workspace.saveCopy(name, new Blob([json], { type: 'application/json' }));
    log(`Storage backup saved to the workspace as ${saved.name}`);
    return saved.name;
  } catch (e) {
    if (required) throw new Error(`Could not keep a copy of the backup on this computer (${e.message}); nothing was erased`);
    log(`Storage backup downloaded, but the workspace copy failed: ${e.message}`, 'error');
    return name;
  }
}

/** Back up every Storage file (job step). Refuses when a file can't be backed up and `strict`. */
async function backupStep(j, { strict }) {
  j.step('Backing up everything in Storage');
  const { backup, skipped } = await ops.storageBackup(session, { onProgress: j.progress });
  if (skipped.length) {
    if (strict) throw new Error(`Storage has file(s) the dashboard can't back up (${skipped.join(', ')}), so it won't erase anything`);
    log(`Backup skipped ${skipped.length} file(s) with names that cannot be restored: ${skipped.join(', ')}`, 'error');
  }
  j.step('Saving the backup on this computer');
  const name = await saveBackup(backup, { required: strict });
  return { backup, name };
}

/** Erase Storage and write `entries` back (job steps), then restart the Pip-Boy. */
async function rebuildSteps(j, entries) {
  j.cancellable = false; // stopping half-way would leave Storage incomplete
  j.step('Erasing Storage and writing the files back');
  const stats = await ops.storageRebuild(session, entries, {
    onProgress: j.progress,
    onPhase: (text) => log(`Storage rebuild: ${text}`),
  });
  log(`Storage rebuilt: ${entries.length} file(s), ${stats?.freeBytes ?? '?'} bytes free`);
  j.restartAfter();
  return stats;
}

const REBUILD_NOTE =
  'Keep the USB cable connected. It takes a couple of minutes, then the Pip-Boy restarts. A backup is saved first (downloaded, and listed on the Backup page), so you can restore it if anything goes wrong.';

export function backUpStorage() {
  return runJob('Back up the Pip-Boy', async (j) => {
    const { name } = await backupStep(j, { strict: false });
    j.finish(`Backup saved as ${name}. It's in your downloads and on the Backup page.`);
  });
}

/** Reclaim the space of deleted files (and optionally write `extra` entries in the same pass). */
export async function freeUpSpace({ extra = [], title = 'Free up space', confirmed = false } = {}) {
  if (!(await ensureConnected())) return null;
  if (!confirmed) {
    const trash = device.info?.stats?.trashBytes;
    const ok = await confirmDialog({
      title: `${title}?`,
      body: [
        'Deleted files keep using space on the Pip-Boy until Storage is rewritten: its Storage is a single flash page it can’t tidy up by itself.',
        `This backs up every file, erases Storage, writes the files back${extra.length ? ` together with ${extra.map(([n]) => n).join(', ')}` : ''}, checks each one and restarts the Pip-Boy.${trash ? ` About ${kb(trash)} will be freed.` : ''}`,
        REBUILD_NOTE,
      ],
      confirm: title,
    });
    if (!ok) return null;
  }
  return runJob(title, async (j) => {
    const { backup, name } = await backupStep(j, { strict: true });
    const extraNames = new Set(extra.map(([n]) => n));
    const entries = [...ops.parseStorageBackup(backup).filter(([n]) => !extraNames.has(n)), ...extra];
    log(`Storage rebuild: backup ${name}; writing ${entries.length} file(s)`);
    await rebuildSteps(j, entries);
    j.finish(extra.length ? `Installed and space freed. Backup: ${name}.` : `Space freed. Backup: ${name}.`);
  });
}

/** Replace Storage with a backup's files (entries from parseStorageBackup). */
export async function restoreStorage(entries, sourceName) {
  if (!(await ensureConnected())) return null;
  const ok = await confirmDialog({
    title: 'Restore this backup?',
    body: [
      `Everything in the Pip-Boy’s Storage will be replaced with the ${entries.length} file(s) in ${sourceName}. Files that aren’t in the backup are removed.`,
      'Keep the USB cable connected. It takes a couple of minutes, then the Pip-Boy restarts.',
    ],
    details: entries.map(([n, b]) => `${n} · ${kb(b.length)}`),
    confirm: 'Restore',
    danger: true,
  });
  if (!ok) return null;
  return runJob('Restore a backup', async (j) => {
    await rebuildSteps(j, entries);
    j.finish(`Restored ${entries.length} file(s) from ${sourceName}.`);
  });
}

export function restartPipBoy() {
  return runJob(
    'Restart the Pip-Boy',
    async (j) => {
      j.restartAfter();
      j.finish('The Pip-Boy restarted and is connected again.');
    },
    { refresh: false, cancellable: false },
  );
}

// ----------------------------------------------------------------- apps
function launcherCode(storageName) {
  return ops.utf8(`load(${JSON.stringify(storageName)});\n`);
}

/** 8.3 launcher name for a Storage app name: "my-app.min.js" -> "USER/MYAPP.JS". */
export function launcherFor(storageName) {
  const stem = storageName.replace(/\.min\.js$|\.js$/i, '').replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 8) || 'APP';
  return `USER/${stem}.JS`;
}

/** The SD path of a top-level folder, matched case-insensitively and created if missing. */
async function sdFolder(dir) {
  const root = await ops.sdListDir(session, '/');
  const folder = root.find((e) => e.dir && e.name.toUpperCase() === dir.toUpperCase());
  if (folder) return folder.path;
  await ops.sdMkdir(session, `/${dir}`);
  return `/${dir}`;
}

/** Write "DIR/NAME" on the SD card, creating DIR if needed. */
async function writeSdPath(rel, bytes, onProgress) {
  const [dir, file] = rel.split('/');
  await ops.sdWrite(session, `${await sdFolder(dir)}/${file}`, bytes, { onProgress });
}

async function writeLauncher(j, launcher, storageName, sdFiles = []) {
  j.step('Adding it to the APPS menu (SD card)');
  await writeSdPath(launcher, launcherCode(storageName), j.progress);
  for (const f of sdFiles) {
    j.step(`Copying ${f.path} (SD card)`);
    await writeSdPath(f.path, f.bytes, j.progress);
  }
}

/** Delete "DIR/NAME" from the SD card if it's there. */
async function deleteSdPath(rel) {
  const [dir, file] = rel.split('/');
  const folder = (await ops.sdListDir(session, '/')).find((e) => e.dir && e.name.toUpperCase() === dir.toUpperCase());
  const hit = folder && (await ops.sdListDir(session, folder.path)).find((e) => !e.dir && e.name.toUpperCase() === file.toUpperCase());
  if (hit) await ops.sdDelete(session, hit.path);
}

/**
 * Write small files to the SD card ("USER/IDCARD.img" style paths) as one job.
 * files: [{ path, bytes, label }]
 */
export async function sendToSd(title, files, { finish } = {}) {
  if (!(await ensureConnected())) return null;
  if (!device.info?.sd) {
    notify('No SD card answered. Check the card is in the Pip-Boy, then reconnect.', true);
    return null;
  }
  return runJob(title, async (j) => {
    for (const f of files) {
      j.step(f.label ?? `Writing ${f.path}`);
      await writeSdPath(f.path, f.bytes, j.progress);
    }
    j.finish(finish ?? `${title}: done.`);
  }, { refresh: false });
}

/** Read "DIR/NAME" from the SD card (quietly); resolves the bytes, or null if it isn't there. */
export async function readFromSd(rel) {
  if (!(await ensureConnected())) return undefined;
  let bytes = null;
  const r = await runJob(`Read ${rel}`, async () => {
    const [dir, file] = rel.split('/');
    const root = await ops.sdListDir(session, '/');
    const folder = root.find((e) => e.dir && e.name.toUpperCase() === dir.toUpperCase());
    if (!folder) return;
    const hit = (await ops.sdListDir(session, folder.path)).find((e) => !e.dir && e.name.toUpperCase() === file.toUpperCase());
    if (hit) bytes = await ops.sdRead(session, hit.path);
  }, { refresh: false, quiet: true });
  return r.ok ? bytes : undefined;
}

/** Delete "DIR/NAME" from the SD card if it's there. */
export async function deleteFromSd(title, rel) {
  if (!(await ensureConnected())) return null;
  return runJob(title, async (j) => {
    j.step(`Deleting ${rel}`);
    const [dir, file] = rel.split('/');
    const root = await ops.sdListDir(session, '/');
    const folder = root.find((e) => e.dir && e.name.toUpperCase() === dir.toUpperCase());
    const hit = folder && (await ops.sdListDir(session, folder.path)).find((e) => !e.dir && e.name.toUpperCase() === file.toUpperCase());
    if (hit) await ops.sdDelete(session, hit.path);
    j.finish(hit ? `${rel} was deleted.` : `${rel} wasn't on the SD card.`);
  }, { refresh: false });
}

/** Delete the APPS-menu launcher, but only if it really loads `storageName`. */
async function removeLauncher(launcher, storageName) {
  const [dir, file] = launcher.split('/');
  const root = await ops.sdListDir(session, '/');
  const folder = root.find((e) => e.dir && e.name.toUpperCase() === dir.toUpperCase());
  if (!folder) return false;
  const files = await ops.sdListDir(session, folder.path);
  const hit = files.find((e) => !e.dir && e.name.toUpperCase() === file.toUpperCase());
  if (!hit || hit.size > 512) return false;
  const code = new TextDecoder().decode(await ops.sdRead(session, hit.path));
  if (!code.includes(JSON.stringify(storageName))) return false;
  await ops.sdDelete(session, hit.path);
  return true;
}

/**
 * Install an app in one go: write it to Storage (freeing space first when needed, after asking),
 * add its launcher to the APPS menu on the SD card, then offer to restart so the menu shows it.
 * sdFiles: [{ path: "USER/X.EXT", bytes }] that go on the SD card with it (an app's extras,
 * which run from RAM so they need no Storage).
 */
export async function installApp({ title, storageName, bytes, launcher, sdFiles = [], verb = null }) {
  validateStorageName(storageName);
  if (!(await ensureConnected())) return null;
  const existing = device.file(storageName);
  const space = spaceFor([[storageName, bytes]]);
  const what = `${title} (${kb(bytes.length)})`;
  if (space.verdict === 'full') {
    notify(
      `${title} needs ${kb(space.need)} of Storage in total, but the Pip-Boy only has ${kb(space.capacity)}. Remove an app or other files first.`,
      true,
    );
    return null;
  }
  const withLauncher = launcher && device.info?.sd;
  if (space.verdict === 'cleanup') {
    const ok = await confirmDialog({
      title: `Make room for ${title}?`,
      body: [
        `There isn’t enough free space for ${what} right now, but there will be once the space of deleted files is reclaimed.`,
        `The dashboard will back up Storage, erase it, write everything back together with ${title}, and restart the Pip-Boy.`,
        REBUILD_NOTE,
      ],
      confirm: `Free up space and ${(verb ?? 'install').toLowerCase()}`,
    });
    if (!ok) return null;
    return runJob(`${verb ?? 'Install'} ${title}`, async (j) => {
      if (withLauncher) await writeLauncher(j, launcher, storageName, sdFiles);
      const { backup, name } = await backupStep(j, { strict: true });
      const entries = [...ops.parseStorageBackup(backup).filter(([n]) => n !== storageName), [storageName, bytes]];
      log(`Storage rebuild for ${storageName}: backup ${name}; writing ${entries.length} file(s)`);
      await rebuildSteps(j, entries);
      j.finish(`${title} is ${launcher ? 'installed' : 'saved'}${withLauncher ? '. Find it in INV › APPS' : ''}.`);
    });
  }

  let outOfSpace = false;
  const result = await runJob(`${verb ?? (existing ? 'Update' : 'Install')} ${title}`, async (j) => {
    j.step(`Copying ${what} to the Pip-Boy`);
    try {
      await ops.storageWrite(session, storageName, bytes, { onProgress: j.progress, maxBytes: ops.STORAGE_TOTAL_BYTES });
    } catch (e) {
      if (isOutOfSpace(e)) outOfSpace = true;
      throw e;
    }
    if (withLauncher) await writeLauncher(j, launcher, storageName, sdFiles);
    j.finish(
      withLauncher
        ? `${title} is installed. Restart the Pip-Boy to see it in INV › APPS.`
        : launcher
          ? `${title} is installed in Storage, but no SD card answered, so it isn't in the APPS menu. Run it with load("${storageName}") from the Espruino IDE.`
          : `${title} is saved on the Pip-Boy.`,
    );
    if (withLauncher) j.offer([{ label: 'Restart now', primary: true, run: restartPipBoy }, { label: 'Later', run() {} }]);
  });
  if (!result.ok && outOfSpace) {
    // Firmware without Storage stats: we only find out when the write fails.
    const ok = await confirmDialog({
      title: 'Storage is full',
      body: [explain(result.error), `Free up space now and install ${title} in the same step?`, REBUILD_NOTE],
      confirm: 'Free up space and install',
    });
    if (!ok) return result;
    // The SD card part first: the rebuild ends with a restart
    if (withLauncher) await runJob(`Add ${title} to the APPS menu`, (j) => writeLauncher(j, launcher, storageName, sdFiles), { refresh: false, quiet: true });
    return freeUpSpace({ extra: [[storageName, bytes]], title: `${verb ?? 'Install'} ${title}`, confirmed: true });
  }
  return result;
}

/** Remove an app's Storage file, its APPS-menu launcher and its SD card files. */
export async function removeApp({ title, storageName, launcher, sdFiles = [] }) {
  if (!(await ensureConnected())) return null;
  const ok = await confirmDialog({
    title: `Remove ${title}?`,
    body: [
      `${storageName} is deleted from the Pip-Boy${launcher ? ', and its entry is taken out of the APPS menu' : ''}. You can install it again any time.`,
      'Its space becomes reusable after “Free up space”.',
    ],
    confirm: 'Remove',
    danger: true,
  });
  if (!ok) return null;
  return runJob(`Remove ${title}`, async (j) => {
    j.step(`Deleting ${storageName}`);
    await ops.storageDelete(session, storageName);
    if (launcher && device.info?.sd) {
      j.step('Taking it out of the APPS menu');
      try {
        await removeLauncher(launcher, storageName);
        for (const f of sdFiles) await deleteSdPath(f.path);
      } catch (e) {
        log(`Could not remove the launcher ${launcher}: ${e.message}`, 'error');
      }
    }
    j.finish(`${title} was removed.`);
    j.offer([{ label: 'Free up space now', primary: true, run: () => freeUpSpace() }, { label: 'Not now', run() {} }]);
  });
}

/** Upload any file to Storage (same space handling as installing an app, no menu entry). */
export function uploadToStorage(name, bytes) {
  return installApp({ title: name, storageName: name, bytes, launcher: null, verb: 'Upload' });
}

// ------------------------------------------------------------------- SD
/** Copy files to an SD folder, asking before overwriting. files: [{ name, bytes }] */
export async function copyToSd(folder, files, { existing = [] } = {}) {
  if (!(await ensureConnected())) return null;
  if (!device.info?.sd) {
    notify('No SD card answered. Check the card is in the Pip-Boy, then reconnect.', true);
    return null;
  }
  const clash = files.filter((f) => existing.some((e) => e.name.toLowerCase() === f.name.toLowerCase()));
  if (clash.length) {
    const ok = await confirmDialog({
      title: clash.length === 1 ? `Replace ${clash[0].name}?` : `Replace ${clash.length} files?`,
      body: `${clash.length === 1 ? 'A file with this name is' : 'Files with these names are'} already in ${folder}.`,
      details: clash.length > 1 ? clash.map((f) => f.name) : [],
      confirm: 'Replace',
    });
    if (!ok) return null;
  }
  const total = files.reduce((n, f) => n + f.bytes.length, 0) || 1;
  return runJob(files.length === 1 ? `Copy ${files[0].name} to the SD card` : `Copy ${files.length} files to the SD card`, async (j) => {
    let done = 0;
    for (const f of files) {
      session.checkCancelled('Cancelled between files');
      const path = (folder === '/' ? '' : folder) + '/' + f.name;
      j.step(`Copying ${f.name} (${kb(f.bytes.length)})`);
      await ops.sdWrite(session, path, f.bytes, { onProgress: (p) => j.progress((done + p * f.bytes.length) / total) });
      done += f.bytes.length;
    }
    j.finish(`Copied ${files.length === 1 ? files[0].name : `${files.length} files`} to ${folder}.`);
  });
}

// ------------------------------------------------------------ extensions
// An extension is a Storage file ext.<id>.js, run by our loader (.boot0) once Pip-OS has
// started. See apps/extensions/loader.js.
const LOADER_MARK = 'companion-loader';

/** Is .boot0 missing, ours, or someone else's? */
async function loaderState(loader) {
  const f = device.file(loader.storageName);
  if (!f) return 'missing';
  const bytes = await ops.storageRead(session, loader.storageName);
  if (!bytes || !new TextDecoder().decode(bytes).includes(LOADER_MARK)) return 'foreign';
  return f[1] === loader.bytes.length && bytes.every((b, i) => b === loader.bytes[i]) ? 'current' : 'outdated';
}

/** Install (or update) an extension and the loader it needs, then offer to restart. */
export async function installExtension(ext, loader) {
  if (!(await ensureConnected())) return null;
  let state;
  const peek = await runJob('Check the extension loader', async () => { state = await loaderState(loader); }, { refresh: false, quiet: true });
  if (!peek.ok) return peek;
  if (state === 'foreign') {
    notify(`The Pip-Boy already has a ${loader.storageName} file that isn't the companion's, so extensions can't be installed without replacing it. Remove it on the Files page first if you don't need it.`, true);
    return null;
  }
  const files = [...(state === 'current' ? [] : [[loader.storageName, loader.bytes]]), [ext.storageName, ext.bytes]];
  const space = spaceFor(files);
  if (space.verdict === 'full') {
    notify(`There isn't room for ${ext.name} in Storage, even after freeing up space. Remove an app first.`, true);
    return null;
  }
  if (space.verdict === 'cleanup') return freeUpSpace({ extra: files, title: `Install ${ext.name}` });
  return runJob(`Install ${ext.name}`, async (j) => {
    if (state !== 'current') {
      j.step(state === 'missing' ? 'Adding the extension loader' : 'Updating the extension loader');
      await ops.storageWrite(session, loader.storageName, loader.bytes, { onProgress: j.progress });
    }
    j.step(`Copying ${ext.name}`);
    await ops.storageWrite(session, ext.storageName, ext.bytes, { onProgress: j.progress });
    j.finish(`${ext.name} is installed. It starts the next time the Pip-Boy restarts.`);
    j.offer([{ label: 'Restart now', primary: true, run: restartPipBoy }, { label: 'Later', run() {} }]);
  });
}

/** Remove an extension; the loader goes too when no extensions are left. */
export async function removeExtension(ext, loader) {
  if (!(await ensureConnected())) return null;
  const ok = await confirmDialog({ title: `Remove ${ext.name}?`, body: `${ext.name} is taken out of the stock interface the next time the Pip-Boy restarts. You can install it again any time.`, confirm: 'Remove', danger: true });
  if (!ok) return null;
  return runJob(`Remove ${ext.name}`, async (j) => {
    j.step(`Deleting ${ext.storageName}`);
    await ops.storageDelete(session, ext.storageName);
    const left = (await ops.storageList(session)).filter((n) => /^ext\..+\.js$/.test(n));
    if (!left.length && device.file(loader.storageName) && (await loaderState(loader)) !== 'foreign') {
      j.step('Removing the extension loader (no extensions left)');
      await ops.storageDelete(session, loader.storageName);
    }
    j.finish(`${ext.name} was removed.`);
    j.offer([{ label: 'Restart now', primary: true, run: restartPipBoy }, { label: 'Later', run() {} }]);
  });
}

// --------------------------------------------------------- start at power-on
// .bootPowerOn runs only when the Pip-Boy powers on (or restarts), not on load(): our apps go
// back to the stock interface with load(), so they don't come straight back.
export const startAppCode = (name) =>
  `// companion-startapp: open ${name} instead of the stock interface when the Pip-Boy powers on.\n` +
  `// Hold the torch button while it starts for the stock interface.\n` +
  `if (!BTN4.read() && require("Storage").read(${JSON.stringify(name)}) !== undefined) load(${JSON.stringify(name)});\n`;

/** Make `storageName` the app that opens at power-on, or pass null to go back to the stock interface. */
export async function setStartApp(storageName, title) {
  // The name goes into code (.bootPowerOn): only plain Storage names, so a file on the device
  // with a crafted name can't add code of its own
  if (storageName) {
    try {
      validateStorageName(storageName);
    } catch (e) {
      notify(`${storageName} can’t be opened at power-on: ${e.message}`, true);
      return null;
    }
  }
  if (!(await ensureConnected())) return null;
  if (device.info?.startApp === '') {
    notify('The Pip-Boy has a .bootPowerOn file that isn’t the companion’s, so it’s left alone. Delete it on the Files page to use this.', true);
    return null;
  }
  return runJob(storageName ? `Open ${title} at power-on` : 'Open the stock interface at power-on', async (j) => {
    if (storageName) {
      j.step('Saving the start-up choice');
      try {
        await ops.storageWrite(session, '.bootPowerOn', ops.utf8(startAppCode(storageName)));
      } catch (e) {
        if (isOutOfSpace(e)) throw new Error('Storage is full. Use Free up space, then try again.');
        throw e;
      }
      j.finish(`${title} opens whenever the Pip-Boy powers on. Its power button goes back to the stock interface, and holding the torch button while it starts skips the app.`);
    } else {
      j.step('Removing the start-up choice');
      await ops.storageDelete(session, '.bootPowerOn');
      j.finish('The stock interface opens at power-on again.');
    }
  });
}

/** Bring the loader up to date (it gains features, such as the scrolling header). */
export function updateLoader(loader) {
  return runJob('Update the extension loader', async (j) => {
    j.step('Copying the new loader');
    await ops.storageWrite(session, loader.storageName, loader.bytes, { onProgress: j.progress });
    j.finish('The extension loader is up to date. It takes effect the next time the Pip-Boy restarts.');
    j.offer([{ label: 'Restart now', primary: true, run: restartPipBoy }, { label: 'Later', run() {} }]);
  });
}
