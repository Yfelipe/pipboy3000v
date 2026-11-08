// Dashboard counters, App manager, FM presets and Settings editor.
import { $, escapeHtml, empty, notify, iconRefresh, download, withButton } from '../ui.js';
import { records, onRecords } from '../records.js';
import { log } from '../activity.js';
import { parseFrequency, SETTINGS_DEFAULTS } from '../../../shared/validate.js';

const SETTING_FIELDS = [
  ['brightness', 'setting-brightness'],
  ['volume', 'setting-volume'],
  ['theme', 'setting-theme'],
  ['clock', 'setting-clock'],
];

export function settingsPayload() {
  return Object.fromEntries(SETTING_FIELDS.map(([key, id]) => [key, $(id).value]));
}

function fail(message) {
  notify(message, true);
  log(`ERROR: ${message}`, 'error');
}

function itemHtml(r, detail) {
  return `<div class="item" data-id="${r.id}"><div class="item-main"><strong>${escapeHtml(r.name)}</strong><span>${escapeHtml(detail)}</span></div>` +
    `<div class="item-actions"><button class="mini danger" data-remove="${r.id}" aria-label="Remove ${escapeHtml(r.name)}">Remove</button></div></div>`;
}

function render() {
  const status = $('record-status');
  $('server-down').classList.toggle('show', !!records.error && records.error.status === 0);
  $('records-retry').hidden = !records.error;
  if (!records.ready) {
    status.textContent = records.error ? 'RECORDS UNAVAILABLE' : 'LOADING RECORDS...';
    return;
  }
  const all = records.all();
  status.textContent = `${all.length} SAVED RECORD${all.length === 1 ? '' : 'S'}`;
  const apps = records.byKind('app');
  const radio = records.byKind('radio').sort((a, b) => Number(a.payload.frequency) - Number(b.payload.frequency));
  $('app-count').textContent = apps.length;
  $('preset-count').textContent = radio.length;
  $('apps-total').textContent = `${apps.length} ${apps.length === 1 ? 'NOTE' : 'NOTES'}`;
  $('radio-total').textContent = `${radio.length} PRESETS`;
  $('apps-list').innerHTML = apps.length
    ? apps.map((r) => itemHtml(r, `${r.payload.version || 'No version note'} · Added ${new Date(r.created_at).toLocaleDateString()}`)).join('')
    : empty('No notes yet', 'Add an app name above to keep track of it.');
  $('radio-list').innerHTML = radio.length
    ? radio.map((r) => itemHtml(r, `${r.payload.frequency} MHz FM`)).join('')
    : empty('No stations yet', 'Add a station and its frequency above.');

  const settings = records.settings();
  $('settings-state').textContent = settings ? 'SAVED PROFILE' : 'DEFAULT PROFILE';
  if (!document.activeElement?.closest('#settings-form')) {
    const values = settings?.payload ?? SETTINGS_DEFAULTS;
    for (const [key, id] of SETTING_FIELDS) $(id).value = values[key];
  }
  iconRefresh();
}

async function loadRecords() {
  const button = $('records-retry');
  await withButton(button, async () => {
    $('record-status').textContent = 'LOADING RECORDS...';
    const ok = await records.load();
    if (!ok) {
      const message = records.error?.message ?? 'Records unavailable';
      notify(`${message} Device controls remain usable.`, true);
      log(`Records unavailable: ${message}`, 'error');
    }
  });
}

export function initRecordPages() {
  onRecords(render);
  $('records-retry').addEventListener('click', loadRecords);

  document.addEventListener('click', async (e) => {
    const del = e.target.closest('[data-remove]');
    if (!del) return;
    const id = Number(del.dataset.remove);
    const record = records.all().find((r) => r.id === id);
    if (!record) return fail('That entry is no longer available.');
    await withButton(del, async () => {
      try {
        await records.remove(id);
        notify('Entry removed.');
        log(`Removed ${record.kind}: ${record.name}`);
      } catch (err) {
        fail(`Could not remove entry: ${err.message}`);
      }
    });
  });

  $('app-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('app-name').value.trim();
    if (!name) return fail('Enter an app name.');
    if (!records.ready) return fail('Saved records are not ready. Retry loading first.');
    await withButton(e.submitter, async () => {
      try {
        await records.create({ kind: 'app', name, payload: { version: $('app-version').value.trim() } });
        notify('Note saved.');
        log(`Saved app note: ${name}`);
        e.target.reset();
      } catch (err) {
        fail(err.message);
      }
    });
  });

  $('radio-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('station-name').value.trim();
    let frequency;
    try {
      if (!name) throw new Error('Enter a station name.');
      frequency = parseFrequency($('station-frequency').value);
    } catch (err) {
      return fail(err.message);
    }
    if (!records.ready) return fail('Saved records are not ready. Retry loading first.');
    await withButton(e.submitter, async () => {
      try {
        await records.create({ kind: 'radio', name, payload: { frequency } });
        notify('Station saved.');
        log(`Saved radio preset: ${name} (${frequency} MHz)`);
        e.target.reset();
      } catch (err) {
        fail(err.message);
      }
    });
  });

  $('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!records.ready) return fail('Saved records are not ready.');
    await withButton(e.submitter, async () => {
      try {
        await records.saveSettings(settingsPayload());
        notify('Profile saved.');
        log('Updated settings profile');
      } catch (err) {
        fail(err.message);
      }
    });
  });

  $('export-settings').addEventListener('click', () => {
    download('pip-boy-settings.json', JSON.stringify({ format: 'pip-boy-companion-settings', settings: settingsPayload() }, null, 2));
    log('Exported settings JSON');
  });

  return loadRecords();
}
