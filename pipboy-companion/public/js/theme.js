// The dashboard's colour themes: a picker in a dialog (the palette button in the top bar).
// Themes are CSS ([data-theme] in css/app.css); js/theme-boot.js applies the saved one before
// the page draws. The choice is kept in this browser only.
import { $, escapeHtml, iconRefresh } from './ui.js';

// preview: [background, panel, highlight, text, bright text] (the same colours as app.css)
export const THEMES = [
  { id: 'pipboy', name: 'Pip-Boy 3000 Mk V', blurb: 'The default: the Mark V’s green phosphor.', preview: ['#0a100e', '#14221a', '#386339', '#a7f279', '#caff9e'] },
  { id: 'fo4', name: 'Fallout 4', blurb: 'The Commonwealth’s bright Pip-Boy green.', preview: ['#040c07', '#0a1b10', '#1a6b36', '#3dff7a', '#b9ffd0'] },
  { id: 'nv', name: 'Fallout: New Vegas', blurb: 'Mojave amber, as the Courier saw it.', preview: ['#0f0b05', '#1c150c', '#6b4c1c', '#ffb642', '#ffe2a8'] },
  { id: 'glow', name: 'The Glow', blurb: 'Radioactive yellow-green. Don’t lick the screen.', preview: ['#0b0d03', '#161a07', '#566a16', '#d7ff3a', '#f3ffb5'] },
  { id: 'vaulttec', name: 'Vault-Tec', blurb: 'Vault-suit blue and gold. Prepare for the future!', preview: ['#07132b', '#0f2147', '#2a4f99', '#ffd23f', '#fff1b8'] },
  { id: 'nuka', name: 'Nuka-Cola', blurb: 'Zap That Thirst red.', preview: ['#120506', '#220b0d', '#5e1c1a', '#ff5a4d', '#ffd3cc'] },
  { id: 'quantum', name: 'Nuka-Cola Quantum', blurb: 'Twice the calories, twice the glow.', preview: ['#04081a', '#0a1230', '#1f4f78', '#5ad1ff', '#cdf3ff'] },
  { id: 'institute', name: 'Institute', blurb: 'Clean-room white and teal, far below the Commonwealth.', preview: ['#0d1114', '#182025', '#2a5258', '#d8f3f5', '#ffffff'] },
  { id: 'brotherhood', name: 'Brotherhood of Steel', blurb: 'Power-armour steel with a crimson trim. Ad Victoriam.', preview: ['#0e0e10', '#1a1a1d', '#4a1a17', '#d9d1bf', '#f5f0e4'] },
  { id: 'enclave', name: 'Enclave', blurb: 'Raven Rock blue. America’s rightful government is watching.', preview: ['#05090d', '#0c141b', '#415d6e', '#9bdcff', '#e4f6ff'] },
  { id: 'legion', name: 'Caesar’s Legion', blurb: 'Crimson and gold on black. Ave, true to Caesar.', preview: ['#0c0404', '#190909', '#584312', '#ff6a5e', '#ffdcd6'] },
  { id: 'ncr', name: 'New California Republic', blurb: 'Desert sand and trooper olive. A safe people is a strong people.', preview: ['#0e0b07', '#1a150d', '#3a3e1d', '#e0cfa0', '#fbf2d8'] },
  { id: 'lucky38', name: 'Lucky 38', blurb: 'Mr. House’s monitor teal. The house always wins.', preview: ['#030b0a', '#081918', '#286156', '#5fe3c8', '#cffff4'] },
  { id: 'classic', name: 'Classic (Fallout 1 & 2)', blurb: 'Pip-Boy 2000: brass, brown steel and a green CRT.', preview: ['#0c0a06', '#19150c', '#4e3e1c', '#7fe35a', '#d6ffc2'] },
  { id: 'appalachia', name: 'Appalachia (Fallout 76)', blurb: 'Reclamation Day yellow with autumn leaves. Country roads.', preview: ['#0a0d10', '#131a1f', '#56301a', '#dfe38a', '#fbfdd4'] },
  { id: 'robco', name: 'RobCo terminal', blurb: 'Black glass and terminal green. Password required.', preview: ['#000000', '#0b0b0b', '#1f662a', '#4dff6a', '#c8ffd2'] },
  { id: 'sierra-madre', name: 'Sierra Madre', blurb: 'Casino gold under the red Cloud. Begin again.', preview: ['#110706', '#1f0e0b', '#531e16', '#e8c063', '#fff0c9'] },
];

const T = () => window.dashboardTheme; // from theme-boot.js
const PIPBOY_COLOUR_KEY = 'pipboy-display-colour';
let state = { id: 'pipboy', color: '#a7f279', scanlines: true };

const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');

function pipboyColour() {
  try { return localStorage.getItem(PIPBOY_COLOUR_KEY); } catch { return null; }
}

function set(next) {
  state = { ...state, ...next };
  T()?.apply(state);
  T()?.save(state);
  render();
}

function card(t) {
  const on = state.id === t.id;
  return (
    `<button type="button" class="theme-card" data-theme-id="${escapeHtml(t.id)}" aria-pressed="${on}">` +
    `<span class="theme-preview" aria-hidden="true">${t.preview.map((c) => `<i data-colour="${escapeHtml(c)}"></i>`).join('')}</span>` +
    `<strong>${escapeHtml(t.name)}</strong><small>${escapeHtml(t.blurb)}</small></button>`
  );
}

function render() {
  if (!$('theme-grid')) return;
  $('theme-grid').innerHTML = THEMES.map(card).join('');
  $('theme-color').value = state.color;
  $('theme-custom-use').setAttribute('aria-pressed', String(state.id === 'custom'));
  $('theme-scanlines').checked = state.scanlines !== false;
  const pip = pipboyColour();
  $('theme-match').hidden = !pip;
  if (pip) $('theme-match-swatch').style.background = pip;
  $('theme-current').textContent = state.id === 'custom' ? `Your colour (${state.color})` : THEMES.find((t) => t.id === state.id)?.name ?? THEMES[0].name;
}

export function initTheme() {
  const saved = T()?.load() ?? {};
  state = { ...state, ...saved };
  if (state.id !== 'custom' && !THEMES.some((t) => t.id === state.id)) state.id = 'pipboy';
  $('theme-open').addEventListener('click', () => {
    render();
    iconRefresh();
    $('theme-dialog').showModal();
  });
  $('theme-close').addEventListener('click', () => $('theme-dialog').close());
  $('theme-dialog').addEventListener('click', (e) => { if (e.target.closest('[data-goto]')) $('theme-dialog').close(); });
  $('theme-grid').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-id]');
    if (b) set({ id: b.dataset.themeId });
  });
  $('theme-color').addEventListener('input', (e) => set({ id: 'custom', color: e.target.value }));
  $('theme-custom-use').addEventListener('click', () => set({ id: 'custom', color: $('theme-color').value }));
  $('theme-match').addEventListener('click', () => {
    const c = pipboyColour();
    if (c) set({ id: 'custom', color: c });
  });
  $('theme-scanlines').addEventListener('change', (e) => set({ scanlines: e.target.checked }));
  // The Pip-Boy settings page reports the device's display colour when it reads it
  document.addEventListener('pipboy-colour', (e) => {
    try { localStorage.setItem(PIPBOY_COLOUR_KEY, hex(e.detail)); } catch {}
    render();
  });
  render();
}
