// The screens Pip-OS 1.33 added, for our own interfaces: DATA > FEEDS, INV > ID and
// DATA > LISTS. They use the same SD card files as the stock firmware (made with the
// companion dashboard or The Wand Company's Pip-Boy Tools), so everything stays in sync:
//
//   DATA/*.img, DATA/*.avi   feeds (X_LOOP.avi plays on after X.avi), USER/USERIMG.img
//   USER/IDCARD.img          the ID card, 400x300
//   USER/customLists.json    { categories: [{ name, items: [{ text, done, updated }] }] }
//
// Images are raw 2 bit greyscale, rows packed msb first: the layout of a 400 px wide
// Graphics buffer, so they're copied into one strip at a time and blitted. Pip.blitFile does
// that natively on 1.33; older firmware gets the same result with File.read.

const fs = require("fs");

export const ID_CARD = "USER/IDCARD.img";
export const LISTS_FILE = "USER/customLists.json";
const FEED_ORDER = ["HOUSE_HELLO.avi", "HOUSE_ENCLAVE.avi", "HANK.img"]; // as the firmware

const exists = (p) => { try { return !!fs.statSync(p); } catch (e) { return false; } };

/** Feeds in the firmware's order: [{ path, video, loop }] (empty if none). */
export function feeds() {
  let names = [];
  try { names = fs.readdirSync("DATA").filter((n) => n[0] != "." && /\.(img|avi)$/i.test(n)).sort(); } catch (e) {}
  const main = names.filter((n) => !/_LOOP\.AVI$/i.test(n));
  const ordered = FEED_ORDER.filter((n) => main.includes(n)).concat(main.filter((n) => !FEED_ORDER.includes(n)));
  const out = ordered.map((n) => {
    const video = /\.avi$/i.test(n), loop = video && n.slice(0, -4) + "_LOOP.avi";
    return { path: "DATA/" + n, video, loop: loop && names.includes(loop) ? "DATA/" + loop : null };
  });
  if (exists("USER/USERIMG.img")) out.push({ path: "USER/USERIMG.img", video: false });
  return out;
}

export const hasIdCard = () => exists(ID_CARD);

/**
 * Draw a raw image file (`w` px wide, `h` rows) at x,y on the screen, `strip` rows at a time
 * through the 2 bit Graphics `b` (which must be `w` px wide).
 */
export function blitRaw(b, path, w, h, x, y) {
  const strip = b.getHeight(), rowBytes = w / 4;
  const f = E.openFile(path, "r");
  try {
    for (let row = 0; row < h; row += strip) {
      const n = Math.min(strip, h - row);
      if (Pip.blitFile) Pip.blitFile(b, f, { y: row, height: n, srcWidth: w, srcHeight: h });
      else {
        // 20 rows per read keeps the strings small
        const buf = new Uint8Array(b.buffer);
        for (let r = 0; r < n; r += 20) {
          const s = f.read(Math.min(20, n - r) * rowBytes);
          if (s) buf.set(E.toUint8Array(s), r * rowBytes);
        }
      }
      Pip.blitImage(b, x, y + row, { height: n });
    }
  } finally { f.close(); }
}

/** The lists, normalised; null if there's no file. */
export function readLists() {
  let d;
  try { d = JSON.parse(fs.readFile(LISTS_FILE)); } catch (e) { return null; }
  if (!d || !Array.isArray(d.categories)) return null;
  d.categories = d.categories.filter((c) => c instanceof Object);
  d.categories.forEach((c) => { c.items = Array.isArray(c.items) ? c.items.filter((i) => i instanceof Object) : []; });
  return d;
}

/** Tick an item on or off and save, as the stock DATA > LISTS does. */
export function setDone(lists, item, done) {
  item.done = done;
  item.updated = Math.round(Date.now());
  try { fs.writeFile(LISTS_FILE, JSON.stringify(lists)); } catch (e) {}
}

/**
 * The mode dial position (0..4 = STAT..RADIO) for a reading, or -1 when it reads between
 * positions (above 0.9). Pip-OS 1.32 stopped treating that as RADIO; settings.fallbackMode
 * (1..5, 0 = stay put) says where to go instead.
 */
export function modeFor(v, fallback) {
  if (v > 0.9) return fallback ? fallback - 1 : -1;
  return v > 0.7 ? 4 : v > 0.5 ? 3 : v > 0.3 ? 2 : v > 0.1 ? 1 : 0;
}

/** settings.fallbackMode from the SD card's settings.json (0 if unset). */
export function fallbackMode() {
  try { return JSON.parse(fs.readFile("settings.json")).fallbackMode | 0; } catch (e) { return 0; }
}

/**
 * The stock interface's display colour (DATA > MAINTENANCE > Display color, or the companion's
 * Pip-Boy settings page): the four palettes Pip-OS keeps in settings.json, ready for
 * Pip.setPalette. Undefined when none was ever set (the stock green).
 */
export function stockPalette() {
  try {
    const p = JSON.parse(fs.readFile("settings.json")).palette;
    if (p) return p.split(",").map((a) => new Uint16Array(E.toArrayBuffer(atob(a))));
  } catch (e) {}
}

/**
 * The companion's character sheet (USER/CHAR.json, from the dashboard's ID, lists & notes page):
 * { level, special: [S, P, E, C, I, A, L] }, or null when the card has none.
 */
export function charSheet() {
  try {
    const d = JSON.parse(fs.readFile("USER/CHAR.json"));
    if (d && Array.isArray(d.special) && d.special.length == 7) return d;
  } catch (e) {}
  return null;
}
