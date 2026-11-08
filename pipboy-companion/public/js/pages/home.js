// Home: how to connect, then the device at a glance and the common tasks.
import { $, notify } from '../ui.js';
import { device, session, serialAvailable, onDeviceChange, connect, storageUsage, refreshInfo } from '../device/state.js';
import { storageMeter } from '../device/views.js';
import { backUpStorage, freeUpSpace, restartPipBoy } from '../device/bundles.js';
import { runJob } from '../device/jobs.js';
import { expr } from '../serial/protocol.js';
import { log } from '../activity.js';

/** The Pip-Boy's fonts are plain ASCII: fold accents and smart quotes, drop the rest. */
export function pipText(text) {
  return text
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e\n]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function sendMessage(e) {
  e.preventDefault();
  const text = pipText($('msg-text').value);
  if (!text) return notify('Type a message first (the Pip-Boy shows plain letters, digits and punctuation).', true);
  const r = await runJob('Send a message', async (j) => {
    j.step('Sending it to the Pip-Boy');
    const res = await session.transaction(expr.pipMessage(text, Date.now()), 'value', { timeout: 10_000 });
    log(`Message sent (${res.live ? 'shown' : 'saved'}): ${text}`);
    if (res.app) j.finish('Shown on the Pip-Boy, and kept in the app’s DATA › INBOX.');
    else if (res.live) j.finish(`Shown on the Pip-Boy${res.inbox ? ', and kept in STAT › INBOX' : ''}.`);
    else if (res.inbox) j.finish('The Pip-Boy isn’t showing its menus right now (it’s asleep or running an app), so the message waits in STAT › INBOX (or DATA › INBOX in Mojave UI and PIP-OS X).');
    else {
      j.finish('The Pip-Boy isn’t showing its menus right now, so the message is saved on its SD card. Read it in DATA › INBOX in Mojave UI or PIP-OS X, or install the Inbox extension for the stock interface.');
      j.offer([{ label: 'Go to extensions', primary: true, run: () => document.querySelector('[data-page="apps"]').click() }]);
    }
  }, { refresh: false });
  if (r.ok) $('msg-text').value = '';
}

function render() {
  const online = session.connected;
  $('home-offline').hidden = online;
  $('home-online').hidden = !online;
  const connecting = device.phase === 'connecting' || device.phase === 'restarting';
  const button = $('home-connect');
  button.disabled = !serialAvailable || connecting;
  button.lastChild.textContent = device.phase === 'restarting' ? ' Restarting…' : connecting ? ' Connecting…' : ' Connect';
  $('home-error').hidden = !device.error;
  $('home-error').textContent = device.error ? `Couldn’t connect: ${device.error}` : '';
  if (!online) return;
  const info = device.info;
  $('home-firmware').textContent = info ? [info.version && `Espruino ${info.version}`, info.firmware && `Pip-Boy ${info.firmware}`].filter(Boolean).join(' · ') || 'Unknown' : 'Reading…';
  $('home-sd').textContent = info ? (info.sd ? 'Inserted' : 'Not found') : '…';
  const s = session.pipState;
  $('home-power').textContent = s ? `${s.sleeping === true ? 'Asleep' : s.sleeping === 'BUSY' ? 'Starting up' : 'Awake'}${s.usbPower ? ' · charging over USB' : ''}` : '—';
  $('home-storage').innerHTML = storageMeter(storageUsage());
  const trash = info?.stats?.trashBytes ?? 0;
  $('home-free').classList.toggle('attention', trash > 4096);
}

export function initHome() {
  $('home-support').textContent = serialAvailable
    ? 'Works in Chrome and Edge. Close the Espruino IDE first if it’s open: only one program can use the connection.'
    : 'Connecting needs Chrome or Edge, with this page opened from localhost. Everything under Companion works without a Pip-Boy.';
  $('home-connect').addEventListener('click', () => connect());
  $('home-refresh').addEventListener('click', () => refreshInfo());
  $('home-backup').addEventListener('click', backUpStorage);
  $('home-free').addEventListener('click', () => freeUpSpace());
  $('home-restart').addEventListener('click', restartPipBoy);
  $('msg-form').addEventListener('submit', sendMessage);
  onDeviceChange(render);
  render();
}
