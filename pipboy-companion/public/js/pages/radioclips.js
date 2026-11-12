// Radio clips: turn your own audio files into clips for the Pip-Boy's RADIO folder. The browser
// decodes each file and resamples it to 16 kHz mono (Web Audio); the WAV is written here
// (radio-tools.js). Clips can be downloaded as a .zip for a card reader, or copied over USB,
// which is slow: about 3 KB a second, so a minute of audio takes around ten minutes.
import { $, escapeHtml, empty, notify, pickFiles, download, iconRefresh } from '../ui.js';
import { log } from '../activity.js';
import { copyToSd } from '../device/bundles.js';
import { SD_MAX_BYTES } from '../serial/device-ops.js';
import { createZip } from '../zip.js';
import { formatSize } from '../../../shared/validate.js';
import { CLIP_RATE, CLIP_TYPES, mixDown, encodeWav, clipNames } from '../radio-tools.js';

let clips = []; // [{ source, type, seconds, bytes }]

const names = () => clipNames(clips.map((c) => c.type), $('clips-start').value);
const duration = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function convert(file) {
  const AC = window.AudioContext ?? window.webkitAudioContext;
  const ctx = new AC();
  let decoded;
  try {
    decoded = await ctx.decodeAudioData(await file.arrayBuffer());
  } finally {
    ctx.close?.();
  }
  // resample by rendering the file into a 16 kHz, one-channel offline context
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * CLIP_RATE)), CLIP_RATE);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const out = await offline.startRendering();
  return { source: file.name, type: 'MX', seconds: out.duration, bytes: encodeWav(mixDown([out.getChannelData(0)])) };
}

function render() {
  const list = names();
  $('clips-list').innerHTML = clips.length
    ? clips
        .map(
          (c, i) =>
            `<div class="item"><div class="item-main"><strong>${escapeHtml(list[i])}</strong><span>${escapeHtml(c.source)} · ${duration(c.seconds)} · ${formatSize(c.bytes.length)}</span></div>` +
            `<div class="item-actions"><select data-clip-type="${i}" aria-label="Kind of clip">${CLIP_TYPES.map((t) => `<option value="${t.id}"${t.id === c.type ? ' selected' : ''}>${escapeHtml(t.name)}</option>`).join('')}</select>` +
            `<button type="button" class="mini danger" data-clip-remove="${i}">Remove</button></div></div>`,
        )
        .join('')
    : empty('No clips yet', 'Choose audio files to convert them.');
  const total = clips.reduce((n, c) => n + c.bytes.length, 0);
  $('clips-total').textContent = clips.length ? `${clips.length} CLIP${clips.length === 1 ? '' : 'S'} · ${formatSize(total)} · ABOUT ${Math.max(1, Math.round(total / 3000 / 60))} MIN OVER USB` : '';
  $('clips-zip').disabled = $('clips-send').disabled = !clips.length;
  iconRefresh();
}

async function choose() {
  const files = await pickFiles({ accept: 'audio/*', multiple: true });
  for (const file of files) {
    try {
      clips.push(await convert(file));
      log(`Radio clip converted: ${file.name}`);
    } catch (e) {
      notify(`${file.name} couldn’t be read as audio: ${e.message}`, true);
    }
    render();
  }
}

export function initRadioClips() {
  $('clips-choose').addEventListener('click', choose);
  $('clips-start').addEventListener('input', render);
  $('clips-list').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-clip-type]');
    if (!sel) return;
    clips[Number(sel.dataset.clipType)].type = sel.value;
    render();
  });
  $('clips-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-clip-remove]');
    if (!b) return;
    clips.splice(Number(b.dataset.clipRemove), 1);
    render();
  });
  $('clips-zip').addEventListener('click', () => {
    const list = names();
    download('pip-boy-radio-clips.zip', new Blob([createZip(clips.map((c, i) => ({ name: `RADIO/${list[i]}`, bytes: c.bytes })))], { type: 'application/zip' }));
    log(`Radio clips downloaded: ${list.join(', ')}`);
  });
  $('clips-send').addEventListener('click', async () => {
    const list = names();
    const big = clips.find((c) => c.bytes.length > SD_MAX_BYTES);
    if (big) return notify(`${big.source} is ${formatSize(big.bytes.length)}: too big to copy over USB. Download the .zip and use a card reader.`, true);
    await copyToSd('/RADIO', clips.map((c, i) => ({ name: list[i], bytes: c.bytes })));
  });
  render();
}
