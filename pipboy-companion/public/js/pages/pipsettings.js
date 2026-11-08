// Pip-Boy settings: the firmware's own settings (settings.json on the SD card), edited live
// through its saveSettings() when the stock interface is running.
import { $ } from '../ui.js';
import { log } from '../activity.js';
import { session, device, onDeviceChange } from '../device/state.js';
import { runJob } from '../device/jobs.js';
import { expr } from '../serial/protocol.js';
import { needsConnection } from '../device/views.js';
import { clockSyncEnabled, setClockSync } from '../device/clocksync.js';
import { DEFAULT_COLOR, COLOR_PRESETS, palettes, paletteRgba, toGrey, quantize } from '../pipimage.js';

let loaded = null; // { live, settings, time, rtc, calibrated, readAt }

const localZone = () => -new Date().getTimezoneOffset() / 60;
const zoneLabel = (h) => `UTC${h >= 0 ? '+' : '−'}${Math.floor(Math.abs(h))}${Math.abs(h) % 1 ? `:${String(Math.round((Math.abs(h) % 1) * 60)).padStart(2, '0')}` : ''}`;

function fillZones(selected) {
  const zones = [];
  for (let h = -12; h <= 14; h += 0.5) if (Number.isInteger(h) || [-9.5, -3.5, 3.5, 4.5, 5.5, 6.5, 9.5, 10.5].includes(h)) zones.push(h);
  if (!zones.includes(selected)) zones.push(selected);
  zones.sort((a, b) => a - b);
  const here = localZone();
  $('ps-tz').innerHTML = zones
    .map((h) => `<option value="${h}"${h === selected ? ' selected' : ''}>${zoneLabel(h)}${h === here ? ' (this computer)' : ''}</option>`)
    .join('');
}

function setSelect(id, value) {
  const el = $(id);
  const v = String(value);
  if (![...el.options].some((o) => o.value === v)) el.add(new Option(`${value}`, v));
  el.value = v;
}

// ------------------------------------------------------------ display colour
let colour = { ...DEFAULT_COLOR };
let mock = null; // the preview screen as 0..3 levels

const hex = ({ r, g, b }) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const fromHex = (h) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) });

/** A stand-in screen (tabs, a menu with the selected row, a footer) in the four shades. */
function mockScreen() {
  const c = Object.assign(document.createElement('canvas'), { width: 400, height: 210 });
  const x = c.getContext('2d');
  const shade = (l) => `rgb(${[0, 85, 170, 255][l]},${[0, 85, 170, 255][l]},${[0, 85, 170, 255][l]})`;
  x.fillStyle = shade(0);
  x.fillRect(0, 0, 400, 210);
  x.font = '700 18px "Rajdhani", "Arial Narrow", sans-serif';
  x.textBaseline = 'middle';
  ['STAT', 'INV', 'DATA', 'MAP', 'RADIO'].forEach((t, i) => {
    x.fillStyle = shade(i === 2 ? 3 : 2);
    x.fillText(t, 30 + i * 72, 16);
  });
  x.strokeStyle = shade(3);
  x.beginPath();
  x.moveTo(0, 30); x.lineTo(166, 30); x.lineTo(166, 6); x.moveTo(222, 6); x.lineTo(222, 30); x.lineTo(400, 30);
  x.stroke();
  ['Set date & time', 'Timezone', 'Display timeout', 'Display colour', 'About'].forEach((t, i) => {
    const y = 48 + i * 28;
    if (i === 3) { x.fillStyle = shade(3); x.fillRect(10, y - 12, 380, 25); }
    x.fillStyle = shade(i === 3 ? 0 : 3);
    x.fillText(t, 20, y);
  });
  x.fillStyle = shade(1);
  x.fillRect(0, 188, 400, 22);
  x.fillStyle = shade(3);
  x.fillText('12:45   HP ████████   AP ██████', 20, 199);
  return quantize(toGrey(x.getImageData(0, 0, 400, 210).data));
}

function drawColour() {
  mock ??= mockScreen();
  const canvas = $('ps-colour-canvas');
  canvas.getContext('2d').putImageData(new ImageData(paletteRgba(mock, 400, palettes(colour)), 400, 210), 0, 0);
  $('ps-col').value = hex(colour);
  $('ps-scan').value = colour.scanline;
  $('ps-glow').value = colour.overscan;
  for (const b of document.querySelectorAll('#ps-presets [data-preset]')) {
    const p = COLOR_PRESETS[b.dataset.preset].color;
    b.setAttribute('aria-pressed', String(p.r === colour.r && p.g === colour.g && p.b === colour.b));
  }
}

async function saveColour() {
  const c = { r: colour.r | 0, g: colour.g | 0, b: colour.b | 0, scanline: colour.scanline | 0, overscan: colour.overscan | 0 };
  const r = await runJob('Set the display colour', async (j) => {
    j.step('Applying the colour');
    const how = await session.transaction(expr.pipPalette(c), 'value', { timeout: 10_000 });
    log(`Display colour set (${how}): ${JSON.stringify(c)}`);
    j.finish(how === 'live' ? 'The Pip-Boy is showing the new colour.' : 'Saved. The stock interface uses it from its next start.');
  }, { refresh: false });
  if (r.ok && loaded?.settings) loaded.settings.color = c;
}

function render() {
  const form = $('ps-form');
  $('ps-colour').hidden = !(session.connected && loaded?.settings);
  if (!session.connected) {
    form.hidden = true;
    $('ps-empty').innerHTML = needsConnection('its settings');
    return;
  }
  if (!loaded) {
    form.hidden = true;
    $('ps-empty').innerHTML = '<p class="help">Reading the Pip-Boy’s settings…</p>';
    return;
  }
  if (!loaded.settings) {
    form.hidden = true;
    $('ps-empty').innerHTML =
      '<div class="empty"><strong>No settings found</strong><p>The Pip-Boy keeps its settings in settings.json on the SD card. Check the card is in, then press Reload.</p><button class="btn small mt-12" id="ps-empty-reload">Reload</button></div>';
    return;
  }
  $('ps-empty').innerHTML = loaded.live
    ? ''
    : '<p class="notice mb-18">The stock interface isn’t running (an app is), so changes are written to settings.json and take effect when the Pip-Boy restarts.</p>';
  form.hidden = false;
  if (document.activeElement?.closest('#ps-form')) return; // don't overwrite while editing
  const s = loaded.settings;
  if (s.color && Number.isFinite(s.color.r)) colour = { ...DEFAULT_COLOR, ...s.color };
  drawColour();
  $('ps-autoclock').checked = clockSyncEnabled();
  $('ps-name').value = s.userName ?? '';
  setSelect('ps-idle', Number.isFinite(s.idleTimeout) ? s.idleTimeout : 300000); // 0 = never, as the firmware's menu
  $('ps-clock').value = String(!!s.clock12hr);
  fillZones(Number.isFinite(s.timezone) ? s.timezone : 0);
  setSelect('ps-fallback', s.fallbackMode ?? 0);
  const rtc = loaded.rtc ?? s.rtcCalibration;
  $('ps-rtc').textContent = Number.isFinite(rtc)
    ? `${rtc > 0 ? '+' : ''}${rtc.toFixed(1)} ppm${loaded.calibrated ? ' · calibrated automatically' : ''}`
    : 'Not available (needs Pip-OS 1.33)';
  const drift = (loaded.time - loaded.readAt) / 1000;
  $('ps-clock-state').textContent =
    Math.abs(drift) < 5 ? 'The Pip-Boy’s clock matches this computer.' : `The Pip-Boy’s clock is ${Math.abs(drift) > 120 ? `${Math.round(Math.abs(drift) / 60)} minutes` : `${Math.round(Math.abs(drift))} seconds`} ${drift > 0 ? 'ahead of' : 'behind'} this computer.`;
}

async function read(quiet = true) {
  const r = await runJob(
    'Read the Pip-Boy’s settings',
    async () => {
      const res = await session.transaction(expr.pipSettings(), 'value', { timeout: 10_000, replyBytes: 2000 });
      loaded = { ...res, readAt: Date.now() };
    },
    { refresh: false, quiet },
  );
  render();
  return r;
}

function patchFromForm() {
  return {
    userName: $('ps-name').value.trim(),
    idleTimeout: Number($('ps-idle').value),
    clock12hr: $('ps-clock').value === 'true',
    timezone: Number($('ps-tz').value),
    fallbackMode: Number($('ps-fallback').value),
  };
}

async function save(e) {
  e?.preventDefault();
  const patch = patchFromForm();
  if (!patch.userName) delete patch.userName;
  const r = await runJob('Save Pip-Boy settings', async (j) => {
    j.step('Writing the settings');
    const how = await session.transaction(expr.pipSettingsWrite(patch), 'value', { timeout: 10_000 });
    log(`Pip-Boy settings saved (${how}): ${JSON.stringify(patch)}`);
    j.finish(how === 'live' ? 'Saved. The Pip-Boy is using the new settings.' : 'Saved to settings.json. They take effect when the Pip-Boy restarts.');
  }, { refresh: false });
  if (r.ok) await read();
}

async function setClock() {
  const r = await runJob('Set the Pip-Boy’s clock', async (j) => {
    j.step('Setting the time and time zone');
    const tz = Number($('ps-tz').value);
    await session.transaction(expr.pipSettingsWrite({ timezone: tz }), 'value', { timeout: 10_000 });
    await session.transaction(expr.pipSetTime(Date.now()), 'value', { timeout: 10_000 });
    j.finish(`The Pip-Boy’s clock is set to this computer’s time (${zoneLabel(tz)}).`);
  }, { refresh: false });
  if (r.ok) await read();
}

export function initPipSettings() {
  $('ps-presets').innerHTML = COLOR_PRESETS.map((p, i) => `<button type="button" class="swatch" data-preset="${i}" aria-pressed="false"><i data-colour="${hex(p.color)}"></i>${p.name}</button>`).join('');
  $('ps-presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    colour = { ...colour, ...COLOR_PRESETS[b.dataset.preset].color };
    drawColour();
  });
  $('ps-col').addEventListener('input', (e) => { colour = { ...colour, ...fromHex(e.target.value) }; drawColour(); });
  $('ps-scan').addEventListener('input', (e) => { colour.scanline = Number(e.target.value); drawColour(); });
  $('ps-glow').addEventListener('input', (e) => { colour.overscan = Number(e.target.value); drawColour(); });
  $('ps-colour-reset').addEventListener('click', () => { colour = { ...DEFAULT_COLOR }; drawColour(); });
  $('ps-colour-save').addEventListener('click', saveColour);
  $('ps-autoclock').addEventListener('change', (e) => setClockSync(e.target.checked));
  $('ps-form').addEventListener('submit', save);
  $('ps-time').addEventListener('click', setClock);
  $('ps-reload').addEventListener('click', () => read(false));
  $('ps-empty').addEventListener('click', (e) => {
    if (e.target.closest('#ps-empty-reload')) read(false);
  });
  document.addEventListener('pagechange', (e) => {
    if (e.detail === 'pipsettings' && session.connected && !device.busy) read();
  });
  let wasConnected = false;
  onDeviceChange(() => {
    if (!session.connected) loaded = null;
    if (session.connected && !wasConnected && $('pipsettings').classList.contains('active')) setTimeout(() => !device.busy && read(), 300);
    wasConnected = session.connected;
    render();
  });
  render();
}

