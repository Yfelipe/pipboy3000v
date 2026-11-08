// Device jobs: every action that talks to the Pip-Boy runs through runJob(), which
// connects first if needed, shows its steps and progress in one panel (#job), lets the user
// cancel, explains failures in plain words, and records one outcome in the activity log.
import { $, escapeHtml, notify, iconRefresh } from '../ui.js';
import { log } from '../activity.js';
import { session, device, ensureConnected, restart, readInfo } from './state.js';

let current = null;
let hideTimer = null;

/** Plain-language reading of a device error, plus what to do about it. */
export function explain(error) {
  const m = error?.message ?? String(error);
  if (/Unable to find or create file/i.test(m)) return 'The Pip-Boy’s Storage is full. Use “Free up space” to get back the space of deleted files, or remove an app.';
  if (/cancel/i.test(m)) return 'Stopped. Anything finished before you cancelled is kept.';
  if (/Disconnected|Port disconnected|port lost/i.test(m)) return 'The USB connection dropped. Reconnect and run it again.';
  if (/timeout|timed out/i.test(m)) return 'The Pip-Boy stopped answering. Check it’s switched on and the cable is in, then try again. If it keeps happening, restart the Pip-Boy.';
  if (/LOW_MEMORY|memory/i.test(m)) return 'The Pip-Boy ran low on memory. Disconnect, reconnect and try again.';
  // Pip-OS 1.33 reports SD failures as DISK_ERR (older firmware said NO_PATH)
  if (/DISK_ERR/.test(m)) return 'The SD card reported a read/write error. Check the card is seated properly; if it keeps happening, copy its files off with a card reader and check it on a computer.';
  if (/SD not verified|No SD|Could not open/i.test(m)) return 'No SD card answered. Check the card is inserted, then reconnect.';
  return m;
}

function render() {
  const j = current;
  const panel = $('job');
  if (!j) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.dataset.state = j.state;
  $('job-title').textContent = j.title;
  $('job-state').textContent = { running: 'IN PROGRESS', done: 'DONE', failed: 'DID NOT FINISH', cancelled: 'CANCELLED' }[j.state];
  $('job-state').className = `tag ${j.state === 'done' ? 'ok' : j.state === 'running' ? 'warn' : 'bad'}`;
  $('job-steps').innerHTML = j.steps
    .map((s) => `<li data-state="${s.state}"><span class="step-mark" aria-hidden="true"></span><span>${escapeHtml(s.label)}</span></li>`)
    .join('');
  const bar = $('job-progress');
  bar.hidden = j.state !== 'running';
  bar.value = Math.round(j.fraction * 100);
  $('job-message').textContent = j.message;
  $('job-message').hidden = !j.message;
  const details = $('job-details');
  details.hidden = !j.detail;
  $('job-detail-text').textContent = j.detail ?? '';
  $('job-cancel').hidden = j.state !== 'running' || !j.cancellable;
  $('job-close').hidden = j.state === 'running';
  const actions = $('job-actions');
  actions.replaceChildren(
    ...(j.state === 'running' ? [] : j.actions).map(({ label, run, primary }) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: primary ? 'btn' : 'btn secondary', textContent: label });
      b.addEventListener('click', () => {
        close();
        run();
      });
      return b;
    }),
  );
  iconRefresh();
}

function close() {
  clearTimeout(hideTimer);
  if (current?.state === 'running') return;
  current = null;
  render();
}

/**
 * Run `work(job)` as one device operation.
 *   job.step(label)      start the next visible step (finishes the previous one)
 *   job.progress(0..1)   progress of the current step
 *   job.restartAfter()   restart the Pip-Boy when the work is done, and reconnect
 *   job.finish(text)     the message shown on success
 *   job.offer(actions)   buttons shown when finished: [{ label, run, primary }]
 * Options: refresh (re-read the device summary afterwards, default true), cancellable,
 * quiet (for quick lookups: the panel only appears if it takes a while or fails).
 * Resolves { ok, value, error }.
 */
export async function runJob(title, work, { refresh = true, cancellable = true, quiet = false } = {}) {
  if (current?.state === 'running' || device.busy) {
    notify('Wait for the current Pip-Boy task to finish.', true);
    return { ok: false, error: new Error('busy') };
  }
  if (!(await ensureConnected())) return { ok: false, error: new Error('not connected') };
  clearTimeout(hideTimer);
  const j = {
    title,
    state: 'running',
    steps: [],
    fraction: 0,
    message: '',
    detail: null,
    actions: [],
    cancellable,
    quiet,
    wantsRestart: false,
    step(label) {
      for (const s of j.steps) if (s.state === 'active') s.state = 'done';
      j.steps.push({ label, state: 'active' });
      j.fraction = 0;
      if (!j.quiet) render();
    },
    progress(f) {
      j.fraction = Math.max(0, Math.min(1, f));
      $('job-progress').value = Math.round(j.fraction * 100);
    },
    restartAfter() {
      j.wantsRestart = true;
    },
    finish(text) {
      j.message = text;
    },
    offer(actions) {
      j.actions = actions;
    },
  };
  // A quiet job leaves whatever the panel shows alone unless it turns out to be slow.
  let showTimer = null;
  if (quiet) {
    showTimer = setTimeout(() => {
      j.quiet = false;
      current = j;
      render();
    }, 1500);
  } else {
    current = j;
    render();
  }

  let result;
  try {
    result = await session.run(title, async () => {
      const value = await work(j);
      if (refresh && !j.wantsRestart) await readInfo().catch(() => {});
      return value;
    });
  } catch (error) {
    // run() refuses to start (connection lost or another task started in between)
    result = { ok: false, error, row: { status: 'unavailable', operationId: '–' } };
  }

  if (result.ok && j.wantsRestart) {
    j.step('Restarting the Pip-Boy and reconnecting');
    j.cancellable = false;
    render();
    const back = await restart();
    if (!back) {
      j.state = 'done';
      for (const s of j.steps) if (s.state === 'active') s.state = 'done';
      j.message = `${j.message ? `${j.message} ` : ''}The Pip-Boy is restarting but hasn't reconnected yet. When its screen is back, press Connect.`;
      render();
      return result;
    }
  }

  clearTimeout(showTimer);
  if (result.ok && j.quiet) return result; // finished before the panel was due
  current = j;
  if (result.ok) {
    j.state = 'done';
    for (const s of j.steps) if (s.state === 'active') s.state = 'done';
    j.message ||= `${title}: done.`;
    log(`${title}: done`);
    // Leave the result up long enough to read; it stays if it offers follow-up actions.
    if (!j.actions.length) hideTimer = setTimeout(() => current === j && close(), 12_000);
  } else {
    const cancelled = /cancel/i.test(result.error.message);
    j.state = cancelled ? 'cancelled' : 'failed';
    for (const s of j.steps) if (s.state === 'active') s.state = 'failed';
    j.message = explain(result.error);
    j.detail = `${result.row.status} · operation #${result.row.operationId} · ${result.error.message}`;
  }
  render();
  return result;
}

export function initJobs() {
  $('job-cancel').addEventListener('click', () => {
    session.requestCancel();
    $('job-cancel').disabled = true;
    $('job-message').hidden = false;
    $('job-message').textContent = 'Stopping after the current step…';
    setTimeout(() => ($('job-cancel').disabled = false), 1500);
  });
  $('job-close').addEventListener('click', close);
  $('device-wake').addEventListener('click', () =>
    runJob(
      'Wake the Pip-Boy',
      async (j) => {
        j.step('Waking the Pip-Boy');
        const r = await session.wake();
        if (r === 'waking') await new Promise((res) => setTimeout(res, 2500));
        await session.readPipState();
        await session.probeWake(); // transfer speed depends on whether it's awake
        j.finish('The Pip-Boy is awake.');
      },
      { cancellable: false },
    ),
  );
}
