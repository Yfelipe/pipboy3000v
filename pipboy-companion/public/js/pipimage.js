// Pip-OS 1.33 image files: raw 2 bit greyscale, rows packed most significant bit first
// (four pixels per byte, 0 = black ... 3 = brightest), the same layout as the firmware's
// Graphics buffers. DATA/*.img and USER/USERIMG.img are 400x248 (FEEDS), USER/IDCARD.img is
// 400x300 (INV > ID). The firmware copies rows straight from the file with Pip.blitFile.
// No DOM here, so it runs in tests too.

export const FEED = Object.freeze({ width: 400, height: 248, path: 'USER/USERIMG.img' });
export const IDCARD = Object.freeze({ width: 400, height: 300, path: 'USER/IDCARD.img', json: 'USER/IDCARD.json' });

/** Pack 0..3 levels (one per pixel, row by row) into the file format. */
export function pack2bpp(levels, width, height) {
  if (width % 4) throw new Error('Width must be a multiple of 4');
  const out = new Uint8Array((width * height) / 4);
  for (let i = 0; i < width * height; i++) out[i >> 2] |= (levels[i] & 3) << (6 - 2 * (i & 3));
  return out;
}

/** The reverse of pack2bpp. */
export function unpack2bpp(bytes, width, height) {
  const out = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) out[i] = (bytes[i >> 2] >> (6 - 2 * (i & 3))) & 3;
  return out;
}

/** RGBA pixels -> 0..255 luminance. */
export function toGrey(rgba) {
  const out = new Float32Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  return out;
}

/** Nearest of the four levels, no dithering (for text and line art). */
export function quantize(grey) {
  const out = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i++) out[i] = Math.max(0, Math.min(3, Math.round(grey[i] / 85)));
  return out;
}

/**
 * Floyd-Steinberg dither to four levels, for photos. `contrast` (1 = none) and `brightness`
 * (-1..1) are applied first; the Pip-Boy's green screen has little range, so a little extra
 * contrast usually looks better.
 */
export function dither(grey, width, height, { contrast = 1.15, brightness = 0 } = {}) {
  const g = Float32Array.from(grey, (v) => (v - 128) * contrast + 128 + brightness * 128);
  const out = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const old = Math.max(0, Math.min(255, g[i]));
      const level = Math.max(0, Math.min(3, Math.round(old / 85)));
      out[i] = level;
      const err = old - level * 85;
      if (x + 1 < width) g[i + 1] += (err * 7) / 16;
      if (y + 1 < height) {
        if (x > 0) g[i + width - 1] += (err * 3) / 16;
        g[i + width] += (err * 5) / 16;
        if (x + 1 < width) g[i + width + 1] += err / 16;
      }
    }
  }
  return out;
}

/** Levels -> RGBA in the Pip-Boy's green, for previews. */
export function previewRgba(levels, rgb = [0.2, 1, 0.3]) {
  const out = new Uint8ClampedArray(levels.length * 4);
  const ramp = [0.04, 0.33, 0.66, 1];
  for (let i = 0; i < levels.length; i++) {
    const k = ramp[levels[i]] * 255;
    out[i * 4] = rgb[0] * k;
    out[i * 4 + 1] = rgb[1] * k;
    out[i * 4 + 2] = rgb[2] * k;
    out[i * 4 + 3] = 255;
  }
  return out;
}

// --------------------------------------------------------------- LISTS
// DATA > LISTS reads USER/customLists.json:
//   { categories: [{ id, name, items: [{ id, text, done, updated }] }] }
// The Pip-Boy writes `done` and `updated` (ms) back when an item is ticked off.
export const LISTS_PATH = 'USER/customLists.json';

const newId = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0');

/** Validate and normalise a lists file (anything unusable is dropped, ids are filled in). */
export function normaliseLists(data) {
  const cats = Array.isArray(data?.categories) ? data.categories : [];
  return {
    categories: cats
      .filter((c) => c && typeof c === 'object')
      .map((c) => ({
        id: typeof c.id === 'string' && c.id ? c.id : newId(),
        name: String(c.name ?? 'Untitled').slice(0, 40),
        items: (Array.isArray(c.items) ? c.items : [])
          .filter((it) => it && typeof it === 'object')
          .map((it) => ({
            id: typeof it.id === 'string' && it.id ? it.id : newId(),
            text: String(it.text ?? '').slice(0, 60),
            done: !!it.done,
            updated: Number.isFinite(it.updated) ? it.updated : Date.now(),
          })),
      })),
  };
}

export { newId as listId };

// ------------------------------------------------------------ DISPLAY COLOUR
// Pip-OS's DATA > MAINTENANCE > Display color: settings.color { r, g, b, scanline, overscan }
// (0..255) becomes four 16-entry RGB565 palettes (even lines, odd "scanline" lines, and both
// again brightened for the moving overscan band). The device computes the real ones; this
// copy of the same formula is for previews.
export const DEFAULT_COLOR = Object.freeze({ r: 0, g: 255, b: 0, scanline: 128, overscan: 128 });
export const COLOR_PRESETS = Object.freeze([
  { name: 'Green (default)', color: { r: 0, g: 255, b: 0 } },
  { name: 'Amber', color: { r: 255, g: 112, b: 0 } },
  { name: 'White', color: { r: 255, g: 255, b: 255 } },
  { name: 'Blue', color: { r: 64, g: 160, b: 255 } },
  { name: 'Gold', color: { r: 255, g: 200, b: 40 } },
  { name: 'Red', color: { r: 255, g: 48, b: 32 } },
]);

/** Espruino's Graphics.toColor for a 16 bit screen. */
const toColor = (r, g, b) => {
  const c = (v) => Math.max(0, Math.min(255, Math.trunc(v * 256)));
  return ((c(b) >> 3) | ((c(g) >> 2) << 5) | ((c(r) >> 3) << 11)) >>> 0;
};

export function palettes({ r, g, b, scanline = 128, overscan = 128 }) {
  const f = r / 255, h = g / 255, i = b / 255, d = 1 - scanline / 255, e = overscan / 1275;
  const P = [0, 1, 2, 3].map(() => new Uint16Array(16));
  for (let n = 0; n < 16; n++) {
    const c = Math.max(0, (n - 12) / 30), k = n / 15;
    P[0][n] = toColor(c + f * k, c + h * k, c + i * k);
    P[1][n] = toColor(c + d * f * k, c + d * h * k, c + d * i * k);
    P[2][n] = toColor(c + (e + f) * k, c + (e + h) * k, c + (e + i) * k);
    P[3][n] = toColor(c + (e + d * f) * k, c + (e + d * h) * k, c + (e + d * i) * k);
  }
  return P;
}

/** 2 bit levels drawn as the Pip-Boy does: level L -> palette[y & 1][L * 5]. */
export function paletteRgba(levels, width, P) {
  const out = new Uint8ClampedArray(levels.length * 4);
  for (let i = 0; i < levels.length; i++) {
    const c = P[Math.floor(i / width) & 1][levels[i] * 5];
    out[i * 4] = ((c >> 11) * 527 + 23) >> 6;
    out[i * 4 + 1] = (((c >> 5) & 63) * 259 + 33) >> 6;
    out[i * 4 + 2] = ((c & 31) * 527 + 23) >> 6;
    out[i * 4 + 3] = 255;
  }
  return out;
}
