// Firmware page: local image inspection only. No browser flashing.
import { $ } from '../ui.js';
import { formatSize } from '../../../shared/validate.js';

export function initFirmware() {
  $('firmware-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const info = $('firmware-info');
    if (!file) {
      info.textContent = 'No image selected.';
      return;
    }
    if (!/\.(bin|hex|dfu)$/i.test(file.name) || !file.size || file.size > 32 * 1024 * 1024) {
      info.textContent = 'Unsupported extension, empty file, or image over 32 MB. No flashing available.';
      return;
    }
    info.textContent = `${file.name} · ${formatSize(file.size)} · calculating SHA-256...`;
    try {
      const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
      const hex = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
      info.textContent = `${file.name} · ${formatSize(file.size)} · SHA-256: ${hex} (compare with vendor checksum)`;
    } catch {
      info.textContent = `${file.name} · ${formatSize(file.size)} · checksum unavailable in this context`;
    }
  });

  $('flash-check').addEventListener('click', () => {
    $('flash-capability').textContent =
      `WebUSB: ${navigator.usb ? 'available' : 'unavailable'}; Web Serial: ${navigator.serial ? 'available' : 'unavailable'}. ` +
      `Neither establishes compatibility with this device's DFU protocol. ` +
      `${$('firmware-confirm').checked ? 'Risk acknowledged;' : 'Read and acknowledge the risk before any external flashing.'} ` +
      'Browser upload is disabled; use a verified local dfu-util/vendor recovery procedure.';
  });
}
