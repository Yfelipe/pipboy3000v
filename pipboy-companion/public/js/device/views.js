// Small render helpers shared by the device pages.
import { escapeHtml, empty } from '../ui.js';
import { formatSize } from '../../../shared/validate.js';
import { serialAvailable } from './state.js';

/** Storage usage bar: used / reclaimable / free. `usage` from storageUsage(). */
export function storageMeter(usage) {
  if (!usage) return '<p class="help">Connect to see how much space is left.</p>';
  if (!usage.exact) return `<p class="help">${formatSize(usage.used)} of files. This firmware doesn’t report free space.</p>`;
  const pct = (n) => `${((n / usage.total) * 100).toFixed(1)}%`;
  const low = usage.free < usage.total * 0.08;
  return (
    `<div class="meter" role="img" aria-label="Storage: ${formatSize(usage.used)} used, ${formatSize(usage.trash)} reclaimable, ${formatSize(usage.free)} free of ${formatSize(usage.total)}">` +
    `<span class="meter-used" data-width="${pct(usage.used)}"></span><span class="meter-trash" data-width="${pct(usage.trash)}"></span></div>` +
    `<div class="meter-legend"><span><i class="key used"></i>${formatSize(usage.used)} used</span>` +
    (usage.trash ? `<span><i class="key trash"></i>${formatSize(usage.trash)} reclaimable</span>` : '') +
    `<span class="${low ? 'warn-text' : ''}"><i class="key free"></i>${formatSize(usage.free)} free</span><span class="muted">of ${formatSize(usage.total)}</span></div>`
  );
}

/** Empty state for a device list when there's no connection, with a Connect button. */
export function needsConnection(what) {
  return serialAvailable
    ? `<div class="empty"><strong>Not connected</strong><p>Connect your Pip-Boy to see ${escapeHtml(what)}.</p><button class="btn small mt-12" data-connect>Connect</button></div>`
    : empty('Not available in this browser', 'Connecting needs Chrome or Edge with this page opened from localhost.');
}
