// PIP-OS X — a concept "next generation" interface for the Pip-Boy 3000 Mk V: holographic
// vector styling (rings, radar sweeps, rotating wireframes, V.A.T.S. targeting) built on the
// game systems the Pip-Boy has always had, and the device's own Vault Boy and map animations,
// played straight from its SD card (STAT/VB*.avi, MAP/*.avi). Everything else is drawn with
// Graphics primitives.
//
// Install: write pipos-x.min.js (./build.sh) to Storage under that name, then
// load("pipos-x.min.js"); sd/USER/PIPOSX.JS adds it to the stock INV > APPS menu.
// Power returns to the stock interface. Needs firmware 2v24 or later; the Pip-OS 1.33
// screens (INV > ID, DATA > FEEDS and LISTS, see ../shared/pipos133.js) work on any of them.
// The companion's extras (extras.js, read from sd/USER/PIPOSX.EXT so they cost no Storage):
// FM radio and presets in RADIO, INV > REMOTE, DATA > NOTES and INBOX. Messages from the
// companion pop up over whatever is showing.
//
// Controls (as on the stock firmware): mode dial = tabs, thumbwheel = sub-pages,
// wheel = scroll, wheel press = select, PLAY = radio on/off, torch = flashlight, power = exit.

import { feeds, hasIdCard, ID_CARD, blitRaw, readLists, setDone, modeFor, fallbackMode, stockPalette, charSheet } from "../shared/pipos133.js";

(function () {
  // ------------------------------------------------------------------ hardware
  const KNOB1_A = BTN8, KNOB1_B = BTN9, KNOB1_BTN = BTN7;
  const KNOB2_A = BTN5, KNOB2_B = BTN6;
  const BTN_POWER = BTN10, BTN_PLAY = BTN1, BTN_TORCH = BTN4;
  const MODE_SELECTOR = A7, VBAT_MEAS = A6, VUSB_PRESENT = A9, LCD_BL = B15, MEAS_ENB = C4;

  // Screen layout (480x320): header 53,7 (372x51) · content 40,65 (400x210) · footer 52,290 (372x25)
  // Buffers live in the STM32's CCM RAM, where the stock firmware keeps its own, so they cost no
  // JS variables. They're drawn with colours 0..3 and shown with Pip.blitImage (scanlines + palette).
  const CCM = 0x10008000;
  const area = (offset, bytes) => E.toArrayBuffer(E.memoryArea(CCM + offset, bytes));
  const gfx = (w, h, offset) => Graphics.createArrayBuffer(w, h, 2, { msb: true, buffer: area(offset, (w * h) / 4) });
  const bC = gfx(400, 210, 0);
  const bH = gfx(372, 51, 21000);
  const bF = gfx(372, 25, 25743);
  // Pages that show a 204x208 Vault Boy animation in the middle use two side panels instead
  // of the full content buffer (they share its memory), so the video isn't drawn over.
  const bL = gfx(96, 210, 0);
  const bR = gfx(96, 210, 5040);
  const VIDEO = { x: 138, y: 66 };

  // Monofonto16 is 8x19 px per character, Monofonto18 9x21, Monofonto23 12x27, Monofonto28 14x33.

  // ------------------------------------------------------------------ settings & theme
  const SETTINGS_FILE = "pipos-x.json";
  const SHEET = charSheet(); // level and S.P.E.C.I.A.L. from the companion, if the SD card has them
  const cfg = Object.assign({ theme: 0, sound: true, bright: 3 }, require("Storage").readJSON(SETTINGS_FILE, true) || {});
  const save = () => require("Storage").writeJSON(SETTINGS_FILE, cfg);

  const THEMES = [
    { name: "HOLO", rgb: [0.35, 1, 0.82] },
    { name: "PHOSPHOR", rgb: [0.2, 1, 0.3] },
    { name: "AMBER", rgb: [1, 0.71, 0.26] },
    { name: "INSTITUTE", rgb: [0.75, 0.9, 1] },
    { name: "PIP-BOY", rgb: [0.2, 1, 0.3], stock: true }, // the stock interface's own colour
    // New themes go at the end: the saved setting is a position in this list
    { name: "LEGION", rgb: [1, 0.27, 0.2] },     // Caesar's crimson
    { name: "NCR", rgb: [0.92, 0.82, 0.55] },    // desert khaki
    { name: "ENCLAVE", rgb: [0.45, 0.8, 1] },    // cold blue
  ];

  function applyTheme() {
    const stock = THEMES[cfg.theme].stock && stockPalette();
    if (stock) { Pip.setPalette(stock); g.setBgColor(0); return; }
    const c = THEMES[cfg.theme].rgb;
    Pip.setPalette([0.86, 0.62, 1, 0.75].map((k) => {
      const row = new Uint16Array(16);
      for (let i = 0; i < 16; i++) {
        const v = (i / 15) * k;
        row[i] = ((c[0] * v * 31) << 11) | ((c[1] * v * 63) << 5) | (c[2] * v * 31);
      }
      return row;
    }));
    g.setBgColor(0);
  }

  const backlight = () => analogWrite(LCD_BL, [0.05, 0.12, 0.3, 0.6, 1][cfg.bright], { freq: 200 });

  function sound(file) {
    if (video && !videoTimer) return; // it would stop the video (see playVideo)
    if (cfg.sound) try { Pip.audioStart("UI/" + file + ".wav"); } catch (e) {}
  }

  /** AVI files in an SD card folder, sorted (empty if there's no card or folder). */
  function videos(dir, prefix) {
    try {
      return require("fs").readdirSync(dir).filter((f) => f[0] != "." && f.toUpperCase().endsWith(".AVI") && f.startsWith(prefix || "")).sort();
    } catch (e) { return []; }
  }

  // ------------------------------------------------------------------ drawing helpers

  /** Corner brackets around a box. */
  function brackets(b, x1, y1, x2, y2, len) {
    b.drawLine(x1, y1, x1 + len, y1).drawLine(x1, y1, x1, y1 + len);
    b.drawLine(x2, y1, x2 - len, y1).drawLine(x2, y1, x2, y1 + len);
    b.drawLine(x1, y2, x1 + len, y2).drawLine(x1, y2, x1, y2 - len);
    b.drawLine(x2, y2, x2 - len, y2).drawLine(x2, y2, x2, y2 - len);
  }

  /** An arc of `steps` short segments from angle a1 to a2 (radians, 0 = right, clockwise). */
  function arc(b, cx, cy, r, a1, a2, thick) {
    const steps = Math.max(4, Math.abs(a2 - a1) * r / 6) | 0;
    let px = cx + Math.cos(a1) * r, py = cy + Math.sin(a1) * r;
    for (let i = 1; i <= steps; i++) {
      const a = a1 + ((a2 - a1) * i) / steps, x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      b.drawLine(px, py, x, y);
      if (thick) b.drawLine(px + 1, py, x + 1, y);
      px = x; py = y;
    }
  }

  /** A ring gauge: dim track, bright value arc, label and value in the middle. */
  function ring(b, cx, cy, r, frac, label, value) {
    b.setColor(1);
    arc(b, cx, cy, r, Math.PI * 0.75, Math.PI * 2.25);
    b.setColor(3);
    arc(b, cx, cy, r - 3, Math.PI * 0.75, Math.PI * (0.75 + 1.5 * E.clip(frac, 0, 1)), true);
    b.setFontMonofonto16().setFontAlign(0, 0).drawString(value, cx, cy - 2);
    b.setColor(2).drawString(label, cx, cy + r - 2);
  }

  /** Segmented horizontal meter. */
  function meter(b, x, y, w, h, frac, segs) {
    const sw = w / segs;
    for (let i = 0; i < segs; i++) b.setColor(i < Math.round(frac * segs) ? 3 : 1).fillRect(x + i * sw, y, x + (i + 1) * sw - 2, y + h);
  }

  /** Small diamond, filled or outlined. */
  function diamond(b, x, y, r, fill) {
    const p = [x, y - r, x + r, y, x, y + r, x - r, y];
    if (fill) b.fillPoly(p); else b.drawPoly(p, true);
  }

  /** Vertical list with a bracketed selection. items: [label], rows visible, rowH px. */
  function list(b, items, x, y, w, rows, rowH, font) {
    const first = E.clip(sel - (rows >> 1), 0, Math.max(0, items.length - rows));
    (font || b.setFontMonofonto18).call(b);
    b.setFontAlign(-1, 0);
    for (let i = 0; i < rows && first + i < items.length; i++) {
      const yy = y + i * rowH, on = first + i == sel, mid = yy + rowH / 2;
      if (on) {
        b.setColor(1).fillRect(x + 2, yy + 2, x + w - 2, yy + rowH - 3);
        b.setColor(3).drawLine(x, yy, x, yy + rowH - 2).drawLine(x + w, yy, x + w, yy + rowH - 2);
        diamond(b, x + 9, mid - 1, 3, true);
      }
      b.setColor(on ? 3 : 2).drawString(items[first + i], x + 18, mid - 1);
    }
    b.setColor(2);
    if (first > 0) b.fillPoly([x + w / 2 - 5, y - 2, x + w / 2 + 5, y - 2, x + w / 2, y - 7]);
    if (first + rows < items.length) {
      const yb = y + rows * rowH;
      b.fillPoly([x + w / 2 - 5, yb, x + w / 2 + 5, yb, x + w / 2, yb + 5]);
    }
  }

  function para(b, text, x, y, w, maxLines) {
    b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2);
    b.wrapString(text, w).slice(0, maxLines).forEach((l, i) => b.drawString(l, x, y + i * 18));
  }

  /** Wireframe of a lathe profile [[radius, y], ...], rotated about the vertical axis. */
  function lathe(b, cx, cy, profile, scale, angle, tilt) {
    const N = 10, ring = [];
    const ct = Math.cos(tilt), st = Math.sin(tilt);
    profile.forEach((p) => {
      const pts = [];
      for (let i = 0; i < N; i++) {
        const a = angle + (i / N) * Math.PI * 2;
        const x = Math.cos(a) * p[0], z = Math.sin(a) * p[0], y = p[1];
        pts.push([cx + x * scale, cy + (y * ct - z * st) * scale]);
      }
      ring.push(pts);
    });
    ring.forEach((pts, j) => {
      for (let i = 0; i < N; i++) {
        const p = pts[i], q = pts[(i + 1) % N];
        b.setColor(i < N / 2 ? 3 : 1).drawLine(p[0], p[1], q[0], q[1]);
        if (j) b.drawLine(p[0], p[1], ring[j - 1][i][0], ring[j - 1][i][1]);
      }
    });
  }

  // ------------------------------------------------------------------ state
  const TABS = ["STAT", "INV", "DATA", "MAP", "RADIO"];
  const PAGES = [
    ["VITALS", "S.P.E.C.I.A.L.", "V.A.T.S."],
    ["GEAR", "AID", "ID"],
    ["MISSIONS", "SIGNALS", "FEEDS", "LISTS", "CLOCK", "SYSTEM"],
    ["WORLD", "RADAR"],
    ["TUNER"],
  ];
  let tab = -1, page = 0, sel = 0, frame = 0, torch = false, pageData = null;
  let radioOn = false, station = 0, video = null;
  let popup = null; // a message from the companion: { lines }
  let X = null; // the companion extras (see extras.js), when the SD card has them

  // ------------------------------------------------------------------ pages
  // { build() -> data, draw(b, data), select(data), video: "split" | "full", onKnob(dir, data) }

  const P = {};

  P.VITALS = {
    video: "split",
    build: () => ({ files: videos("STAT", "VB"), i: 0 }),
    start(d) {
      if (d.files.length) playVideo("STAT/" + d.files[d.i], VIDEO);
      else g.setColor(g.theme.fg).setFontMonofonto16().setFontAlign(0, 0).drawString("NO STAT VIDEOS ON SD", 240, 170);
    },
    onKnob(dir, d) {
      if (!d.files.length) return;
      d.i = (d.i + d.files.length - dir) % d.files.length;
      sound("ROT_V_1");
      playVideo("STAT/" + d.files[d.i], VIDEO);
    },
    drawL(b) {
      const bat = battery();
      ring(b, 48, 36, 30, bat, "HP", Math.round(bat * 100) + "");
      ring(b, 48, 106, 30, 0.74, "AP", "74");
      const rads = 0.31 + Math.sin(frame / 12) * 0.02;
      ring(b, 48, 176, 30, rads, "RAD", Math.round(rads * 1000) + "");
    },
    drawR(b, d) {
      b.setFontMonofonto16().setFontAlign(-1, -1);
      [["HEAD", 1], ["TORSO", 0.92], ["L.ARM", 1], ["R.ARM", 0.6], ["L.LEG", 0.85], ["R.LEG", 1]].forEach((l, i) => {
        const y = 4 + i * 30;
        b.setColor(2).drawString(l[0], 4, y);
        meter(b, 4, y + 18, 86, 5, l[1], 6);
      });
      b.setColor(1).setFontAlign(0, -1).drawString(d.files.length ? (d.i + 1) + "/" + d.files.length : "NO SD", 48, 190);
    },
  };

  P["S.P.E.C.I.A.L."] = {
    build: () => [
      ["STR", "Strength", 5, "Carry weight and melee damage."],
      ["PER", "Perception", 7, "V.A.T.S. accuracy at range and awareness of what's coming."],
      ["END", "Endurance", 6, "Health, and how long you can run before the wasteland catches you."],
      ["CHA", "Charisma", 6, "Better prices and better ways out of a fight."],
      ["INT", "Intelligence", 9, "Experience earned, hacking, and more from every terminal."],
      ["AGI", "Agility", 7, "Action Points for V.A.T.S. and sneaking."],
      ["LCK", "Luck", 4, "Critical hits, and what turns up in the junk."],
    ].map((r, i) => SHEET ? [r[0], r[1], E.clip(SHEET.special[i] | 0, 1, 10), r[3]] : r),
    draw(b, d) {
      // Heptagon radar chart with a rotating sweep
      const cx = 104, cy = 104, R = 84, ang = (i) => -Math.PI / 2 + (i * Math.PI * 2) / 7;
      for (let k = 1; k <= 5; k++) {
        const pts = [];
        for (let i = 0; i < 7; i++) pts.push(cx + Math.cos(ang(i)) * R * k / 5, cy + Math.sin(ang(i)) * R * k / 5);
        b.setColor(k == 5 ? 2 : 1).drawPoly(pts, true);
      }
      const val = [];
      d.forEach((s, i) => {
        b.setColor(1).drawLine(cx, cy, cx + Math.cos(ang(i)) * R, cy + Math.sin(ang(i)) * R);
        val.push(cx + Math.cos(ang(i)) * R * s[2] / 10, cy + Math.sin(ang(i)) * R * s[2] / 10);
      });
      b.setColor(3).drawPoly(val, true);
      const sw = frame / 8;
      b.setColor(2).drawLine(cx, cy, cx + Math.cos(sw) * R, cy + Math.sin(sw) * R);
      b.setFontMonofonto16().setFontAlign(0, 0);
      d.forEach((s, i) => {
        const x = cx + Math.cos(ang(i)) * (R + 12), y = cy + Math.sin(ang(i)) * (R + 10);
        b.setColor(i == sel ? 3 : 2).drawString(s[0], x, y);
        if (i == sel) diamond(b, val[i * 2], val[i * 2 + 1], 4, true);
      });
      // Detail
      const s = d[sel];
      b.setColor(1).drawLine(222, 6, 222, 202);
      b.setColor(3).setFontMonofonto23().setFontAlign(-1, -1).drawString(s[1].toUpperCase(), 234, 6);
      b.setFontMonofonto96().drawString(s[2], 234, 36);
      meter(b, 234, 136, 158, 6, s[2] / 10, 10);
      para(b, s[3], 234, 150, 158, 3);
    },
  };

  P["V.A.T.S."] = {
    build: () => ({
      parts: [
        // name, chance %, anchor on the figure (x, y), label box (x, y)
        ["HEAD", 41, 100, 34, 2, 10],
        ["TORSO", 88, 100, 84, 2, 72],
        ["L.ARM", 63, 68, 96, 2, 134],
        ["R.ARM", 59, 132, 96, 150, 10],
        ["L.LEG", 71, 88, 160, 150, 72],
        ["R.LEG", 74, 112, 160, 150, 134],
      ],
      queue: [],
    }),
    draw(b, d) {
      const cx = 100, j = Math.sin(frame / 5) * 1.5;
      // target outline (generic figure, lines only)
      b.setColor(2).drawCircle(cx, 34 + j, 14);
      b.drawPoly([cx - 18, 54, cx + 18, 54, cx + 14, 118, cx - 14, 118], true);
      b.drawPoly([cx - 18, 56, cx - 38, 112, cx - 30, 116, cx - 14, 72], false);
      b.drawPoly([cx + 18, 56, cx + 38, 112, cx + 30, 116, cx + 14, 72], false);
      b.drawPoly([cx - 14, 118, cx - 16, 196, cx - 4, 196, cx - 2, 124], false);
      b.drawPoly([cx + 14, 118, cx + 16, 196, cx + 4, 196, cx + 2, 124], false);
      b.setFontMonofonto16().setFontAlign(-1, -1);
      d.parts.forEach((p, i) => {
        const on = i == sel, bx = p[4], by = p[5], ax = p[2], ay = p[3];
        // label boxes are 48x38: name (5 characters = 40 px) above the hit chance
        const ex = bx < cx ? bx + 48 : bx;
        b.setColor(on ? 3 : 1).drawLine(ax, ay, ex, by + 19);
        if (on) b.setColor(3).fillRect(bx, by, bx + 48, by + 38).setColor(0);
        else b.setColor(2).drawRect(bx, by, bx + 48, by + 38);
        b.drawString(p[0], bx + 4, by + 1);
        b.setColor(on ? 0 : 3).drawString(p[1] + "%", bx + 4, by + 19);
        if (on) brackets(b, ax - 10, ay - 10, ax + 10, ay + 10, 4);
      });
      // AP and queue
      const cost = d.queue.length * 25;
      b.setColor(1).drawLine(222, 6, 222, 202);
      b.setColor(3).setFontMonofonto23().setFontAlign(-1, -1).drawString("V.A.T.S.", 234, 6);
      b.setFontMonofonto16().setColor(2).drawString("AP " + (100 - cost) + "/100", 234, 40);
      meter(b, 234, 60, 158, 8, (100 - cost) / 100, 10);
      b.drawString("QUEUE", 234, 80);
      d.queue.forEach((q, i) => b.setColor(3).drawString((i + 1) + ". " + d.parts[q][0] + " " + d.parts[q][1] + "%", 242, 100 + i * 18));
      b.setColor(1).drawString(d.queue.length < 4 ? "SELECT: ADD SHOT" : "QUEUE FULL", 234, 184);
    },
    select(d) {
      if (d.queue.length < 4) d.queue.push(sel), sound("OK");
      else d.queue = [], sound("CANCEL");
    },
  };

  /** Inventory: tiles on the left, a rotating wireframe and stats on the right. */
  function inventory(items) {
    return {
      build: () => items,
      draw(b, d) {
        list(b, d.map((it) => it[0]), 4, 10, 206, 7, 27);
        const it = d[sel];
        b.setColor(1).drawLine(218, 6, 218, 202);
        brackets(b, 228, 6, 392, 118, 8);
        lathe(b, 310, 62, it[1], it[2], frame / 10, 0.35);
        b.setFontMonofonto16().setFontAlign(-1, -1);
        it[3].forEach((s, i) => {
          const y = 126 + i * 19;
          b.setColor(2).drawString(s[0], 230, y);
          b.setColor(3).setFontAlign(1, -1).drawString(s[1], 392, y).setFontAlign(-1, -1);
        });
      },
      select(d) { sound("OK"); },
    };
  }

  // Lathe profiles: [radius, height] from top to bottom, in model units
  const BOTTLE = [[3, -12], [3, -8], [7, -2], [7, 12]];
  const CORE = [[6, -12], [8, -10], [8, 10], [6, 12]];
  const SYRINGE = [[1, -14], [3, -10], [3, 8], [6, 9], [2, 13]];
  const CAN = [[6, -9], [6, 9]];
  const HELMET = [[2, -10], [8, -7], [10, 0], [10, 6], [8, 8]];

  P.GEAR = inventory([
    ["Fusion Core", CORE, 4, [["CHARGE", "87%"], ["WG", "4"], ["VAL", "200"]]],
    ["Power Helmet", HELMET, 4.4, [["DR", "32"], ["WG", "10"], ["VAL", "180"]]],
    ["Holotape", CAN, 4.4, [["DATA", "1.2MB"], ["WG", "0"], ["VAL", "10"]]],
    ["Signal Relay", CORE, 3.4, [["RANGE", "4KM"], ["WG", "6"], ["VAL", "460"]]],
    ["Stealth Field", CAN, 3.6, [["DUR", "30S"], ["WG", "2"], ["VAL", "750"]]],
  ]);

  P.AID = inventory([
    ["Stimpak", SYRINGE, 3.6, [["EFFECT", "+40 HP"], ["WG", "0.1"], ["VAL", "75"]]],
    ["Nuka-Cola Quantum", BOTTLE, 3.6, [["EFFECT", "+20 AP"], ["WG", "1"], ["VAL", "50"]]],
    ["RadAway", SYRINGE, 3.6, [["EFFECT", "-300 RAD"], ["WG", "0.1"], ["VAL", "80"]]],
    ["Med-X", SYRINGE, 3.6, [["EFFECT", "+25 DR"], ["WG", "0"], ["VAL", "50"]]],
    ["Purified Water", BOTTLE, 3.6, [["EFFECT", "+20 HP"], ["WG", "0.5"], ["VAL", "20"]]],
    ["Mentats", CAN, 3.6, [["EFFECT", "+2 INT"], ["WG", "0"], ["VAL", "50"]]],
  ]);

  P.MISSIONS = {
    build: () => [
      ["Signal in the Static", "Triangulate the repeating broadcast from the dead zone.", 0.6],
      ["Power Play", "Bring a charged fusion core to the relay array.", 0.3],
      ["Old Friends", "Find the vault that answered the distress call.", 1],
      ["Clean Water", "Repair the purifier before the caravan arrives.", 1],
      ["Night Shift", "Clear the substation of whatever chewed through the cables.", 0],
    ],
    draw(b, d) {
      // timeline: a node per mission, filled when complete
      for (let i = 0; i < d.length; i++) {
        const y = 14 + i * 38, on = i == sel, done = d[i][2] >= 1;
        if (i) b.setColor(1).drawLine(14, y - 30, 14, y - 8);
        b.setColor(on ? 3 : 2);
        diamond(b, 14, y, on ? 7 : 5, done || on);
        b.setFontMonofonto18().setFontAlign(-1, -1).setColor(on ? 3 : done ? 1 : 2).drawString(d[i][0], 30, y - 10);
        if (on) b.setColor(1).drawLine(30, y + 12, 214, y + 12);
      }
      const m = d[sel];
      b.setColor(1).drawLine(222, 6, 222, 202);
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString(m[2] >= 1 ? "COMPLETE" : "ACTIVE", 234, 6);
      para(b, m[1], 234, 32, 158, 5);
      b.setColor(2).drawString("PROGRESS", 234, 150);
      meter(b, 234, 170, 158, 10, m[2], 10);
    },
  };

  P.SIGNALS = {
    build: () => ({
      list: [["EMERGENCY BEACON", 0.18], ["MILITARY FREQ", 0.42], ["UNKNOWN HOLOTAPE", 0.61], ["VAULT RELAY", 0.83]],
      rows: [],
    }),
    draw(b, d) {
      // spectrum waterfall: a new row each frame, older rows scroll down and fade
      const W = 220, peak = d.list[sel][1];
      const row = [];
      for (let x = 0; x < W; x += 4) {
        const f = x / W, near = Math.max(0, 1 - Math.abs(f - peak) * 14);
        row.push(Math.random() * 0.4 + near * (0.7 + Math.random() * 0.3));
      }
      d.rows.unshift(row);
      if (d.rows.length > 30) d.rows.pop();
      d.rows.forEach((r, j) => r.forEach((v, i) => {
        const c = v > 0.75 ? 3 : v > 0.45 ? 2 : v > 0.3 ? 1 : 0;
        if (c && j < 30) b.setColor(j > 20 && c > 1 ? c - 1 : c).fillRect(4 + i * 4, 66 + j * 4, 6 + i * 4, 68 + j * 4);
      }));
      // live spectrum on top
      let px = 4, py = 60;
      b.setColor(3);
      row.forEach((v, i) => { const x = 4 + i * 4, y = 60 - v * 50; b.drawLine(px, py, x, y); px = x; py = y; });
      b.setColor(1).drawLine(4, 62, 4 + W, 62);
      b.setColor(2).drawLine(4 + peak * W, 4, 4 + peak * W, 62);
      b.setColor(1).drawLine(234, 6, 234, 202);
      list(b, d.list.map((s) => s[0]), 240, 10, 156, 4, 30, b.setFontMonofonto16);
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString((88 + d.list[sel][1] * 20).toFixed(1) + " MHZ", 248, 140);
      b.setColor(frame & 8 ? 3 : 1).drawString("LOCKED", 248, 162);
    },
    onKnob(dir, d) { sel = E.clip(sel - dir, 0, d.list.length - 1); sound("ROT_V_1"); },
  };

  // ---- Pip-OS 1.33 screens, from the same SD card files as the stock firmware

  // DATA > FEEDS: videos and pictures from DATA/, plus USER/USERIMG.img; the wheel flips through them
  P.FEEDS = {
    video: "full",
    build: () => ({ list: feeds(), i: 0, still: false }),
    start(d) { showFeed(d); },
    onKnob(dir, d) {
      if (!d.list.length) return;
      d.i = (d.i + d.list.length - dir) % d.list.length;
      sound("ROT_V_1");
      showFeed(d);
    },
    draw(b, d) {
      b.setFontMonofonto18().setFontAlign(0, 0).setColor(2).drawString(d.list.length ? "TUNING FEED..." : "NO FEEDS ON SD CARD", 200, 105);
    },
  };

  function showFeed(d) {
    const f = d.list[d.i];
    if (!f) return;
    d.still = false;
    if (f.video) return playVideo(f.path, { x: 40, y: 40 }, f.loop);
    stopVideo();
    stillTimer = setTimeout(() => {
      stillTimer = undefined;
      try { blitRaw(bC, f.path, 400, 248, 40, 40); d.still = true; } catch (e) { print("ERROR:", e.message); }
    }, 150);
  }

  // INV > ID: the ID card fills the screen (header and footer too, as on the stock firmware)
  P.ID = {
    build: () => ({ card: hasIdCard(), still: false }),
    start(d) {
      if (!d.card) return;
      stillTimer = setTimeout(() => {
        stillTimer = undefined;
        g.clear();
        try { blitRaw(bC, ID_CARD, 400, 300, 40, 10); d.still = true; covered = true; } catch (e) { print("ERROR:", e.message); }
      }, 200);
    },
    draw(b) {
      b.setFontMonofonto18().setFontAlign(0, 0).setColor(3).drawString("NO ID CARD ON SD CARD", 200, 90);
      b.setFontMonofonto16().setColor(2).drawString("MAKE ONE WITH THE PIP-BOY COMPANION", 200, 120).drawString("(ID, LISTS & FEEDS) OR PIP-BOY TOOLS", 200, 140);
    },
  };

  // DATA > LISTS: checklists; the wheel picks, pressing it opens a list or ticks an item
  P.LISTS = {
    build: () => ({ lists: readLists(), open: -1 }),
    rows(d) {
      if (!d.lists) return [];
      if (d.open < 0) return d.lists.categories.map((c) => [c.name || "UNTITLED", c.items.filter((i) => i.done).length + "/" + c.items.length]);
      return [["< BACK", ""]].concat(d.lists.categories[d.open].items.map((i) => [i.text || "", i.done ? 1 : 0]));
    },
    draw(b, d) {
      const rows = this.rows(d);
      if (!rows.length) {
        b.setFontMonofonto18().setFontAlign(0, 0).setColor(3).drawString(d.lists ? "NO LISTS" : "NO LISTS ON SD CARD", 200, 90);
        b.setFontMonofonto16().setColor(2).drawString("MAKE THEM WITH THE PIP-BOY COMPANION", 200, 120).drawString("(ID, LISTS & FEEDS) OR PIP-BOY TOOLS", 200, 140);
        return;
      }
      const top = d.open < 0 ? 4 : 30;
      if (d.open >= 0) {
        b.setFontMonofonto18().setFontAlign(0, -1).setColor(3).drawString(d.lists.categories[d.open].name.toUpperCase(), 200, 2);
        b.setColor(1).drawLine(20, 26, 380, 26);
      }
      const R = d.open < 0 ? 7 : 6, H = 28, first = E.clip(sel - (R >> 1), 0, Math.max(0, rows.length - R));
      b.setFontMonofonto18();
      for (let k = 0; k < R && first + k < rows.length; k++) {
        const i = first + k, y = top + k * H, row = rows[i], on = i == sel;
        if (on) { b.setColor(1).fillRect(8, y, 392, y + H - 3); b.setColor(3).drawLine(6, y, 6, y + H - 3).drawLine(394, y, 394, y + H - 3); }
        let x = 20;
        if (d.open >= 0 && i > 0) { // checkbox
          b.setColor(on ? 3 : 2).drawRect(x, y + 7, x + 12, y + 19);
          if (row[1]) b.fillRect(x + 3, y + 10, x + 9, y + 16);
          x += 22;
        }
        b.setFontAlign(-1, 0).setColor(on ? 3 : 2).drawString(row[0], x, y + H / 2 - 1);
        if (d.open < 0) b.setFontAlign(1, 0).drawString(row[1], 384, y + H / 2 - 1);
      }
    },
    onKnob(dir, d) {
      const n = this.rows(d).length;
      if (!n) return;
      const before = sel;
      sel = E.clip(sel - dir, 0, n - 1);
      if (sel != before) sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
    },
    select(d) {
      if (!d.lists || !this.rows(d).length) return;
      if (d.open < 0) { d.open = sel; sel = 0; sound("OK"); return; }
      if (sel == 0) { sel = d.open; d.open = -1; sound("CANCEL"); return; }
      const item = d.lists.categories[d.open].items[sel - 1];
      setDone(d.lists, item, !item.done);
      sound(item.done ? "OK" : "OK2");
    },
  };

  P.CLOCK = {
    draw(b) {
      const d = new Date(), two = (n) => ("0" + n).substr(-2);
      const cx = 104, cy = 104, h = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
      // three rings: hours, minutes, seconds
      b.setColor(1);
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2 - Math.PI / 2, r1 = i % 5 ? 92 : 86;
        b.drawLine(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * 96, cy + Math.sin(a) * 96);
      }
      const top = -Math.PI / 2;
      b.setColor(3);
      arc(b, cx, cy, 78, top, top + (s / 60) * Math.PI * 2);
      arc(b, cx, cy, 70, top, top + (m / 60) * Math.PI * 2, true);
      b.setColor(2);
      arc(b, cx, cy, 60, top, top + ((h % 12) / 12) * Math.PI * 2, true);
      b.setColor(3).setFontMonofonto28().setFontAlign(0, 0).drawString(two(h) + ":" + two(m), cx, cy - 6);
      b.setFontMonofonto16().setColor(2).drawString(two(s), cx, cy + 20);
      b.setColor(1).drawLine(222, 6, 222, 202);
      b.setFontAlign(-1, -1).setColor(2).drawString("DATE", 234, 10);
      b.setColor(3).setFontMonofonto23().drawString(d.getFullYear() + "." + two(d.getMonth() + 1) + "." + two(d.getDate()), 234, 30);
      b.setFontMonofonto16().setColor(2).drawString("UPTIME", 234, 76);
      const up = Math.floor(getTime() - startTime);
      b.setColor(3).setFontMonofonto23().drawString(two(Math.floor(up / 3600)) + ":" + two(Math.floor(up / 60) % 60) + ":" + two(up % 60), 234, 96);
      b.setFontMonofonto16().setColor(2).drawString("DAY CYCLE", 234, 142);
      meter(b, 234, 162, 158, 10, (h * 60 + m) / 1440, 12);
    },
  };

  P.SYSTEM = {
    build: () => [
      { t: "Theme", v: () => THEMES[cfg.theme].name, go: () => { cfg.theme = (cfg.theme + 1) % THEMES.length; applyTheme(); drawHeader(); drawFooter(); } },
      { t: "Brightness", v: () => "|".repeat(cfg.bright + 1), go: () => { cfg.bright = (cfg.bright + 1) % 5; backlight(); } },
      { t: "Sounds", v: () => cfg.sound ? "ON" : "OFF", go: () => { cfg.sound = !cfg.sound; } },
      { t: "Return to stock UI", v: () => "", go: exitToStock },
    ],
    draw(b, d) {
      list(b, d.map((o) => o.t), 4, 10, 240, 4, 30);
      b.setFontMonofonto18().setFontAlign(1, 0).setColor(3);
      d.forEach((o, i) => b.drawString(o.v(), 392, 10 + i * 30 + 14));
      const m = process.memory(false);
      b.setColor(1).drawLine(0, 140, 399, 140);
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2);
      b.drawString("PIP-OS X 1.0 CONCEPT   FIRMWARE " + process.env.VERSION, 6, 150);
      b.drawString("MEMORY " + m.usage + "/" + m.total + "   STORAGE " + Math.round(require("Storage").getFree() / 1024) + "KB FREE", 6, 170);
    },
    select(d) { d[sel].go(); save(); sound("OK"); },
  };

  // The device's own animated maps from the SD card, full screen
  P.WORLD = {
    video: "full",
    build: () => ({ files: videos("MAP"), i: 0 }),
    start(d) { if (d.files.length) playVideo("MAP/" + d.files[d.i], { x: 36, y: 40 }); },
    onKnob(dir, d) {
      if (!d.files.length) return;
      d.i = (d.i + d.files.length - dir) % d.files.length;
      sound("ROT_V_1");
      playVideo("MAP/" + d.files[d.i], { x: 36, y: 40 });
    },
    draw(b, d) {
      // only shown when the card has no MAP folder
      b.setFontMonofonto18().setFontAlign(0, 0).setColor(2).drawString("NO MAP DATA ON SD CARD", 200, 105);
    },
  };

  P.RADAR = {
    build: () => {
      const blips = [];
      for (let i = 0; i < 9; i++) blips.push([Math.random() * Math.PI * 2, 20 + Math.random() * 70, ["HOSTILE", "FRIENDLY", "LOOT", "SETTLEMENT"][i % 4]]);
      return blips;
    },
    draw(b, d) {
      const cx = 104, cy = 104, sweep = frame / 6;
      b.setColor(1);
      [30, 60, 92].forEach((r) => b.drawCircle(cx, cy, r));
      b.drawLine(cx - 96, cy, cx + 96, cy).drawLine(cx, cy - 96, cx, cy + 96);
      for (let k = 0; k < 6; k++) {
        b.setColor(k ? 1 : 3);
        const a = sweep - k * 0.06;
        b.drawLine(cx, cy, cx + Math.cos(a) * 92, cy + Math.sin(a) * 92);
      }
      d.forEach((p, i) => {
        // blips light up as the sweep passes, then fade
        let since = (sweep - p[0]) % (Math.PI * 2);
        if (since < 0) since += Math.PI * 2;
        const x = cx + Math.cos(p[0]) * p[1], y = cy + Math.sin(p[0]) * p[1];
        b.setColor(since < 1 ? 3 : since < 3 ? 2 : 1);
        if (p[2] == "HOSTILE") b.fillPoly([x, y - 4, x + 4, y + 3, x - 4, y + 3]);
        else if (p[2] == "LOOT") b.fillRect(x - 2, y - 2, x + 2, y + 2);
        else diamond(b, x, y, 3, p[2] == "FRIENDLY");
        if (i == sel) b.setColor(3).drawCircle(x, y, 8);
      });
      const p = d[sel];
      b.setColor(1).drawLine(222, 6, 222, 202);
      b.setFontMonofonto18().setFontAlign(-1, -1).setColor(3).drawString("CONTACT " + (sel + 1) + "/" + d.length, 234, 6);
      b.setFontMonofonto16().setColor(2).drawString("TYPE", 234, 40).drawString("RANGE", 234, 80).drawString("BEARING", 234, 120);
      b.setFontMonofonto23().setColor(3).drawString(p[2], 234, 56);
      b.drawString(Math.round(p[1] * 12) + " M", 234, 96);
      b.drawString(("00" + Math.round(((p[0] * 180) / Math.PI + 90) % 360)).substr(-3) + " DEG", 234, 136);
    },
  };

  // RADIO: the FM dial and your presets from the companion (real FM), then the wasteland's
  // stations (clips from the SD card's RADIO folder) at made-up spots on the dial.
  P.TUNER = {
    build: () => (X ? [{ t: "FM DIAL", dial: 1 }].concat(X.presets().map((s) => ({ t: s.f.toFixed(1) + " " + s.name, f: s.f }))) : [])
      .concat(["Diamond City Radio", "Classical Radio", "Radio Freedom", "Galaxy News Radio", "Appalachia Radio"].map((t, i) => ({ t, at: 88.1 + i * 4.6 }))),
    draw(b, d) {
      // a semicircular dial (88-108 MHz) with the stations on it, needle on the selection
      const cx = 104, cy = 140, R = 96, mhz = (s) => (s.dial ? X.fm.freq : s.f || s.at), f = (i) => Math.PI * (1.05 + (0.9 * (E.clip(mhz(d[i]), 88, 108) - 88)) / 20);
      const fmOn = X && X.fm.on;
      b.setColor(1);
      arc(b, cx, cy, R, Math.PI, Math.PI * 2);
      for (let i = 0; i <= 40; i++) {
        const a = Math.PI * (1 + i / 40), r1 = i % 5 ? R - 5 : R - 10;
        b.drawLine(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      }
      d.forEach((s, i) => { if (!s.dial) { b.setColor(i == sel ? 3 : 2); diamond(b, cx + Math.cos(f(i)) * (R - 18), cy + Math.sin(f(i)) * (R - 18), 3, i == station && playing()); } });
      const a = f(sel) + Math.sin(frame / 3) * 0.01;
      b.setColor(3).drawLine(cx, cy, cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4));
      b.fillCircle(cx, cy, 5);
      b.setFontMonofonto23().setFontAlign(0, -1).drawString(mhz(d[sel]).toFixed(1) + " FM", cx, cy + 14);
      if (fmOn && d[station].dial && station == sel) b.setFontMonofonto16().setColor(2).drawString("THUMBWHEEL: TUNE", cx, cy + 42);
      // spectrum bars (with FM, their height follows the signal)
      const level = fmOn ? 0.2 + X.fm.signal() : radioOn ? 1 : 0;
      for (let i = 0; i < 16; i++) {
        const h = level ? 4 + Math.abs(Math.sin(frame / 2 + i * 0.9) * Math.sin(frame / 7 + i)) * 40 * Math.min(level, 1) : 2;
        b.setColor(i & 1 ? 2 : 3).fillRect(234 + i * 10, 202 - h, 240 + i * 10, 202);
      }
      b.setColor(1).drawLine(222, 6, 222, 202);
      list(b, d.map((s) => (s.t.length > 17 ? s.t.slice(0, 16) + "." : s.t)), 228, 8, 168, 5, 28, b.setFontMonofonto16);
    },
    select(d) {
      if (playing() && station == sel) stopRadio();
      else { station = sel; play(d); }
    },
    play(d) { if (playing()) stopRadio(); else { station = sel; play(d); } },
    onKnob2(dir, d) {
      // On the FM dial the thumbwheel tunes in 0.1 MHz steps; elsewhere it moves the needle
      // through the stations, switching if the radio is on
      if (X && X.fm.on && d[station].dial && station == sel) { X.fm.tune(X.fm.freq + dir / 10); return; }
      sel = (sel + d.length + dir) % d.length;
      if (playing()) { station = sel; play(d); }
      sound(dir > 0 ? "NEXT" : "PREV");
    },
  };

  const playing = () => radioOn || (X && X.fm.on);
  function stopRadio() { radio(false); if (X) X.fm.enable(false); }
  /** Play station `station` of the list `d`: FM (the dial or a preset) or a clip station. */
  function play(d) {
    const s = d[station];
    if (s.dial || s.f) {
      if (radioOn) radio(false);
      if (s.f) X.fm.tune(s.f);
      if (!X.fm.on && !X.fm.enable(true)) print("ERROR: the FM radio didn't answer");
    } else { stopRadio(); radio(true); }
  }

  function radio(on) {
    radioOn = on;
    try {
      if (on) {
        const files = require("fs").readdirSync("RADIO").filter((f) => f.toUpperCase().endsWith(".WAV"));
        if (files.length) Pip.audioStart("RADIO/" + files[(Math.random() * files.length) | 0]);
      } else Pip.audioStop();
    } catch (e) {}
  }

  // The Pip-Boy has one SD stream for audio and video: Pip.audioStart() closes a playing video.
  // So a video starts a moment after the UI sound that usually comes with a page change (as
  // the stock firmware does), and no UI sounds play while it runs.
  // `loop`: a video to repeat once `file` has played (FEEDS' X_LOOP.avi), via the
  // videoStopped event of Espruino 2v29 (Pip-OS 1.33); older firmware just repeats `file`.
  let videoTimer, stillTimer;
  const quietStop = () => { if (Pip.removeAllListeners) Pip.removeAllListeners("videoStopped"); Pip.videoStop(); };
  function playVideo(file, pos, loop) {
    if (videoTimer) clearTimeout(videoTimer);
    if (stillTimer) clearTimeout(stillTimer);
    stillTimer = undefined;
    video = file;
    videoTimer = setTimeout(() => {
      videoTimer = undefined;
      try {
        quietStop();
        const chain = loop && Pip.on;
        if (chain) Pip.on("videoStopped", () => {
          Pip.removeAllListeners("videoStopped");
          if (video == file) { video = loop; Pip.videoStart(loop, { x: pos.x, y: pos.y, repeat: true }); }
        });
        Pip.videoStart(file, { x: pos.x, y: pos.y, repeat: !chain });
      } catch (e) { video = null; }
    }, 150);
  }

  function stopVideo() {
    if (videoTimer) clearTimeout(videoTimer);
    if (stillTimer) clearTimeout(stillTimer);
    videoTimer = stillTimer = undefined;
    if (!video) return;
    try { quietStop(); } catch (e) {}
    video = null;
  }

  let startTime = getTime();

  function battery() {
    if (VUSB_PRESENT.read()) return 1;
    try { return E.clip((analogRead(VBAT_MEAS) * 2 * E.getAnalogVRef() - 3.5) / 0.6, 0, 1); } catch (e) { return 1; }
  }

  // ------------------------------------------------------------------ header & footer

  function drawHeader() {
    const full = !current() || current().video != "full";
    bH.clear().setFontMonofonto18().setFontAlign(0, -1);
    // tabs as slanted cells; the active one filled
    const cw = 70;
    TABS.forEach((t, i) => {
      const x = 6 + i * (cw + 2), on = i == tab;
      const poly = [x + 6, 2, x + cw, 2, x + cw - 6, 26, x, 26];
      if (on) bH.setColor(3).fillPoly(poly).setColor(0);
      else bH.setColor(1).drawPoly(poly, true).setColor(2);
      bH.drawString(t, x + cw / 2, 5);
    });
    if (full && tab >= 0) {
      // sub-pages: diamonds and names, the current one bright
      // tabs with many pages scroll so the current one is always in view
      bH.setFontMonofonto16().setFontAlign(-1, -1);
      const w = PAGES[tab].map((p) => bH.stringWidth(p) + 30);
      let x = 10, before = 0;
      for (let i = 0; i < page; i++) before += w[i];
      const total = w.reduce((a, b) => a + b, 0);
      if (total > 362) x -= E.clip(before + w[page] - 362, 0, total - 362);
      PAGES[tab].forEach((p, i) => {
        bH.setColor(i == page ? 3 : 1);
        diamond(bH, x + 4, 41, 4, i == page);
        bH.drawString(p, x + 14, 32);
        x += bH.stringWidth(p) + 30;
      });
    }
    Pip.blitImage(bH, 53, 7, { noScanEffect: true, height: full ? 51 : 30 });
  }

  function drawFooter() {
    const d = new Date(), two = (n) => ("0" + n).substr(-2);
    const m = process.memory(false), bat = battery();
    bF.clear().setColor(1).drawLine(0, 0, 371, 0).drawLine(0, 24, 371, 24);
    bF.setFontMonofonto16().setFontAlign(-1, -1);
    // battery cell, percentage
    bF.setColor(2).drawRect(4, 6, 40, 18).fillRect(41, 9, 43, 15);
    bF.setColor(3).fillRect(6, 8, 6 + Math.round(32 * bat), 16);
    bF.drawString(Math.round(bat * 100) + "%", 50, 4);
    // time, centred
    bF.setFontAlign(0, -1).drawString(two(d.getHours()) + ":" + two(d.getMinutes()) + "  " + two(d.getDate()) + "." + two(d.getMonth() + 1) + "." + d.getFullYear(), 186, 4);
    // memory ring and signal bars
    bF.setFontAlign(-1, -1).setColor(2).drawString("MEM", 278, 4);
    meter(bF, 308, 8, 30, 8, 1 - m.usage / m.total, 4);
    for (let i = 0; i < 4; i++) bF.setColor(i < 3 ? 3 : 1).fillRect(346 + i * 6, 18 - i * 4, 350 + i * 6, 18);
    Pip.blitImage(bF, 52, 290, { noScanEffect: true });
  }

  // ------------------------------------------------------------------ navigation

  const current = () => (tab >= 0 ? P[PAGES[tab][page]] : null);

  let covered = false; // a page (the ID card) is drawn over the header and footer
  function openPage() {
    stopVideo();
    sel = 0;
    const p = current();
    pageData = p.build ? p.build() : null;
    if (covered) { covered = false; g.clear(); drawFooter(); }
    g.setBgColor(0).clearRect(36, 37, 444, 288); // from the header's sub-page row down
    drawHeader();
    if (p.start) p.start(pageData);
  }

  function setTab(t) {
    if (t == tab) return;
    tab = t;
    page = 0;
    openPage();
    sound("ROT_H_1");
  }

  function onKnob1(dir) {
    if (torch || tab < 0 || popup) return;
    const p = current();
    if (p.onKnob) return p.onKnob(dir, pageData);
    const n = Array.isArray(pageData) ? pageData.length : pageData && pageData.parts ? pageData.parts.length : 0;
    if (!n) return;
    const before = sel;
    sel = E.clip(sel - dir, 0, n - 1);
    if (sel != before) sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
  }

  function onKnob2(dir) {
    if (torch || tab < 0 || popup) return;
    if (PAGES[tab].length < 2 || current().ownsKnob2) { // single-page tabs (TUNER tunes with it) and REMOTE use it themselves
      if (current().onKnob2) current().onKnob2(dir, pageData);
      return;
    }
    page = (page + PAGES[tab].length + dir) % PAGES[tab].length;
    openPage();
    sound(dir > 0 ? "NEXT" : "PREV");
  }

  function onSelect() {
    if (torch || tab < 0) return;
    if (popup) { popup = null; sound("OK"); openPage(); return; }
    const p = current();
    if (p.select) p.select(pageData);
  }

  function setTorch(on) {
    torch = on;
    if (on) { stopVideo(); g.setColor(g.theme.fg).fillRect(0, 0, 479, 319); analogWrite(LCD_BL, 1); }
    else { g.clear(); covered = false; backlight(); drawFooter(); openPage(); }
    sound(on ? "L_ON" : "L_OFF");
  }

  // ------------------------------------------------------------------ main loop

  let modePrev = -1, lastError = "";
  const fallback = fallbackMode();
  function tick() {
    const m = modeFor(MODE_SELECTOR.analog(), fallback);
    if (m == modePrev && m >= 0) setTab(m);
    modePrev = m;
    if (torch || tab < 0) return;
    frame++;
    const p = current();
    try {
      if (popup) {
        bC.clear();
        drawPopup(bC);
        Pip.blitImage(bC, 40, 65);
      } else if (pageData && pageData.still) {
        // a picture (FEEDS, ID) stays on screen as drawn
      } else if (p.video == "split") {
        bL.clear().setColor(3);
        bR.clear().setColor(3);
        p.drawL(bL, pageData);
        p.drawR(bR, pageData);
        Pip.blitImage(bL, 40, 65);
        Pip.blitImage(bR, 344, 65);
      } else if (p.video == "full" && video) {
        // the map animation fills the screen
      } else {
        bC.clear().setFontMonofonto16().setFontAlign(-1, -1).setColor(3);
        p.draw(bC, pageData);
        Pip.blitImage(bC, 40, 65);
      }
    } catch (e) {
      if (e.message != lastError) print("ERROR:", e.message);
      lastError = e.message;
    }
    if (frame % 100 == 0 && !covered) drawFooter();
  }

  // A message from the companion (it calls companionMessage over USB when this app is running)
  function drawPopup(b) {
    brackets(b.setColor(3), 20, 14, 380, 196, 16);
    diamond(b, 200, 26, 5, frame & 4);
    b.setFontMonofonto18().setFontAlign(0, -1).drawString("INCOMING MESSAGE", 200, 38);
    b.setColor(1).drawLine(60, 62, 340, 62).setColor(3);
    popup.lines.forEach((l, i) => b.drawString(l, 200, 72 + i * 21));
    b.setFontMonofonto16().setColor(frame & 8 ? 3 : 2).drawString("PRESS THE WHEEL", 200, 174);
  }
  global.companionMessage = (text) => {
    popup = { lines: bC.setFontMonofonto18().wrapString(String(text), 330).slice(0, 4) };
    stopVideo();
    if (pageData) pageData.still = false;
    if (covered) { covered = false; g.clear(); drawFooter(); }
    g.setBgColor(0).clearRect(36, 37, 444, 288); // a split page's video area too
    drawHeader();
    sound("ALERT");
  };

  function boot(done) {
    // expanding rings, then the title
    let r = 0;
    g.clear();
    const t = setInterval(() => {
      g.setColor(g.theme.fg2 || g.theme.fg);
      if (r < 150) { g.drawCircle(240, 160, r); r += 12; }
      else if (r < 170) {
        g.clear().setColor(g.theme.fg).setFontMonofonto36().setFontAlign(0, 0).drawString("PIP-OS X", 240, 140);
        g.setFontMonofonto16().drawString("CONCEPT INTERFACE  //  " + process.env.VERSION, 240, 180);
        sound("UP1");
        r = 170;
        setTimeout(() => { clearInterval(t); g.clear(); done(); }, 900);
      }
    }, 40);
  }

  // Back to the stock interface. load() restarts the interpreter with the firmware's boot code
  // without a hardware reset, so an app set to open at power-on (.bootPowerOn) doesn't come back.
  function exitToStock() { load(); }

  // ------------------------------------------------------------------ start

  clearWatch();
  clearInterval();
  try { E.setTimeZone(JSON.parse(require("fs").readFile("settings.json")).timezone || 0); } catch (e) {}
  // The companion extras from the SD card (see extras.js): their pages join the tabs
  try {
    (0, eval)(require("fs").readFile("USER/PIPOSX.EXT")); // sets global.companionExtras
    X = global.companionExtras({ bC, list, brackets, diamond, sound, sel: () => sel, setSel: (n) => { sel = n; }, frame: () => frame });
  } catch (e) {}
  delete global.companionExtras;
  if (X) { Object.assign(P, X.pages); PAGES[1].push("REMOTE"); PAGES[2].splice(4, 0, "NOTES", "INBOX"); }
  applyTheme();
  backlight();
  // MEAS_ENB powers the mode dial's resistor ladder (and the battery divider): the dial only
  // reads correctly while it's pulled low. The stock firmware does the same; load() resets it.
  pinMode(MEAS_ENB, "opendrain");
  MEAS_ENB.write(0);
  pinMode(KNOB1_B, "input");
  pinMode(KNOB2_A, "input");
  setWatch((e) => onKnob1(e.state ^ e.data ? -1 : 1), KNOB1_A, { data: KNOB1_B, edge: 1, repeat: true, debounce: 0 });
  setWatch((e) => onKnob2(e.state ^ e.data ? 1 : -1), KNOB2_B, { data: KNOB2_A, edge: 1, repeat: true, debounce: 0 });
  setWatch(onSelect, KNOB1_BTN, { edge: "rising", repeat: true, debounce: 20 });
  // PLAY: the radio on RADIO (and mute on REMOTE)
  setWatch(() => { const p = !torch && !popup && current(); if (p && p.play) p.play(pageData); }, BTN_PLAY, { edge: "rising", repeat: true, debounce: 50 });
  setWatch(() => setTorch(!torch), BTN_TORCH, { edge: "rising", repeat: true, debounce: 50 });
  setWatch(() => { stopRadio(); stopVideo(); exitToStock(); }, BTN_POWER, { edge: "rising", repeat: true, debounce: 50 });

  boot(() => {
    drawFooter();
    setInterval(tick, 100);
  });
})();
