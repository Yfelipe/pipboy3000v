// "Send to Pip-Boy" for the radio presets and the settings profile: one click saves (where
// needed), connects if necessary, writes the JSON file and checks it.
import { $, notify } from '../ui.js';
import { records } from '../records.js';
import { session } from '../device/state.js';
import { runJob } from '../device/jobs.js';
import { settingsPayload } from './records-pages.js';
import * as ops from '../serial/device-ops.js';

function sendJson(title, name, value) {
  return runJob(title, async (j) => {
    j.step(`Writing ${name}`);
    await ops.storageWrite(session, name, ops.utf8(JSON.stringify(value)), { onProgress: j.progress });
    j.finish(`${name} is on the Pip-Boy.`);
  });
}

export function initCompanionSync() {
  $('device-radio').addEventListener('click', () => {
    const presets = records.byKind('radio').map((r) => ({ name: r.name, frequency: r.payload.frequency }));
    if (!presets.length) return notify('Add a station first.', true);
    return sendJson('Send radio presets', 'companion-radio.json', presets);
  });
  $('device-settings').addEventListener('click', async () => {
    const payload = settingsPayload();
    if (records.ready) {
      try {
        await records.saveSettings(payload);
      } catch (e) {
        notify(`Couldn’t save the profile on this computer: ${e.message}`, true);
      }
    }
    return sendJson('Send settings profile', 'companion-settings.json', payload);
  });
}
