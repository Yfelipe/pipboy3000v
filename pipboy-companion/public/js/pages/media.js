// Media validator: local-only preliminary checks.
import { $, escapeHtml, empty, iconRefresh } from '../ui.js';
import { log } from '../activity.js';
import { validateMedia, formatSize } from '../../../shared/validate.js';

let results = [];

function render() {
  $('validation-summary').innerHTML = results.length
    ? `<span class="tag ok">${results.filter((x) => x.ok).length} BASIC CHECKS PASSED</span><span class="tag bad">${results.filter((x) => !x.ok).length} NEED REVIEW</span>`
    : '';
  $('media-results').innerHTML = results.length
    ? results
        .map(
          (v) =>
            `<div class="item"><div class="item-main"><strong>${escapeHtml(v.name)}</strong><span>${formatSize(v.size)} · ${escapeHtml(v.message)}</span></div>` +
            `<span class="tag ${v.ok ? 'ok' : 'bad'}">${v.ok ? 'PASS' : 'REVIEW'}</span></div>`,
        )
        .join('')
    : empty('No files checked', 'Select media files to run preliminary checks.');
  iconRefresh();
}

export function initMedia() {
  $('media-files').addEventListener('change', (e) => {
    results = [...e.target.files].map((f) => validateMedia({ name: f.name, size: f.size }));
    e.target.value = '';
    render();
    if (results.length) log(`Checked ${results.length} media file(s)`);
  });
  render();
}
