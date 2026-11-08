// Backup & restore of companion records (server-side, all-or-nothing import).
import { $, notify, download, withButton } from '../ui.js';
import { api } from '../api.js';
import { records } from '../records.js';
import { log } from '../activity.js';

let pending = null;

function hidePreview() {
  pending = null;
  $('restore-preview').hidden = true;
}

export function initBackup() {
  $('export-backup').addEventListener('click', (e) =>
    withButton(e.currentTarget, async () => {
      try {
        const backup = await api.exportBackup();
        download(`pip-boy-companion-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2));
        notify(`Backup downloaded with ${backup.records.length} record(s).`);
        log(`Exported backup with ${backup.records.length} record(s)`);
      } catch (err) {
        notify(err.message, true);
      }
    }),
  );

  $('backup-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('Backup file is larger than 5 MB');
      let data;
      try {
        data = JSON.parse(await file.text());
      } catch {
        throw new Error('That file is not valid JSON');
      }
      const summary = await api.previewImport(data);
      pending = data;
      const skipped = summary.skipped.length ? ` ${summary.skipped.length} preset(s) will be skipped because the frequency is already saved.` : '';
      const settings = { create: 'a settings profile will be created', update: 'your settings profile will be replaced', none: 'no settings profile' }[summary.settings];
      $('restore-description').textContent =
        `${file.name}: ${summary.apps} app(s) and ${summary.radio} preset(s) will be added; ${settings}.${skipped} Review before continuing.`;
      $('restore-preview').hidden = false;
      log(`Reviewed backup file: ${file.name}`);
    } catch (err) {
      hidePreview();
      notify(`Invalid companion backup: ${err.message}`, true);
      log(`ERROR: Invalid companion backup: ${err.message}`, 'error');
    }
  });

  $('cancel-restore').addEventListener('click', hidePreview);

  $('confirm-restore').addEventListener('click', (e) =>
    withButton(e.currentTarget, async () => {
      if (!pending) return;
      try {
        const result = await api.importBackup(pending);
        hidePreview();
        await records.reload();
        notify(`Imported ${result.imported} record(s).`);
        log(`Imported ${result.imported} backup record(s); skipped ${result.skipped.length}`);
      } catch (err) {
        // Import is atomic on the server: nothing was written.
        notify(`Import failed, nothing was changed: ${err.message}`, true);
        log(`ERROR: Import failed: ${err.message}`, 'error');
      }
    }),
  );
}
