// Entry point: navigation and page wiring.
import { $, iconRefresh } from './ui.js';
import { initRecordPages } from './pages/records-pages.js';
import { initWorkspace } from './pages/workspace.js';
import { initMedia } from './pages/media.js';
import { initRadioClips } from './pages/radioclips.js';
import { initBackup } from './pages/backup.js';
import { initLogs } from './pages/logs.js';
import { initFirmware } from './pages/firmware.js';
import { initHome } from './pages/home.js';
import { initApps } from './pages/apps.js';
import { initFiles, showFilesTab } from './pages/files.js';
import { initDeviceBackup } from './pages/backup-device.js';
import { initDiagnostics } from './pages/diagnostics.js';
import { initCompanionSync } from './pages/companion-sync.js';
import { initPersonalise } from './pages/personalise.js';
import { initPipSettings } from './pages/pipsettings.js';
import { initDeviceState, onDeviceChange, device, connect } from './device/state.js';
import { initJobs } from './device/jobs.js';
import { initClockSync } from './device/clocksync.js';
import { initTheme } from './theme.js';

const LABELS = {
  dashboard: 'Home',
  apps: 'Apps',
  files: 'Files',
  personalise: 'ID, lists & notes',
  pipsettings: 'Pip-Boy settings',
  backup: 'Backup & restore',
  radio: 'Radio presets',
  settings: 'App settings profile',
  workspace: 'Workspace',
  media: 'Media check',
  logs: 'Activity',
  diagnostics: 'Diagnostics',
  flash: 'Firmware',
};
// Old addresses keep working.
const ALIASES = { full: 'files', home: 'dashboard' };

function navigate(page, { push = true } = {}) {
  page = ALIASES[page] ?? page;
  if (!LABELS[page]) page = 'dashboard';
  document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.id === page));
  document.querySelectorAll('.nav-btn').forEach((el) => {
    const active = el.dataset.page === page;
    el.classList.toggle('active', active);
    if (active) el.setAttribute('aria-current', 'page');
    else el.removeAttribute('aria-current');
  });
  $('breadcrumb').textContent = LABELS[page].toUpperCase();
  document.title = page === 'dashboard' ? 'Pip-Boy Companion' : `${LABELS[page]} · Pip-Boy Companion`;
  if (push && location.hash !== `#${page}`) history.pushState(null, '', `#${page}`);
  window.scrollTo({ top: 0 });
  document.dispatchEvent(new CustomEvent('pagechange', { detail: page }));
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('[data-page],[data-goto]');
  if (nav) {
    const page = nav.dataset.page || nav.dataset.goto;
    if (page === 'files' && nav.dataset.tab) showFilesTab(nav.dataset.tab);
    navigate(page);
    if (nav.dataset.open) $(nav.dataset.open).open = true;
    return;
  }
  if (e.target.closest('[data-connect]')) connect();
});
window.addEventListener('popstate', () => navigate(location.hash.slice(1), { push: false }));

// Buttons that talk to the Pip-Boy wait while it's busy. (When it's not connected they
// stay enabled: pressing one connects first.)
onDeviceChange(() => {
  const wait = device.busy || device.phase === 'restarting' || device.phase === 'connecting';
  for (const b of document.querySelectorAll('[data-device]')) b.disabled = wait;
});

// The page's Content Security Policy blocks inline style attributes, so markup asks for sizes
// and colours with data-width / data-colour and they're applied here (through the CSSOM).
function applyDataStyles(root) {
  for (const el of root.querySelectorAll?.('[data-width]') ?? []) el.style.width = el.dataset.width;
  for (const el of root.querySelectorAll?.('[data-colour]') ?? []) el.style.background = el.dataset.colour;
}
new MutationObserver((changes) => {
  for (const c of changes) for (const n of c.addedNodes) if (n.nodeType === 1) applyDataStyles(n.parentNode ?? n);
}).observe(document.body, { childList: true, subtree: true });

initTheme();
initDeviceState();
initJobs();
initClockSync();
initMedia();
initRadioClips();
initBackup();
initFirmware();
initHome();
initApps();
initFiles();
initDiagnostics();
initCompanionSync();
initPersonalise();
initPipSettings();
await Promise.all([initRecordPages(), initWorkspace(), initLogs()]);
initDeviceBackup();
navigate(location.hash.slice(1) || 'dashboard', { push: false });
document.body.dataset.ready = 'true';

// Icons (lucide): the local copy that `npm run vendor` saves, else the pinned CDN build. The
// local copy keeps third-party code off a page that can reach the Pip-Boy over USB.
const LUCIDE = ['/vendor/lucide.min.js', 'https://cdn.jsdelivr.net/npm/lucide@0.577.0/dist/umd/lucide.min.js'];
(function loadIcons(i = 0) {
  const s = document.createElement('script');
  s.src = LUCIDE[i];
  const next = () => {
    s.remove();
    if (i + 1 < LUCIDE.length) loadIcons(i + 1);
  };
  s.onload = () => (globalThis.lucide ? iconRefresh() : next()); // the server sends an empty script when there's no local copy
  s.onerror = next;
  document.head.append(s);
})();
