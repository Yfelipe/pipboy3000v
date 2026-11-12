// The dashboard themes follow docs/THEMES.md: every theme in the picker has its CSS, defines every
// base colour, and stays readable. A new theme that breaks a rule fails here with the reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { THEMES } from '../public/js/theme.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REQUIRED = ['--bg', '--side', '--panel', '--panel2', '--line', '--green', '--bright', '--dim', '--muted', '--amber', '--red'];
const OPTIONAL = ['--tint'];
const HEX = /^#[0-9a-f]{6}$/;

/** id -> { '--bg': '#...', ... } from themes.css, plus 'pipboy' from app.css's :root */
async function cssThemes() {
  const parse = (body) => Object.fromEntries(body.split(';').filter((d) => d.includes(':')).map((d) => {
    const i = d.indexOf(':');
    return [d.slice(0, i).trim(), d.slice(i + 1).trim()];
  }));
  const themes = {};
  const css = await readFile(path.join(ROOT, 'public/css/themes.css'), 'utf8');
  for (const m of css.matchAll(/\[data-theme="([^"]+)"]\s*\{([^}]*)}/g)) {
    assert.ok(!themes[m[1]], `themes.css defines "${m[1]}" twice`);
    themes[m[1]] = parse(m[2]);
  }
  const app = await readFile(path.join(ROOT, 'public/css/app.css'), 'utf8');
  const root = parse(/^:root\{([^}]*)}/m.exec(app)[1]);
  themes.pipboy = Object.fromEntries(Object.entries(root).filter(([k]) => REQUIRED.includes(k)));
  return themes;
}

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const luminance = (c) => {
  const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const mix = (a, b, p) => a.map((v, i) => Math.round(v * p + b[i] * (1 - p))); // color-mix(in srgb, a p, b)
const hue = ([r, g, b]) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (!d) return null; // grey: no hue
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return h * 60;
};
const saturation = (c) => {
  const [r, g, b] = c.map((v) => v / 255), max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  return max === min ? 0 : (max - min) / (l > 0.5 ? 2 - max - min : max + min);
};
const hueGap = (a, b) => { const x = hue(a), y = hue(b); return x == null || y == null ? 180 : Math.abs(((x - y + 540) % 360) - 180); };

test('every theme in the picker has its CSS, and every CSS theme is in the picker', async () => {
  const css = await cssThemes();
  const ids = THEMES.map((t) => t.id);
  assert.equal(ids[0], 'pipboy', 'the default (pipboy) comes first');
  assert.equal(new Set(ids).size, ids.length, 'theme ids are unique');
  for (const t of THEMES) {
    assert.match(t.id, /^[a-z][a-z0-9-]{1,23}$/, `"${t.id}": ids are lowercase letters, digits and dashes`);
    assert.notEqual(t.id, 'custom', '"custom" is the picker\'s own-colour option');
    assert.ok(css[t.id], `"${t.id}" has no [data-theme="${t.id}"] block in public/css/themes.css`);
    assert.ok(t.name?.trim() && t.name.length <= 40, `"${t.id}": a name of up to 40 characters`);
    assert.ok(t.blurb?.trim() && t.blurb.length <= 80, `"${t.id}": a blurb of up to 80 characters`);
  }
  for (const id of Object.keys(css)) assert.ok(ids.includes(id), `themes.css has "${id}", which isn't in THEMES (public/js/theme.js)`);
});

test('every theme defines all the base colours, as #rrggbb, and nothing else', async () => {
  for (const [id, vars] of Object.entries(await cssThemes())) {
    for (const k of REQUIRED) assert.match(vars[k] ?? '(missing)', HEX, `"${id}" ${k}`);
    for (const [k, v] of Object.entries(vars)) {
      assert.ok(REQUIRED.includes(k) || OPTIONAL.includes(k), `"${id}" sets ${k}: themes set only the base colours (docs/THEMES.md)`);
      if (OPTIONAL.includes(k)) assert.match(v, HEX, `"${id}" ${k}`);
    }
  }
});

test('previews match the theme: background, panel, highlight, text, bright text', async () => {
  const css = await cssThemes();
  for (const t of THEMES) {
    const v = css[t.id];
    assert.equal(t.preview.length, 5, `"${t.id}" preview has 5 colours`);
    for (const c of t.preview) assert.match(c, HEX, `"${t.id}" preview colour`);
    assert.deepEqual([t.preview[0], t.preview[1], t.preview[3], t.preview[4]], [v['--bg'], v['--panel'], v['--green'], v['--bright']], `"${t.id}" preview = [--bg, --panel, highlight, --green, --bright]`);
  }
});

test('every theme is dark and readable (WCAG AA for text)', async () => {
  for (const [id, v] of Object.entries(await cssThemes())) {
    if (!REQUIRED.every((k) => HEX.test(v[k] ?? ''))) continue; // reported by the test above
    const c = (k) => rgb(v[k]);
    const bg = c('--bg'), panel = c('--panel');
    const btn = mix(rgb(v['--tint'] ?? v['--green']), bg, 0.33); // --btn in app.css: a selected button
    const need = (what, ratio, min) => assert.ok(ratio >= min, `"${id}": ${what} contrast ${ratio.toFixed(2)}, needs ${min}`);
    assert.ok(luminance(bg) <= 0.02, `"${id}": --bg must be dark (the dashboard is a CRT: scanlines and glow assume it)`);
    assert.ok(luminance(bg) <= luminance(panel), `"${id}": --panel is at least as light as --bg`);
    for (const k of ['--green', '--bright', '--muted', '--amber', '--red']) need(`${k} on --panel`, contrast(c(k), panel), 4.5);
    need('--bright on a selected button', contrast(c('--bright'), btn), 4.5);
    need('--dim on --panel', contrast(c('--dim'), panel), 3);
    need('--line against --panel', contrast(c('--line'), panel), 1.5);
    // errors must not look like ordinary text, and warnings must stand apart from it
    assert.ok(hueGap(c('--red'), c('--green')) >= 30, `"${id}": --red needs a hue at least 30° from --green`);
    const amber = c('--amber'), text = c('--green');
    assert.ok(hueGap(amber, text) >= 30 || contrast(amber, text) >= 1.4 || Math.abs(saturation(amber) - saturation(text)) >= 0.35,
      `"${id}": --amber needs a hue 30° from --green, a clearly different lightness (1.4:1) or saturation (0.35)`);
  }
});
