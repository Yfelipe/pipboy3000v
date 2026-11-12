# Dashboard themes: how to add one

The dashboard and the emulator page share one set of colour themes. People choose one in the
theme dialog (the palette button in the top bar). A theme is **11 base colours**. Every other
shade (buttons, hovers, fields, warning and error backgrounds) is mixed from those colours in
`public/css/app.css`, so a theme never needs more than this.

`npm test` checks every rule marked **(tested)** below, in `test/themes.test.js`.

## The files

| File | What goes there |
| --- | --- |
| `public/css/themes.css` | the theme's colours: one `[data-theme="<id>"]{…}` rule |
| `public/js/theme.js` | the theme's entry in `THEMES`: name, blurb, preview colours |
| `public/css/app.css` | the default theme (`:root`, id `pipboy`) and the mixed shades. Don't change it to add a theme |
| `public/js/theme-boot.js` | applies the saved theme before the page draws, and builds "your colour" themes. No change needed |

Both pages already load `themes.css` and `theme-boot.js`, so a new theme appears on the
dashboard and on the emulator page with no other wiring.

## 1. Pick an id

- Use lowercase letters, digits and dashes: 2–24 characters, starting with a letter. Examples: `fo76`, `enclave`, `mr-handy`. **(tested)**
- It must be unique. `custom` is taken by the picker's own-colour option. **(tested)**
- The id is saved in each browser (`localStorage` key `pipboy-dashboard-theme`). Don't rename a
  theme that has been released: anyone using it falls back to the default.

## 2. Add the colours to `themes.css`

Put the rule on one line, in the same style as the others:

```css
[data-theme="enclave"]{--bg:#060a0c;--side:#0a1014;--panel:#0d1519;--panel2:#111b20;--line:#2b4a52;--green:#9be3ff;--bright:#e2f7ff;--dim:#5fa8c2;--muted:#8fb0bd;--amber:#ffc857;--red:#ff6b6b}
```

Set **all 11** of these, each as `#rrggbb` (lowercase is fine), and nothing else. **(tested)**

| Token | Used for |
| --- | --- |
| `--bg` | page background. Must be dark |
| `--side` | sidebar background, between `--bg` and `--panel` |
| `--panel` | cards and panels: the surface most text sits on |
| `--panel2` | a slightly lighter panel: headers, raised strips |
| `--line` | borders and dividers |
| `--green` | **the main text and accent colour.** It's called green because the default theme is, but it can be any hue |
| `--bright` | headings, selected items, focus outlines, and text on buttons |
| `--dim` | secondary labels and less important text |
| `--muted` | hints, captions, placeholders (mixed), switched-off controls (mixed) |
| `--amber` | warnings |
| `--red` | errors and destructive buttons |

One optional token:

| Token | Used for |
| --- | --- |
| `--tint` | the colour mixed into buttons, hovers and fields. It defaults to `--green`. Set it when the accent should differ from the text, as in Vault-Tec (gold text, blue buttons), Institute and Brotherhood |

Ordering by lightness usually works: `--bg` < `--side` < `--panel` < `--panel2`, all dark, with
`--line` a clear step above `--panel2`.

## 3. Readability rules (tested)

All contrasts are WCAG ratios against `--panel`, unless a row says otherwise.

| Rule | Minimum |
| --- | --- |
| `--bg` relative luminance | ≤ 0.02 (dark: the scanline and glow effects assume it) |
| `--panel` | no darker than `--bg` |
| `--green`, `--bright`, `--muted`, `--amber`, `--red` | 4.5 : 1 (WCAG AA for text) |
| `--bright` on a selected button (33% of `--tint` mixed into `--bg`) | 4.5 : 1 |
| `--dim` | 3 : 1 |
| `--line` | 1.5 : 1 (borders must be visible) |
| `--red` against `--green` | hue at least 30° apart, so errors don't read as normal text |
| `--amber` against `--green` | hue 30° apart, or lightness 1.4 : 1, or saturation 0.35 apart |

If the main colour is itself red or amber (as in Nuka-Cola and New Vegas), move the warning and
error colours away from it. For example, Nuka-Cola's errors are pink, and New Vegas's warnings are
a pale yellow.

The test's failure message names the theme, the rule and the measured value.

## 4. Add the entry to `THEMES` in `theme.js`

```js
export const THEMES = [
  // ...the themes already there, then yours:
  { id: 'enclave', name: 'Enclave', blurb: 'Remnant blue. America\'s rightful government.', preview: ['#060a0c', '#0d1519', '#24505e', '#9be3ff', '#e2f7ff'] },
];
```

- **name**: up to 40 characters. It's shown on the card and as the current theme. **(tested)**
- **blurb**: up to 80 characters, one line, in the Fallout tone of the others. **(tested)**
- **preview**: five colours for the card's swatch strip: `[--bg, --panel, highlight, --green, --bright]`.
  The 1st, 2nd, 4th and 5th must equal the theme's CSS values. **(tested)** The highlight is
  roughly what a selected button looks like: `--tint` (or `--green`) mixed about 33–45% into `--bg`.
- Add new themes at the end. `pipboy` stays first: it's the default. **(tested)**
- Each `THEMES` entry needs a CSS rule, and each CSS rule needs a `THEMES` entry. **(tested)**

## 5. Check it

```bash
node --test test/themes.test.js   # the rules above
npm test                          # everything
npm run test:e2e                  # optional: the theme picker in a real browser (needs Playwright)
```

Then look at it. Run `npm start`, open the theme dialog and choose the theme. Check these:

- **Home, Apps and Files:** buttons, the selected nav item, a text field with a placeholder.
- **Warnings and errors:** the amber DISCONNECTED tag on Home, and red Delete/Clear buttons
  (Notes, Logs). The Clear dialog on Logs shows a solid red button, and cancelling it changes nothing.
- **The emulator page** (`/emulator/`).
- **Scanlines on and off:** the switch is in the theme dialog.

## Don'ts

- Don't add colour variables in a theme beyond the 11 + `--tint`. If a new kind of shade is
  needed, add it once in `app.css`, mixed from the base colours with `color-mix`, so every
  theme gets it.
- Don't use `!important`, gradients or images in a theme. Its colours are applied as custom
  properties on `<html>`.
- Don't put theme CSS inline in HTML or set it from scripts. The CSP blocks inline styles in
  `<style>`. Theme-specific behaviour also doesn't belong in JS: `theme-boot.js` only sets
  `data-theme`, apart from "your colour" themes.
- Don't put images in a theme, official or otherwise (official artwork is allowed elsewhere in
  the project: see `AGENTS.md`). A theme is colours, a name and a short blurb.
