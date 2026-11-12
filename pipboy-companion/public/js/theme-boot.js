// Applies the saved dashboard theme before the page is drawn, so it doesn't flash green first.
// A classic script in <head> (the page's CSP allows same-origin scripts, not inline ones);
// js/theme.js uses window.dashboardTheme for the theme picker.
(function () {
  var KEY = 'pipboy-dashboard-theme';

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0;
    if (max !== min) {
      var d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  var hsl = function (h, s, l) { return 'hsl(' + h.toFixed(0) + ' ' + (s * 100).toFixed(0) + '% ' + (l * 100).toFixed(1) + '%)'; };

  /** Every base colour for a custom theme, from the one colour picked. */
  function customVars(hex) {
    var rgb = hexToRgb(hex);
    if (!rgb) return null;
    var c = rgbToHsl(rgb[0], rgb[1], rgb[2]), h = c[0], s = Math.max(c[1], 0.35), bgS = Math.min(s * 0.5, 0.45);
    var near = function (a) { var d = Math.abs(((h - a + 540) % 360) - 180); return d < 32; };
    return {
      '--bg': hsl(h, bgS, 0.04), '--side': hsl(h, bgS, 0.065), '--panel': hsl(h, bgS, 0.085), '--panel2': hsl(h, bgS, 0.11),
      '--line': hsl(h, s * 0.45, 0.26),
      '--green': hex, '--bright': hsl(h, Math.min(1, s), 0.86), '--dim': hsl(h, s * 0.6, 0.48), '--muted': hsl(h, s * 0.3, 0.6),
      // warnings and errors keep their colours unless the theme colour is close to them
      '--amber': near(45) ? '#9fd8ff' : '#f4ca6c', '--red': near(5) || near(345) ? '#ffb0e0' : '#ff8e78',
    };
  }

  var CUSTOM_KEYS = ['--bg', '--side', '--panel', '--panel2', '--line', '--green', '--bright', '--dim', '--muted', '--amber', '--red'];

  /** state: { id: 'pipboy' | <theme id> | 'custom', color: '#rrggbb', scanlines: bool } */
  function apply(state) {
    var root = document.documentElement;
    state = state || {};
    CUSTOM_KEYS.forEach(function (k) { root.style.removeProperty(k); });
    var vars = state.id === 'custom' && customVars(state.color);
    if (vars) {
      root.dataset.theme = 'custom';
      Object.keys(vars).forEach(function (k) { root.style.setProperty(k, vars[k]); });
    } else if (state.id && state.id !== 'pipboy' && state.id !== 'custom') root.dataset.theme = state.id;
    else delete root.dataset.theme;
    root.style.setProperty('--scan', state.scanlines === false ? '0' : '.65');
  }

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  function save(state) {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  }

  window.dashboardTheme = { apply: apply, load: load, save: save, customVars: customVars };
  apply(load());
})();
