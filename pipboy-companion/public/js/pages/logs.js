// Log viewer: persisted activity plus optional per-transaction device trace.
import { $, escapeHtml, empty, notify, download, iconRefresh, confirmDialog } from '../ui.js';
import { onActivity, getEntries, clearAll, loadHistory, log, flush } from '../activity.js';
import { api } from '../api.js';

const RENDER_LIMIT = 500;

function render() {
  const shown = getEntries({ q: $('log-filter').value, includeDebug: $('log-debug').checked });
  const visible = shown.slice(0, RENDER_LIMIT);
  $('log-list').innerHTML = visible.length
    ? visible
        .map((x) => `<div class="log-entry"><time datetime="${x.at}">${new Date(x.at).toLocaleString()}</time><span>${escapeHtml(x.message)}</span></div>`)
        .join('') + (shown.length > RENDER_LIMIT ? `<p class="help">Showing newest ${RENDER_LIMIT} of ${shown.length}. Export for the full list.</p>` : '')
    : empty('No matching activity', 'Actions will appear here and are kept between sessions.');
  iconRefresh();
}

export function initLogs() {
  onActivity(() => {
    if ($('logs').classList.contains('active')) render();
  });
  document.addEventListener('pagechange', (e) => {
    if (e.detail === 'logs') render();
  });
  $('log-filter').addEventListener('input', render);
  $('log-debug').addEventListener('change', render);

  $('clear-logs').addEventListener('click', async () => {
    if (!(await confirmDialog({ title: 'Clear the activity log?', body: 'Every saved entry is deleted.', confirm: 'Clear', danger: true }))) return;
    try {
      await clearAll();
      notify('Logs cleared.');
    } catch (e) {
      notify(e.message, true);
    }
    render();
  });

  $('export-logs').addEventListener('click', async () => {
    let entries;
    try {
      await flush();
      entries = await api.listLogs(5000);
    } catch {
      entries = getEntries();
    }
    if (!entries.length) return notify('There are no logs to export.', true);
    download('pip-boy-companion-logs.txt', entries.reverse().map((x) => `${x.at}  ${x.level.toUpperCase().padEnd(5)}  ${x.message}`).join('\n'), 'text/plain');
    log('Exported logs');
  });

  render();
  return loadHistory().catch(() => {});
}
