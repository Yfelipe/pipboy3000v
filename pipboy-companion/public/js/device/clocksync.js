// Keep the Pip-Boy's clock right: each time it connects, if its clock is more than a few
// seconds out, set it to this computer's time (the way its own clock menu does). It can be
// turned off on the Pip-Boy settings page; the choice is kept in this browser.
import { log } from '../activity.js';
import { session, device, onDeviceChange } from './state.js';
import { runJob } from './jobs.js';
import { expr } from '../serial/protocol.js';

const KEY = 'pipboy-clock-sync';
const TOLERANCE_MS = 3000;

export function clockSyncEnabled() {
  try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; }
}
export function setClockSync(on) {
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {}
}

let checkedSession = null; // each connection is checked once

export function initClockSync() {
  onDeviceChange(() => {
    const info = device.info;
    if (!session.connected || !info || device.busy || checkedSession === session.sessionId) return;
    checkedSession = session.sessionId;
    if (!clockSyncEnabled() || info.clockDrift === null || Math.abs(info.clockDrift) < TOLERANCE_MS) return;
    const drift = info.clockDrift;
    setTimeout(() => runJob('Set the Pip-Boy’s clock', async () => {
      await session.transaction(expr.pipSetTime(Date.now()), 'value', { timeout: 10_000 });
      info.clockDrift = 0;
      log(`Pip-Boy clock was ${Math.round(Math.abs(drift) / 1000)} s ${drift > 0 ? 'fast' : 'slow'}; set to this computer's time`);
    }, { refresh: false, quiet: true }), 200);
  });
}
