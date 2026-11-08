// Diagnostics: connection internals, recovery tools, raw serial output and the live
// status for automation. Nothing here is needed for everyday use.
import { $, escapeHtml, notify } from '../ui.js';
import { log } from '../activity.js';
import { session, device, serialAvailable, onDeviceChange, onRawOutput, connect } from '../device/state.js';

function render() {
  const s = session.status();
  const connected = session.connected;
  $('device-badge').textContent = connected
    ? session.memoryLimited
      ? 'CONNECTED · LOW-MEMORY SAFE MODE'
      : device.asleep
        ? 'CONNECTED · ASLEEP'
        : 'CONNECTED'
    : session.port
      ? 'PORT OPEN · NOT VERIFIED'
      : 'DISCONNECTED';
  $('device-badge').className = `tag ${connected ? 'ok' : 'warn'}`;
  const tx = s.transaction ? `#${s.transaction.id} ${s.transaction.kind}` : 'none';
  $('session-summary').textContent =
    `Port ${s.portOpen ? 'open' : 'closed'} · session ${s.sessionId ?? 'none'} · board ${s.board ?? 'not verified'} · queue ${s.queueStatus} · ` +
    `command ${tx} · transfer mode ${s.transferMode} · last outcome ${s.lastOutcome}`;
  $('safe-mode').textContent = session.memoryLimited ? `Low-memory safe mode: ACTIVE · ${session.deviceError}` : 'Low-memory safe mode: standby';
  $('device-meta').textContent =
    `Web Serial: ${!!navigator.serial} · secure context: ${window.isSecureContext} · port: ${s.portInfo ? JSON.stringify(s.portInfo) : 'none'} · ` +
    `bytes in/out: ${s.bytesIn}/${s.bytesOut} · stale frames: ${s.staleFrameCount} · last disconnect: ${s.disconnectReason}`;
  $('device-choose').disabled = !serialAvailable || session.opening || !!session.port;
  $('device-recover').disabled = !session.writer || session.busy || session.opening;
  $('device-diagnostic').disabled = !session.writer || device.busy;
  $('safe-clear').disabled = !session.port;

  $('agent-status-json').textContent = JSON.stringify(s, null, 1);
  $('agent-contract-state').textContent =
    `Port: ${s.portOpen ? 'open' : 'closed'} · Board: ${s.board ?? 'unverified'} · REPL: ${s.replStatus} · SD: ${s.sdStatus} · ` +
    `Queue: ${s.queueStatus} · Active: ${s.activeOperation ?? 'none'} · Low-memory: ${s.lowMemorySafeMode ? 'active' : 'standby'}`;
  $('agent-action-log').innerHTML = session.history.length
    ? session.history
        .map(
          (r) =>
            `<div class="item"><strong>${escapeHtml(r.action)} · ${escapeHtml(r.status)}</strong><span>#${r.operationId} · ${r.elapsedMs} ms · ` +
            `written ${r.bytesWritten} B / read ${r.bytesRead} B · uncertain write: ${r.uncertainWrite ? 'yes' : 'no'} · next: ${escapeHtml(r.next)}` +
            `${r.detail ? ` · ${escapeHtml(r.detail)}` : ''}</span></div>`,
        )
        .join('')
    : 'No operations yet.';
}

let rawQueued = false;
function renderRaw() {
  if (rawQueued) return;
  rawQueued = true;
  requestAnimationFrame(() => {
    rawQueued = false;
    if (!$('device-diagnostics').open) return;
    $('device-raw').textContent = session.raw
      ? session.raw
          .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .replace(/\r/g, '\\r')
      : 'No serial output captured.';
  });
}

export function initDiagnostics() {
  $('device-capability').textContent = serialAvailable
    ? 'Web Serial is available. The dashboard talks to the Pip-Boy’s Espruino console over USB.'
    : 'Web Serial needs Chrome or Edge with this page opened from localhost or HTTPS.';
  $('device-choose').addEventListener('click', () => connect({ choose: true }));
  $('device-recover').addEventListener('click', async () => {
    if (!session.port || session.busy) return;
    $('device-diagnostics').open = true;
    log('Recover console: sending Ctrl-C (stops whatever the Pip-Boy is running)');
    try {
      await session.recover();
      notify('Recovered: the Pip-Boy is answering.');
    } catch (e) {
      notify(`Recovery failed: ${e.message}. Unplug and re-plug the Pip-Boy, then connect again.`, true);
    }
  });
  $('device-diagnostic').addEventListener('click', async () => {
    try {
      const board = await session.verifyBoard();
      notify(`Connection OK · board ${board ?? 'unknown'}`);
    } catch (e) {
      notify(`No answer: ${e.message}`, true);
      $('device-diagnostics').open = true;
    }
  });
  $('safe-clear').addEventListener('click', () => {
    session.requestCancel();
    if (!session.pending) session.queue = Promise.resolve();
    notify('Queue cleared after the current command.');
  });
  $('device-clear').addEventListener('click', () => {
    session.raw = '';
    renderRaw();
  });
  $('device-diagnostics').addEventListener('toggle', renderRaw);
  $('agent-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText($('agent-status-json').textContent);
      $('agent-copy-result').textContent = 'Copied.';
    } catch {
      $('agent-copy-result').textContent = 'Copy unavailable; select the text to copy it.';
    }
  });
  onRawOutput(renderRaw);
  onDeviceChange(render);
  render();
}
