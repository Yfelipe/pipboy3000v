// Long-lived SD-card workspace backed by the server (data/workspace/).
import { $, escapeHtml, empty, notify, iconRefresh, download, withButton, confirmDialog, promptDialog } from '../ui.js';
import { api } from '../api.js';
import { log } from '../activity.js';
import { formatSize, sanitizeWorkspaceName } from '../../../shared/validate.js';

let files = [];
const listeners = new Set();

export const workspace = {
  files: () => files,
  onChange(fn) {
    listeners.add(fn);
  },
  async refresh() {
    try {
      files = await api.listFiles();
    } catch (e) {
      files = [];
      $('workspace-list').innerHTML = empty('Workspace unavailable', e.message);
      $('file-count').textContent = '—';
      return;
    }
    render();
    for (const fn of listeners) fn(files);
  },
  /** Save bytes produced elsewhere (device backups, SD downloads). Never overwrites: adds a suffix. */
  async saveCopy(name, blob) {
    const base = sanitizeWorkspaceName(name);
    const dot = base.lastIndexOf('.');
    const [stem, ext] = dot > 0 ? [base.slice(0, dot), base.slice(dot)] : [base, ''];
    for (let n = 0; n < 50; n++) {
      const candidate = n ? `${stem} (${n})${ext}` : base;
      try {
        const info = await api.uploadFile(candidate, blob);
        await this.refresh();
        return info;
      } catch (e) {
        if (e.status !== 409) throw e;
      }
    }
    throw new Error('Too many files with that name in the workspace');
  },
};

function render() {
  $('file-count').textContent = files.length;
  $('workspace-total').textContent = `${files.length} FILE${files.length === 1 ? '' : 'S'}`;
  $('workspace-list').innerHTML = files.length
    ? files
        .map(
          (f) =>
            `<div class="item"><div class="item-main"><strong>${escapeHtml(f.name)}</strong>` +
            `<span>${formatSize(f.size)} · saved ${new Date(f.modified_at).toLocaleString()} · ${f.media.ok ? 'media check passed' : escapeHtml(f.media.message)}</span></div>` +
            `<div class="item-actions"><button class="mini" data-ws-send="${escapeHtml(f.name)}" title="Copy to the Pip-Boy’s SD card">Copy to SD</button>` +
            `<a class="mini" href="${api.fileUrl(f.name)}" download="${escapeHtml(f.name)}">Download</a>` +
            `<button class="mini danger" data-ws-delete="${escapeHtml(f.name)}" aria-label="Delete ${escapeHtml(f.name)}">Delete</button></div></div>`,
        )
        .join('')
    : empty('Workspace is empty', 'Choose files to keep them here between sessions.');
  iconRefresh();
}

async function upload(fileList) {
  let saved = 0;
  for (const file of fileList) {
    const name = sanitizeWorkspaceName(file.name);
    try {
      try {
        await api.uploadFile(name, file);
      } catch (e) {
        if (e.status !== 409) throw e;
        if (!(await confirmDialog({ title: `Replace ${name}?`, body: `${name} is already in the workspace.`, confirm: 'Replace' }))) continue;
        await api.uploadFile(name, file, { overwrite: true });
      }
      saved++;
      log(`Saved to workspace: ${name}${name !== file.name ? ` (from "${file.name}")` : ''}`);
    } catch (e) {
      notify(`Could not save ${file.name}: ${e.message}`, true);
      log(`ERROR: Could not save ${file.name}: ${e.message}`, 'error');
    }
  }
  if (saved) notify(`${saved} file(s) saved to the workspace.`);
  await workspace.refresh();
}

async function sendToSd(name) {
  const folder = await promptDialog({
    title: `Copy ${name} to the SD card`,
    body: 'A file with the same name in that folder is replaced.',
    label: 'Folder on the SD card',
    value: '/',
    placeholder: '/MUSIC',
    confirm: 'Copy',
  });
  if (!folder) return;
  const dir = ('/' + folder.replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '/');
  let bytes;
  try {
    bytes = await api.fetchFile(name);
  } catch (e) {
    return notify(e.message, true);
  }
  const { copyToSd } = await import('../device/bundles.js');
  await copyToSd(dir, [{ name, bytes }]);
}

export function initWorkspace() {
  const drop = $('workspace-drop');
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const list = [...(e.dataTransfer?.files ?? [])];
    if (list.length) await upload(list);
  });

  $('workspace-files').addEventListener('change', async (e) => {
    const list = [...e.target.files];
    e.target.value = '';
    if (list.length) await upload(list);
  });

  $('workspace-list').addEventListener('click', async (e) => {
    const send = e.target.closest('[data-ws-send]');
    if (send) return sendToSd(send.dataset.wsSend);
    const button = e.target.closest('[data-ws-delete]');
    if (!button) return;
    const name = button.dataset.wsDelete;
    if (!(await confirmDialog({ title: `Delete ${name}?`, body: 'It’s deleted from this computer. This can’t be undone.', confirm: 'Delete', danger: true }))) return;
    await withButton(button, async () => {
      try {
        await api.deleteFile(name);
        log(`Deleted from workspace: ${name}`);
        notify('File deleted.');
      } catch (err) {
        notify(err.message, true);
      }
      await workspace.refresh();
    });
  });

  $('export-manifest').addEventListener('click', () => {
    if (!files.length) return notify('Add files before exporting a manifest.', true);
    download(
      'pip-boy-sd-manifest.json',
      JSON.stringify({ format: 'pip-boy-sd-manifest', exported_at: new Date().toISOString(), files: files.map(({ name, size, modified_at }) => ({ name, size, modified_at })) }, null, 2),
    );
    log('Exported SD-card manifest');
  });

  return workspace.refresh();
}
