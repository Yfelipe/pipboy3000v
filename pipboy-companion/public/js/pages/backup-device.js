// Backup page, device side: Storage backups (made here, kept in the workspace, restored with
// one click), free up space, and complete copies (dumps) for the emulator.
import { $, escapeHtml, empty, notify, pickFiles, confirmDialog } from '../ui.js';
import { log } from '../activity.js';
import { api } from '../api.js';
import { session } from '../device/state.js';
import { runJob } from '../device/jobs.js';
import { backUpStorage, restoreStorage, freeUpSpace } from '../device/bundles.js';
import { workspace } from './workspace.js';
import * as ops from '../serial/device-ops.js';
import { formatSize } from '../../../shared/validate.js';

const BACKUP_NAME = /^pipboy-storage-backup.*\.json$/i;

function renderBackups(files) {
  const backups = files.filter((f) => BACKUP_NAME.test(f.name)).sort((a, b) => (a.modified_at < b.modified_at ? 1 : -1));
  $('backup-list').innerHTML = backups.length
    ? backups
        .map(
          (f, i) =>
            `<div class="item"><div class="item-main"><strong>${new Date(f.modified_at).toLocaleString()}${i === 0 ? ' <span class="tag ok">LATEST</span>' : ''}</strong>` +
            `<span>${escapeHtml(f.name)} · ${formatSize(f.size)}</span></div>` +
            `<div class="item-actions"><button class="mini" data-backup-restore="${escapeHtml(f.name)}">Restore</button>` +
            `<a class="mini" href="${api.fileUrl(f.name)}" download="${escapeHtml(f.name)}">Download</a></div></div>`,
        )
        .join('')
    : empty('No backups yet', 'Connect your Pip-Boy and press “Back up now”.');
}

async function restoreFrom(name, readJson) {
  let entries;
  try {
    entries = ops.parseStorageBackup(await readJson());
  } catch (e) {
    return notify(`That isn’t a Storage backup this dashboard can restore: ${e.message}`, true);
  }
  await restoreStorage(entries, name);
}

// ------------------------------------------------------------------ dumps
async function refreshDumps() {
  let list = [];
  try {
    list = await api.listDumps();
  } catch (e) {
    $('dump-list').innerHTML = empty('Copies unavailable', e.message);
    return;
  }
  $('dump-list').innerHTML = list.length
    ? list
        .map((d) => {
          const state = d.hasManifest ? (d.complete ? (d.errors ? `Complete with ${d.errors} error(s)` : 'Complete') : 'Interrupted') : 'Incomplete (can’t be resumed)';
          const facts = d.hasManifest ? ` · ${d.storageFiles} Storage files · ${d.sdFiles} SD files${d.sdSkipped ? ` · ${d.sdSkipped} large files listed only` : ''}` : '';
          return (
            `<div class="item"><div class="item-main"><strong>${escapeHtml(d.id)}</strong><span>${state}${facts} · ${escapeHtml(d.path)}</span></div>` +
            `<div class="item-actions">${d.hasManifest && (!d.complete || d.errors) ? `<button class="mini" data-dump-resume="${escapeHtml(d.id)}" data-dump-path="${escapeHtml(d.path)}">${d.complete ? 'Retry failed files' : 'Resume'}</button>` : ''}` +
            `${d.hasManifest ? `<a class="mini" href="${api.dumpFileUrl(d.id, 'manifest.json')}" download>Manifest</a>` : ''}` +
            `<button class="mini danger" data-dump-delete="${escapeHtml(d.id)}">Delete</button></div></div>`
          );
        })
        .join('')
    : '';
}

function runDump(id, path, previous) {
  const maxKb = Number($('dump-sd-max').value);
  if (!Number.isFinite(maxKb) || maxKb < 1) return notify('Enter the SD size limit in KB (under Options).', true);
  return runJob(previous ? 'Resume the complete copy' : 'Make a complete copy', async (j) => {
    j.step(previous ? 'Picking up where the copy stopped' : 'Copying everything from the Pip-Boy');
    if (!id) ({ id, path } = await api.createDump());
    log(`${previous ? 'Copy resumed' : 'Copy started'}: ${path}`);
    const manifest = await ops.dumpDevice(session, {
      includeSd: $('dump-sd').checked,
      sdMaxFileBytes: Math.round(maxKb * 1024),
      previous,
      save: (rel, bytes) => api.saveDumpFile(id, rel, bytes),
      onStatus: (text, fraction) => {
        $('dump-status').textContent = text;
        if (fraction !== undefined) j.progress(fraction);
      },
      onEvent: (level, text) => log(text, level),
    });
    const sdFiles = manifest.sd.entries.filter((e) => e.file).length;
    const skipped = manifest.sd.entries.filter((e) => e.skipped).length;
    const summary = `Dump saved to ${path} · ${manifest.storage.filter((f) => f.file).length} Storage files · ${sdFiles} SD files · ${skipped} large SD files listed for card copy · ${manifest.errors.length} error(s)`;
    $('dump-status').textContent = summary;
    log(summary, manifest.errors.length ? 'error' : 'info');
    for (const err of manifest.errors.slice(0, 20)) log(`Copy error: ${err}`, 'error');
    j.finish(`Complete copy saved to ${path}.${manifest.errors.length ? ` ${manifest.errors.length} file(s) failed; press Retry failed files.` : ''}`);
  }, { refresh: false }).then(async (r) => {
    if (r && !r.ok && r.error.message !== 'not connected' && r.error.message !== 'busy') {
      $('dump-status').textContent = `The copy stopped: ${r.error.message}. Everything copied so far is kept; press Resume to continue.`;
    }
    await refreshDumps();
  });
}

export function initDeviceBackup() {
  $('backup-now').addEventListener('click', backUpStorage);
  $('backup-free').addEventListener('click', () => freeUpSpace());
  $('restore-file').addEventListener('click', async () => {
    const [file] = await pickFiles({ accept: '.json,application/json' });
    if (!file) return;
    if (file.size > 10_000_000) return notify('That file is too big to be a Storage backup.', true);
    await restoreFrom(file.name, async () => JSON.parse(await file.text()));
  });
  $('backup-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-backup-restore]');
    if (!b) return;
    const name = b.dataset.backupRestore;
    restoreFrom(name, async () => JSON.parse(new TextDecoder().decode(await api.fetchFile(name))));
  });
  workspace.onChange(renderBackups);
  renderBackups(workspace.files());

  $('dump-start').addEventListener('click', () => runDump(null, null, null));
  $('dump-list').addEventListener('click', async (e) => {
    const resume = e.target.closest('[data-dump-resume]');
    if (resume) {
      let previous;
      try {
        const res = await fetch(api.dumpFileUrl(resume.dataset.dumpResume, 'manifest.json'));
        if (!res.ok) throw new Error(`manifest.json not readable (${res.status})`);
        previous = await res.json();
      } catch (err) {
        return notify(`Can’t resume: ${err.message}`, true);
      }
      return runDump(resume.dataset.dumpResume, resume.dataset.dumpPath, previous);
    }
    const del = e.target.closest('[data-dump-delete]');
    if (!del) return;
    const ok = await confirmDialog({ title: 'Delete this copy?', body: `${del.dataset.dumpDelete} is deleted from this computer. The Pip-Boy isn’t affected.`, confirm: 'Delete', danger: true });
    if (!ok) return;
    try {
      await api.deleteDump(del.dataset.dumpDelete);
      log(`Deleted copy ${del.dataset.dumpDelete}`);
    } catch (err) {
      notify(err.message, true);
    }
    await refreshDumps();
  });
  void refreshDumps();
}
