// MOJAVE — an alternative Pip-Boy 3000 Mk V interface styled after the New Vegas era of the
// Fallout TV series (season 2): amber phosphor, NCR / Legion / Strip reputation, the season's
// quest log and a Mojave map. Original artwork drawn with Graphics primitives.
//
// Install: write mojave.min.js (./build.sh) to Storage under that name, then load("mojave.min.js").
// sd/USER/MOJAVE.JS on the SD card adds it to the stock INV > APPS menu.
// It runs from flash and replaces the stock interface until the power button is pressed,
// which returns to the stock interface. Needs firmware 2v24 or later (Pip.blitImage);
// the Pip-OS 1.33 screens (INV > ID, DATA > FEEDS and LISTS, ../shared/pipos133.js) work on any.
// The companion's extras (extras.js, read from sd/USER/MOJAVE.EXT so they cost no Storage):
// FM radio and presets in RADIO, INV > REMOTE, DATA > NOTES and INBOX. Messages from the
// companion pop up over whatever is showing.
//
// Controls (as on the stock firmware): mode dial = tabs, thumbwheel = sub-pages,
// wheel = scroll, wheel press = select, PLAY = radio on/off, torch = flashlight, power = exit.

import { feeds, hasIdCard, ID_CARD, blitRaw, readLists, setDone, modeFor, fallbackMode, stockPalette } from "../shared/pipos133.js";

(function () {
  // ------------------------------------------------------------------ hardware
  const KNOB1_A = BTN8, KNOB1_B = BTN9, KNOB1_BTN = BTN7;
  const KNOB2_A = BTN5, KNOB2_B = BTN6;
  const BTN_POWER = BTN10, BTN_PLAY = BTN1, BTN_TORCH = BTN4;
  const MODE_SELECTOR = A7, VBAT_MEAS = A6, VUSB_PRESENT = A9, LCD_BL = B15, MEAS_ENB = C4;

  // Off-screen buffers in the STM32's CCM RAM, where the stock firmware keeps its own
  // (so they don't use JS variables). Drawn with colours 0..3 and shown with Pip.blitImage.
  const area = (offset, bytes) => E.toArrayBuffer(E.memoryArea(0x10008000 + offset, bytes));
  const bC = Graphics.createArrayBuffer(400, 210, 2, { msb: true, buffer: area(0, 21000) });
  const bH = Graphics.createArrayBuffer(372, 51, 2, { msb: true, buffer: area(21000, 4743) });
  const bF = Graphics.createArrayBuffer(372, 25, 2, { msb: true, buffer: area(25743, 2325) });
  const showC = () => Pip.blitImage(bC, 40, 65);
  const showH = () => Pip.blitImage(bH, 53, 7, { noScanEffect: true });
  const showF = () => Pip.blitImage(bF, 52, 290, { noScanEffect: true });

  // ------------------------------------------------------------------ settings & theme
  const SETTINGS_FILE = "mojave.json";
  let cfg = Object.assign({ theme: 0, sound: true, bright: 3 }, require("Storage").readJSON(SETTINGS_FILE, true) || {});
  const save = () => require("Storage").writeJSON(SETTINGS_FILE, cfg);

  const THEMES = [
    { name: "NEW VEGAS", rgb: [1, 0.71, 0.26] }, // amber phosphor
    { name: "OVERSEER", rgb: [0.95, 0.88, 0.35] }, // gold, like Hank's Pip-Boy
    { name: "CLASSIC", rgb: [0.2, 1, 0.3] },     // the stock green
    { name: "ENCLAVE", rgb: [0.45, 0.8, 1] },    // cold blue
    { name: "PIP-BOY", rgb: [0.2, 1, 0.3], stock: true }, // the stock interface's own colour
  ];

  /** Pip palettes: [even lines, odd (scanline) lines, glow even, glow odd] x 16 levels. */
  function applyTheme() {
    const stock = THEMES[cfg.theme].stock && stockPalette();
    if (stock) { Pip.setPalette(stock); g.setBgColor(0); return; }
    const c = THEMES[cfg.theme].rgb;
    const rows = [0.86, 0.65, 1, 0.75];
    Pip.setPalette(rows.map((k) => {
      const row = new Uint16Array(16);
      for (let i = 0; i < 16; i++) {
        const v = (i / 15) * k;
        row[i] = ((c[0] * v * 31) << 11) | ((c[1] * v * 63) << 5) | (c[2] * v * 31);
      }
      return row;
    }));
    g.setBgColor(0);
  }

  function backlight() {
    analogWrite(LCD_BL, [0.05, 0.12, 0.3, 0.6, 1][cfg.bright], { freq: 200 });
  }

  function sound(file) {
    if (!cfg.sound || (video && !videoTimer)) return; // a UI sound would stop the video (see playVideo)
    try { Pip.audioStart("UI/" + file + ".wav"); } catch (e) {}
  }

  // ------------------------------------------------------------------ state
  const TABS = ["STAT", "INV", "DATA", "MAP", "RADIO"];
  const PAGES = [
    ["STATUS", "S.P.E.C.I.A.L.", "FACTIONS"],
    ["WEAPONS", "APPAREL", "AID", "MISC", "ID"],
    ["QUESTS", "UPLINK", "FEEDS", "LISTS", "CLOCK", "SYSTEM"],
    ["MOJAVE"],
    ["STATIONS"],
  ];
  let tab = -1, page = 0, sel = 0, frame = 0, torch = false;
  let pageData = null; // the current page's items, built when the page opens
  let radioOn = false, station = 0;
  let video = null, videoTimer, stillTimer, covered = false;
  let popup = null; // a message from the companion: { lines }

  // ------------------------------------------------------------------ drawing helpers
  function corners(b, x1, y1, x2, y2, len) {
    b.drawLine(x1, y1, x1 + len, y1).drawLine(x1, y1, x1, y1 + len);
    b.drawLine(x2, y1, x2 - len, y1).drawLine(x2, y1, x2, y1 + len);
    b.drawLine(x1, y2, x1 + len, y2).drawLine(x1, y2, x1, y2 - len);
    b.drawLine(x2, y2, x2 - len, y2).drawLine(x2, y2, x2, y2 - len);
  }

  function bar(b, x, y, w, h, frac, ticks) {
    b.setColor(1).drawRect(x, y, x + w, y + h);
    b.setColor(3).fillRect(x + 2, y + 2, x + 2 + Math.round((w - 4) * E.clip(frac, 0, 1)), y + h - 2);
    if (ticks) for (let i = 1; i < ticks; i++) b.setColor(0).drawLine(x + (w * i) / ticks, y + 2, x + (w * i) / ticks, y + h - 2);
  }

  /** A scrolling list on the left of the content area. items: [{t: label, mark}] */
  function list(b, items, x, y, w, rows, rowH) {
    const first = E.clip(sel - (rows >> 1), 0, Math.max(0, items.length - rows));
    b.setFontMonofonto18().setFontAlign(-1, 0);
    for (let i = 0; i < rows && first + i < items.length; i++) {
      const it = items[first + i], yy = y + i * rowH, on = first + i == sel;
      if (on) b.setColor(2).fillRect(x, yy, x + w, yy + rowH - 3).setColor(0);
      else b.setColor(3);
      if (it.mark) b.fillRect(x + 4, yy + rowH / 2 - 5, x + 11, yy + rowH / 2 + 2);
      b.drawString(it.t, x + 18, yy + rowH / 2 - 1);
    }
    b.setColor(1);
    if (first > 0) b.fillPoly([x + w / 2 - 6, y - 4, x + w / 2 + 6, y - 4, x + w / 2, y - 10]);
    if (first + rows < items.length) {
      const yb = y + rows * rowH + 2;
      b.fillPoly([x + w / 2 - 6, yb, x + w / 2 + 6, yb, x + w / 2, yb + 6]);
    }
  }

  /** Word-wrapped text in a box. */
  function para(b, text, x, y, w, maxLines) {
    b.setFontMonofonto16().setFontAlign(-1, -1).setColor(3);
    b.wrapString(text, w).slice(0, maxLines || 99).forEach((l, i) => b.drawString(l, x, y + i * 18));
  }

  // ------------------------------------------------------------------ pages
  // Each page: build() -> data (called on open), draw(b, data) (called every frame), select(data)

  const P = {};

  // Layout units: Monofonto16 is 8x19 px per character, Monofonto18 9x21, Monofonto23 12x27.
  // The content buffer is 400x210; pages split it into columns with a 1 px divider.

  P.STATUS = {
    draw(b) {
      // Left column (0..224): a generic figure built from primitives, a condition bar per limb
      const cx = 112, w = Math.sin(frame / 6) * 2;
      b.setColor(3).fillCircle(cx, 40, 14).setColor(0).fillCircle(cx, 40, 11).setColor(3).fillCircle(cx, 40, 8);
      b.fillRect(cx - 14, 58, cx + 14, 110);
      b.fillPoly([cx - 14, 60, cx - 32, 100 + w, cx - 25, 104 + w, cx - 12, 72]);
      b.fillPoly([cx + 14, 60, cx + 32, 100 - w, cx + 25, 104 - w, cx + 12, 72]);
      b.fillRect(cx - 13, 112, cx - 3, 165).fillRect(cx + 3, 112, cx + 13, 165);
      const limbs = [["HEAD", 6, 14, 1], ["TORSO", 166, 44, 0.95], ["L.ARM", 6, 84, 0.9], ["R.ARM", 166, 100, 0.55], ["L.LEG", 6, 146, 1], ["R.LEG", 166, 146, 0.8]];
      b.setFontMonofonto16().setFontAlign(-1, -1);
      limbs.forEach((l) => { b.setColor(2).drawString(l[0], l[1], l[2]); bar(b, l[1], l[2] + 20, 46, 7, l[3]); });
      b.setColor(1).drawLine(228, 6, 228, 202);
      // Right column (236..396): radiation gauge, level, implant
      const gx = 316, gy = 64, r = 48, rads = 0.32 + Math.sin(frame / 9) * 0.04;
      for (let a = 0; a <= 10; a++) {
        const t = Math.PI * (1 + a / 10), r1 = a % 5 ? r - 6 : r - 12;
        b.drawLine(gx + Math.cos(t) * r1, gy + Math.sin(t) * r1, gx + Math.cos(t) * r, gy + Math.sin(t) * r);
      }
      b.drawCircle(gx, gy, 4);
      const n = Math.PI * (1 + rads);
      b.setColor(3).drawLine(gx, gy, gx + Math.cos(n) * (r - 8), gy + Math.sin(n) * (r - 8));
      b.setFontMonofonto18().setFontAlign(0, -1).drawString("RAD " + Math.round(rads * 1000), gx, gy + 8);
      b.setFontMonofonto16().setColor(2).setFontAlign(-1, -1).drawString("LVL 33", 240, 102);
      b.setFontAlign(1, -1).drawString("7742/8150", 396, 102);
      bar(b, 240, 124, 156, 8, 0.95, 10);
      b.setFontAlign(0, -1).setColor(2).drawString("IMPLANT", gx, 142);
      b.setColor(3).drawString("CONTROL CHIP", gx, 160);
      b.setColor(frame & 8 ? 3 : 1).drawString("SIGNAL LOST", gx, 180);
    },
  };

  P["S.P.E.C.I.A.L."] = {
    build: () => [
      ["Strength", 6, "Raw physical power. Swinging a crowbar through a jar is easier with more of it."],
      ["Perception", 8, "Awareness. Spots a sniper on a ridge before he spots you."],
      ["Endurance", 7, "Stamina. A vault dweller who survives the Legion's crosses has plenty."],
      ["Charisma", 9, "Being liked. The Golden Rule only works if people believe you mean it."],
      ["Intelligence", 7, "Book learning. Enough to rewire a control chip, not enough to want to."],
      ["Agility", 6, "Speed and reflexes. Useful on the Strip after midnight."],
      ["Luck", 5, "Fortune. The house always wins, unless you own the house."],
    ],
    draw(b, d) {
      list(b, d.map((s) => ({ t: s[0] })), 4, 14, 190, 7, 27);
      const s = d[sel];
      b.setColor(1).drawLine(204, 6, 204, 200);
      b.setFontMonofonto96().setFontAlign(0, -1).setColor(3).drawString(s[1], 300, 0);
      for (let i = 0; i < 10; i++) b.setColor(i < s[1] ? 3 : 1).fillRect(224 + i * 16, 98, 236 + i * 16, 106);
      para(b, s[2], 216, 118, 176, 5);
    },
  };

  P.FACTIONS = {
    build: () => [
      ["NCR", 70, "Holding the line at Camp McCarran. Their rangers remember who helped at the last holdout."],
      ["Caesar's Legion", -80, "Their leader is dead and his legate claims the name. They march on New Vegas."],
      ["The Strip", 35, "Mr. House runs the Lucky 38 from a screen now, and he still collects every debt."],
      ["Brotherhood", 10, "Chapters at war with each other. Area 51 is their new fortress."],
      ["Enclave", -60, "Control chips, a Phase 2, and a trail that leads to Colorado."],
      ["Great Khans", -20, "Raiders who trade with anyone. Including people they shouldn't."],
      ["Freeside", 50, "Outside the Strip's walls. Ma June keeps the lights on."],
    ],
    draw(b, d) {
      const word = (v) => v > 60 ? "IDOLIZED" : v > 30 ? "LIKED" : v > -10 ? "NEUTRAL" : v > -50 ? "DISLIKED" : "VILIFIED";
      b.setFontMonofonto18();
      for (let i = 0; i < d.length; i++) {
        const y = 4 + i * 22, on = i == sel;
        b.setColor(on ? 3 : 1).setFontAlign(-1, -1).drawString((on ? "> " : "  ") + d[i][0], 4, y);
        b.setFontAlign(1, -1).drawString(word(d[i][1]), 290, y);
        const x0 = 300, w = 90, mid = x0 + w / 2;
        b.setColor(1).drawRect(x0, y + 5, x0 + w, y + 14).drawLine(mid, y + 2, mid, y + 17);
        const v = (d[i][1] / 100) * (w / 2);
        b.setColor(on ? 3 : 2).fillRect(Math.min(mid, mid + v), y + 7, Math.max(mid, mid + v), y + 12);
      }
      b.setColor(1).drawLine(0, 160, 399, 160);
      para(b, d[sel][2], 6, 166, 388, 2);
    },
  };

  /** Inventory pages share one layout: list on the left, stats on the right. */
  function inventory(items, cols) {
    return {
      build: () => items,
      draw(b, d) {
        list(b, d.map((it) => ({ t: it[0], mark: it[4] })), 4, 14, 210, 6, 27);
        const it = d[sel];
        b.setColor(1).drawLine(222, 6, 222, 200);
        b.setFontMonofonto18().setFontAlign(-1, -1);
        cols.forEach((c, i) => {
          const y = 8 + i * 26;
          b.setColor(1).drawRect(232, y, 392, y + 22).setColor(2).drawString(c, 238, y + 2);
          b.setColor(3).setFontAlign(1, -1).drawString(it[1 + i], 386, y + 2).setFontAlign(-1, -1);
        });
        para(b, it[5], 232, 92, 160, 6);
        b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString("CAPS 2077    WG 61/210", 6, 188);
      },
      select(d) {
        d[sel][4] = !d[sel][4];
        sound(d[sel][4] ? "OK" : "CANCEL");
      },
    };
  }

  P.WEAPONS = inventory([
    ["Crowbar", "12", "6", "8", false, "Heavy, simple, reliable. The tool for the end of a long road."],
    ["Varmint Rifle", "18", "7", "75", true, "A small-bore rifle every Mojave settler owns at some point."],
    ["Service Rifle", "22", "9", "100", false, "NCR standard issue, still being handed out at the front."],
    ["Plasma Pistol", "30", "3", "425", false, "Pre-war energy weapon. Leaves the target glowing green."],
    ["10mm Pistol", "15", "3", "50", false, "The wasteland's most common sidearm."],
    ["Machete", "10", "1", "15", false, "Legion favourite. Better in your hands than theirs."],
  ], ["DAM", "WG", "VAL"]);

  P.APPAREL = inventory([
    ["Vault 33 Jumpsuit", "3", "1", "8", true, "Blue and gold, a little dustier than when it left the vault."],
    ["Ranger Combat Armor", "22", "30", "1200", false, "Black coat, night-vision helmet. Earned in the Mojave."],
    ["Overseer's Pip-Boy", "0", "1", "750", false, "Gold-finished. Its owner had more secrets than its memory."],
    ["Duster", "8", "5", "40", false, "Keeps the sand and the sun off."],
    ["Desert Ranger Helmet", "6", "3", "350", false, "Glowing red eyes for a reason."],
  ], ["DT", "WG", "VAL"]);

  P.AID = inventory([
    ["Stimpak", "+30HP", "0", "75", false, "Heals as fast as it hurts."],
    ["RadAway", "-150RAD", "0", "40", false, "Flushes the rads. Tastes like it."],
    ["Nuka-Cola", "+20HP", "1", "20", false, "Warm, flat, and two hundred years old. Still good."],
    ["Cram", "+10HP", "1", "5", false, "Canned meat of uncertain origin."],
    ["Mojave Water", "+15HP", "1", "20", false, "Clean, mostly. Worth more than caps out here."],
  ], ["EFF", "WG", "VAL"]);

  P.MISC = inventory([
    ["Cold Fusion Diode", "-", "2", "???", false, "Powers a man who refuses to die. Everyone wants it."],
    ["Control Chip", "-", "0", "500", false, "Fits behind the ear. Makes people agreeable. Destroy it."],
    ["Water Chip", "-", "1", "0", false, "Broken. Vault 33 needs a new one."],
    ["Liberty Prime Plans", "-", "1", "???", false, "Blueprints for something very large and very patriotic."],
    ["Lucky 38 Chip", "-", "0", "100", false, "A casino token from the tallest tower on the Strip."],
    ["Bottle Caps", "-", "0", "2077", false, "Currency of the wasteland."],
  ], ["DAM", "WG", "VAL"]);

  P.QUESTS = {
    build: () => [
      ["The Innovator", "Search Vault 24", "Find out what the chip experiments were for", true],
      ["The Golden Rule", "Reach the Mojave", "Survive Shady Sands' second ending", true],
      ["The Profligate", "Escape the Legion", "Get Lucy off the cross", true],
      ["The Demon in the Snow", "Stop the Brotherhood civil war", "Report to the Commonwealth envoy", true],
      ["The Wrangler", "Find Hank MacLean", "Don't walk into his trap", true],
      ["The Other Player", "Learn Barb's part in the plan", "Find where the chips are made", true],
      ["The Handoff", "Sabotage the chip network", "Attend the Vault 32 wedding", true],
      ["The Strip", "Reach the Lucky 38", "Follow the trail to Colorado", false],
    ],
    draw(b, d) {
      list(b, d.map((q) => ({ t: q[0], mark: !q[3] })), 4, 12, 220, 7, 26); // leaves room for the scroll arrow
      const q = d[sel];
      b.setColor(1).drawLine(232, 6, 232, 200);
      b.setFontMonofonto16().setFontAlign(-1, -1);
      [q[1], q[2]].forEach((o, i) => {
        const y = 14 + i * 60;
        b.setColor(3).drawRect(242, y + 2, 252, y + 12);
        if (q[3] || i == 0 && sel < 7) b.drawLine(243, y + 7, 247, y + 11).drawLine(247, y + 11, 252, y + 1);
        b.setColor(q[3] ? 2 : 3);
        b.wrapString(o, 136).slice(0, 3).forEach((l, j) => b.drawString(l, 258, y + j * 18));
      });
      b.setColor(2).drawString(q[3] ? "COMPLETED" : "ACTIVE", 242, 180);
    },
  };

  P.UPLINK = {
    build: () => ({
      lines: [
        "LUCKY 38 // REMOTE TERMINAL",
        "CONNECTION ESTABLISHED.",
        "",
        "> H: You are carrying property",
        "  of the Lucky 38.",
        "> H: The diode. Return it, and",
        "  the Strip remains open to you.",
        "> H: Everyone works for me",
        "  eventually. Even the Legion.",
        "",
        "> SIGNAL DEGRADING...",
      ],
      t: 0,
    }),
    draw(b, d) {
      d.t = Math.min(d.t + 3, 999);
      let left = d.t;
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(3);
      for (let i = 0; i < d.lines.length && left > 0; i++) {
        const l = d.lines[i].substr(0, left);
        b.drawString(l, 8, 4 + i * 17);
        left -= d.lines[i].length + 1;
        if (left <= 0 && frame & 4) b.fillRect(8 + b.stringWidth(l), 6 + i * 17, 16 + b.stringWidth(l), 18 + i * 17);
      }
      // voice level meter
      for (let i = 0; i < 24; i++) {
        const h = 4 + Math.abs(Math.sin(frame / 2 + i * 0.7) * Math.sin(frame / 5 + i)) * 26;
        b.setColor(i & 1 ? 2 : 3).fillRect(330 + (i % 6) * 10, 40 + Math.floor(i / 6) * 40 - h / 2 + 14, 336 + (i % 6) * 10, 40 + Math.floor(i / 6) * 40 + h / 2 + 14);
      }
    },
    select(d) { d.t = 0; sound("OK"); },
  };

  // ---- Pip-OS 1.33 screens, from the same SD card files as the stock firmware

  /** A message in the middle of the content area. */
  function notice(b, title, lines) {
    b.setFontMonofonto18().setFontAlign(0, 0).setColor(3).drawString(title, 200, 80);
    b.setFontMonofonto16().setColor(2);
    (lines || []).forEach((l, i) => b.drawString(l, 200, 110 + i * 20));
  }
  const MAKE = ["MAKE THEM WITH THE PIP-BOY COMPANION", "(ID, LISTS & FEEDS) OR PIP-BOY TOOLS"];

  // DATA > FEEDS: the videos and pictures in DATA/ (and USER/USERIMG.img); the wheel flips through
  P.FEEDS = {
    video: true,
    build: () => ({ list: feeds(), i: 0, still: false }),
    start(d) { showFeed(d); },
    onKnob(dir, d) {
      if (!d.list.length) return;
      d.i = (d.i + d.list.length - dir) % d.list.length;
      sound("ROT_V_1");
      showFeed(d);
    },
    draw(b, d) { notice(b, d.list.length ? "TUNING FEED..." : "NO FEEDS ON SD CARD"); },
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

  // INV > ID: the ID card over the whole screen, as on the stock firmware
  P.ID = {
    build: () => ({ card: hasIdCard(), still: false }),
    start(d) {
      if (!d.card) return;
      stillTimer = setTimeout(() => {
        stillTimer = undefined;
        g.clear();
        try { blitRaw(bC, ID_CARD, 400, 300, 40, 10); d.still = covered = true; } catch (e) { print("ERROR:", e.message); }
      }, 200);
    },
    draw(b) { notice(b, "NO ID CARD ON SD CARD", MAKE); },
  };

  // DATA > LISTS: the wheel picks, pressing it opens a list or ticks an item off
  P.LISTS = {
    build: () => ({ lists: readLists(), open: -1 }),
    rows(d) {
      if (!d.lists) return [];
      if (d.open < 0) return d.lists.categories.map((c) => [c.name || "UNTITLED", c.items.filter((i) => i.done).length + "/" + c.items.length]);
      return [["< BACK", ""]].concat(d.lists.categories[d.open].items.map((i) => [i.text || "", i.done ? 1 : 0]));
    },
    draw(b, d) {
      const rows = this.rows(d);
      if (!rows.length) return notice(b, d.lists ? "NO LISTS" : "NO LISTS ON SD CARD", MAKE);
      let top = 6;
      if (d.open >= 0) {
        b.setFontMonofonto18().setFontAlign(-1, -1).setColor(3).drawString(d.lists.categories[d.open].name.toUpperCase(), 10, 4);
        b.setColor(1).drawLine(0, 28, 399, 28);
        top = 34;
      }
      const R = d.open < 0 ? 7 : 6, H = 28, first = E.clip(sel - (R >> 1), 0, Math.max(0, rows.length - R));
      b.setFontMonofonto18();
      for (let k = 0; k < R && first + k < rows.length; k++) {
        const i = first + k, y = top + k * H, row = rows[i], on = i == sel;
        if (on) b.setColor(2).fillRect(0, y, 399, y + H - 3);
        const fg = on ? 0 : 3;
        let x = 10;
        if (d.open >= 0 && i > 0) {
          b.setColor(fg).drawRect(x, y + 6, x + 12, y + 18);
          if (row[1]) b.fillRect(x + 3, y + 9, x + 9, y + 15);
          x += 22;
        }
        b.setColor(fg).setFontAlign(-1, 0).drawString(row[0], x, y + H / 2 - 1);
        if (d.open < 0) b.setFontAlign(1, 0).drawString(row[1], 390, y + H / 2 - 1);
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
      sound("OK");
    },
  };

  // The Pip-Boy has one SD stream for audio and video: Pip.audioStart() closes a playing video,
  // so a video starts a moment after the page-change sound, and no UI sounds play while it runs.
  // `loop` plays on after `file` (FEEDS' X_LOOP.avi) via 2v29's videoStopped event.
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

  P.CLOCK = {
    draw(b) {
      const d = new Date(), two = (n) => ("0" + n).substr(-2);
      // Hours and minutes either side of a fixed, blinking colon, so nothing shifts
      b.setFontMonofonto96().setColor(3).setFontAlign(1, -1).drawString(two(d.getHours()), 184, 20);
      b.setFontAlign(-1, -1).drawString(two(d.getMinutes()), 216, 20);
      b.setColor(d.getSeconds() & 1 ? 3 : 1).fillRect(195, 52, 205, 62).fillRect(195, 86, 205, 96);
      b.setFontMonofonto23().setFontAlign(0, -1).setColor(2).drawString(d.getFullYear() + "." + two(d.getMonth() + 1) + "." + two(d.getDate()) + "  MOJAVE", 200, 130);
      bar(b, 60, 172, 280, 10, d.getSeconds() / 59, 12);
      corners(b, 20, 10, 380, 200, 16);
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
      list(b, d.map((o) => ({ t: o.t })), 4, 14, 230, 4, 30);
      b.setFontMonofonto18().setFontAlign(1, 0).setColor(3);
      d.forEach((o, i) => b.drawString(o.v(), 392, 14 + i * 30 + 14));
      const m = process.memory(false);
      b.setColor(1).drawLine(0, 140, 399, 140);
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2);
      b.drawString("MOJAVE UI 1.0   FIRMWARE " + process.env.VERSION, 8, 150);
      b.drawString("MEMORY " + m.usage + "/" + m.total + " BLOCKS   STORAGE " + Math.round(require("Storage").getFree() / 1024) + "KB FREE", 8, 170);
    },
    select(d) { d[sel].go(); save(); sound("OK"); },
  };

  // Mojave landmarks on a schematic map (x, y in the 400x210 content area, kind)
  P.MOJAVE = {
    build: () => [
      ["New Vegas Strip", 214, 74, 2, "Mr. House's city. Neon, casinos, and the Lucky 38 above it all."],
      ["Freeside", 192, 92, 0, "The old town outside the Strip gate."],
      ["Camp McCarran", 240, 52, 1, "NCR headquarters in the Mojave, in an old airport."],
      ["Hoover Dam", 330, 118, 1, "Power for the whole valley. Whoever holds it holds Vegas."],
      ["Fortification Hill", 352, 96, 3, "Legion camp across the river."],
      ["Goodsprings", 120, 132, 0, "A quiet town with a good saloon."],
      ["Primm", 136, 186, 0, "Roller coaster, casino, and a sheriff problem."],
      ["Novac", 226, 168, 0, "Motel with a giant dinosaur out front."],
      ["Red Rock Canyon", 120, 70, 3, "Great Khans territory."],
      ["Area 51", 140, 16, 1, "The Brotherhood's new fortress, far to the north."],
      ["Black Mountain", 160, 112, 3, "Radio tower and super mutants."],
    ],
    draw(b, d) {
      // The map uses the top 142 px; the description panel the rest. Landmarks are listed in
      // a 400x210 space and squashed vertically into the map area.
      const Y = (y) => 6 + y * 0.64;
      b.setColor(1);
      for (let x = 0; x < 400; x += 50) for (let y = 0; y < 142; y += 6) b.setPixel(x, y); // grid
      // Colorado River and Lake Mead
      b.drawPoly([300, 0, 318, 40, 340, 70, 346, 100, 336, 118, 344, 150, 336, 190, 346, 210].map((v, i) => i & 1 ? Y(v) : v), false);
      b.drawPoly([346, Y(100), 372, Y(86), 398, Y(92)], false);
      for (let i = 0; i < 30; i++) { // roads: I-15 and US-93
        const t = i / 30;
        b.setPixel(110 + 120 * t, Y(205 - 150 * t)).setPixel(214 + 116 * t, Y(74 + 44 * t));
      }
      d.forEach((m, i) => {
        const on = i == sel, x = m[1], y = Y(m[2]);
        b.setColor(on && frame & 4 ? 3 : 2);
        if (m[3] == 2) b.fillPoly([x, y - 7, x + 7, y, x, y + 7, x - 7, y]); // city
        else if (m[3] == 1) b.fillRect(x - 4, y - 4, x + 4, y + 4);         // stronghold
        else if (m[3] == 3) b.fillPoly([x, y - 5, x + 5, y + 4, x - 5, y + 4]); // danger
        else b.fillCircle(x, y, 3);                                          // town
        if (on) b.setColor(3).drawCircle(x, y, 10);
      });
      const m = d[sel];
      b.setColor(1).drawLine(0, 146, 399, 146);
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString(m[0].toUpperCase(), 6, 149);
      b.setColor(2);
      b.wrapString(m[4], 388).slice(0, 2).forEach((l, i) => b.drawString(l, 6, 168 + i * 18));
    },
  };

  // RADIO: the FM dial, your presets from the companion (real FM stations), then the
  // Mojave's own stations (clips from the SD card's RADIO folder).
  P.STATIONS = {
    build: () => (X ? [{ t: "FM DIAL", dial: 1 }].concat(X.presets().map((s) => ({ t: s.f.toFixed(1) + " " + s.name, f: s.f }))) : [])
      .concat(["Radio New Vegas", "Mojave Music Radio", "Black Mountain Radio", "NCR Emergency Radio", "Enclave Broadcast"].map((t) => ({ t }))),
    draw(b, d) {
      list(b, d.map((s, i) => ({ t: s.t.length > 22 ? s.t.slice(0, 21) + "." : s.t, mark: playing() && i == station })), 4, 14, 220, 5, 30);
      b.setColor(1).drawLine(232, 6, 232, 200);
      // oscilloscope
      const cx = 316, cy = 80;
      b.setColor(1).drawRect(244, 20, 388, 140);
      for (let x = 244; x <= 388; x += 24) b.drawLine(x, 136, x, 140);
      let py = cy;
      b.setColor(3);
      const fm = X && X.fm.on && X.fm, amp = fm ? 4 + fm.signal() * 36 : radioOn ? 40 : 3;
      for (let x = 0; x < 144; x += 2) {
        const y = cy + Math.sin(x / 9 + frame) * Math.sin(x / 31 + frame / 3) * amp * Math.random();
        b.drawLine(244 + x - 2, py, 244 + x, y);
        py = y;
      }
      const on = playing(), s = d[station] || d[0];
      b.setFontMonofonto16().setFontAlign(0, -1).setColor(on ? 3 : 1).drawString(fm ? "FM " + fm.freq.toFixed(1) + " MHZ" : on ? "PLAYING" : "PRESS PLAY / SELECT", cx, 150);
      b.setColor(2).drawString(!on ? "" : s.dial ? "THUMBWHEEL: TUNE" : s.f ? s.t.slice(s.t.indexOf(" ") + 1) : s.t.toUpperCase(), cx, 170);
    },
    select(d) {
      if (playing() && station == sel) stopRadio();
      else { station = sel; play(d); }
    },
    play(d) { if (playing()) stopRadio(); else { station = sel; play(d); } },
    onKnob2(dir, d) {
      // On the FM dial the thumbwheel tunes in 0.1 MHz steps; elsewhere it steps through the stations
      if (X && X.fm.on && d[station].dial && station == sel) { X.fm.tune(X.fm.freq + dir / 10); return; }
      sel = (sel + d.length + dir) % d.length;
      if (playing()) { station = sel; play(d); }
      sound(dir > 0 ? "NEXT" : "PREV");
    },
  };

  const playing = () => radioOn || (X && X.fm.on);
  function stopRadio() { radio(false); if (X) X.fm.enable(false); }
  /** Play station `station` of the list `d`: FM (the dial or a preset) or Mojave clips. */
  function play(d) {
    const s = d[station];
    if (s.dial || s.f) {
      if (radioOn) radio(false);
      if (s.f) X.fm.tune(s.f);
      if (!X.fm.on && !X.fm.enable(true)) print("ERROR: the FM radio didn't answer");
    } else { stopRadio(); radio(true); }
  }

  /** Play a random clip from the SD card's RADIO folder, as the stock radio does. */
  function radio(on) {
    radioOn = on;
    try {
      if (on) {
        const files = require("fs").readdirSync("RADIO").filter((f) => f.toUpperCase().endsWith(".WAV"));
        if (files.length) Pip.audioStart("RADIO/" + files[(Math.random() * files.length) | 0]);
      } else Pip.audioStop();
    } catch (e) {}
  }

  // ------------------------------------------------------------------ header & footer

  function drawHeader() {
    bH.clear().setColor(3).setFontMonofonto23().setFontAlign(-1, -1);
    let x = 10;
    TABS.forEach((t, i) => {
      const w = bH.stringWidth(t);
      if (i == tab) {
        bH.drawLine(0, 30, x - 6, 30).drawLine(x - 6, 30, x - 6, 4).drawLine(x - 6, 4, x - 2, 4);
        bH.drawLine(x + w + 2, 4, x + w + 6, 4).drawLine(x + w + 6, 4, x + w + 6, 30).drawLine(x + w + 6, 30, 371, 30);
      }
      bH.setColor(i == tab ? 3 : 1).drawString(t, x, 5).setColor(3);
      x += w + 26;
    });
    if (tab < 0) bH.drawLine(0, 30, 371, 30);
    // Sub-pages: when they don't fit (DATA), the row scrolls to keep the current one in view
    bH.setFontMonofonto16();
    const names = PAGES[tab] || [], xs = [];
    x = 0;
    names.forEach((p) => { xs.push(x); x += bH.stringWidth(p) + 14; });
    const room = 344, total = x - 14, off = total > room && names.length ? E.clip(xs[page] + bH.stringWidth(names[page]) / 2 - room / 2, 0, total - room) : 0;
    names.forEach((p, i) => bH.setColor(i == page ? 3 : 1).drawString(p, 14 + xs[i] - off, 34));
    bH.setColor(0).fillRect(0, 32, 11, 50).fillRect(360, 32, 371, 50).setColor(1);
    if (off > 0) bH.fillPoly([9, 36, 9, 48, 3, 42]);
    if (off < total - room) bH.fillPoly([362, 36, 362, 48, 368, 42]);
    showH();
  }

  function drawFooter() {
    const d = new Date(), two = (n) => ("0" + n).substr(-2);
    let bat = 1;
    try { bat = E.clip((analogRead(VBAT_MEAS) * 2 * E.getAnalogVRef() - 3.5) / 0.6, 0, 1); } catch (e) {}
    if (VUSB_PRESENT.read()) bat = 1;
    const m = process.memory(false);
    bF.clear().setColor(1).fillRect(0, 0, 371, 24).setColor(0);
    // Three boxes: HP (2..106), date and time (110..261, 16 characters = 128 px), AP (265..369)
    bF.fillRect(2, 2, 106, 22).fillRect(110, 2, 261, 22).fillRect(265, 2, 369, 22);
    bF.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString("HP", 8, 4).drawString("AP", 271, 4);
    bar(bF, 30, 6, 70, 12, bat, 7);
    bar(bF, 295, 6, 68, 12, 1 - m.usage / m.total, 7);
    bF.setFontAlign(0, -1).setColor(3).drawString(d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()) + " " + two(d.getHours()) + ":" + two(d.getMinutes()), 186, 4); // centre of the middle box
    showF();
  }

  // ------------------------------------------------------------------ navigation

  function openPage() {
    stopVideo();
    sel = 0;
    pageData = null;
    const p = P[PAGES[tab][page]];
    if (p.build) pageData = p.build();
    if (covered) { covered = false; g.clear(); drawFooter(); }
    g.setBgColor(0).clearRect(36, 37, 444, 288);
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
    const p = P[PAGES[tab][page]];
    if (p.onKnob) return p.onKnob(dir, pageData);
    const n = Array.isArray(pageData) ? pageData.length : 0;
    if (!n) return;
    const before = sel;
    sel = E.clip(sel - dir, 0, n - 1);
    if (sel != before) sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
  }

  function onKnob2(dir) {
    if (torch || tab < 0 || popup) return;
    const n = PAGES[tab].length, p = P[PAGES[tab][page]];
    if (n < 2 || p.ownsKnob2) { // single-page tabs (RADIO tunes with it) and REMOTE use it themselves
      if (p.onKnob2) p.onKnob2(dir, pageData);
      return;
    }
    page = (page + n + dir) % n;
    openPage();
    sound(dir > 0 ? "NEXT" : "PREV");
  }

  function onSelect() {
    if (torch || tab < 0) return;
    if (popup) { popup = null; sound("OK"); openPage(); return; }
    const p = P[PAGES[tab][page]];
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
    // Mode dial: five positions decoded from its voltage, as the stock firmware does
    // (between positions: settings.fallbackMode, as Pip-OS 1.32+; 0 = stay put)
    const m = modeFor(MODE_SELECTOR.analog(), fallback);
    if (m == modePrev && m >= 0) setTab(m);
    modePrev = m;
    if (torch || tab < 0) return;
    frame++;
    const p = P[PAGES[tab][page]];
    if ((pageData && pageData.still) || (p.video && video)) return; // a picture or video is showing
    bC.clear().setFontMonofonto16().setFontAlign(-1, -1).setColor(3); // the same start state every frame
    try {
      P[PAGES[tab][page]].draw(bC, pageData);
      if (popup) drawPopup(bC);
    } catch (e) {
      bC.setColor(3).setFontMonofonto16().setFontAlign(-1, -1).drawString("ERROR: " + e.message, 8, 8);
      if (e.message != lastError) print("ERROR:", e.message);
      lastError = e.message;
    }
    showC();
    if (frame % 150 == 0 && !covered) drawFooter();
  }

  // A message from the companion (it calls companionMessage over USB when this app is running)
  function drawPopup(b) {
    b.setColor(0).fillRect(24, 22, 376, 190).setColor(3).drawRect(24, 22, 376, 190).drawRect(27, 25, 373, 187);
    b.setFontMonofonto18().setFontAlign(0, -1).drawString("INCOMING MESSAGE", 200, 32);
    b.setColor(1).drawLine(40, 56, 360, 56).setColor(3);
    popup.lines.forEach((l, i) => b.drawString(l, 200, 64 + i * 21));
    b.setFontMonofonto16().setColor(frame & 8 ? 3 : 2).drawString("PRESS THE WHEEL", 200, 166);
  }
  global.companionMessage = (text) => {
    popup = { lines: bC.setFontMonofonto18().wrapString(String(text), 340).slice(0, 5) };
    stopVideo();
    if (pageData) pageData.still = false;
    if (covered) { covered = false; g.clear(); drawHeader(); drawFooter(); }
    sound("ALERT");
  };

  function boot(done) {
    const lines = ["PIP-BOY 3000 MK V", "MOJAVE INTERFACE 1.0", "", "LOADING MOJAVE DATA...", "NCR / LEGION / STRIP: OK", "UPLINK: LUCKY 38", "", "WELCOME BACK, COURIER."];
    let i = 0;
    g.clear().setFontMonofonto18().setFontAlign(-1, -1).setColor(g.theme.fg);
    const t = setInterval(() => {
      if (i < lines.length) { g.drawString(lines[i], 70, 60 + i * 24); sound("UP1"); i++; }
      else { clearInterval(t); g.clear(); done(); }
    }, 180);
  }

  // Back to the stock interface. load() restarts the interpreter with the firmware's boot code
  // without a hardware reset, so an app set to open at power-on (.bootPowerOn) doesn't come back.
  function exitToStock() { load(); }

  // ------------------------------------------------------------------ start

  clearWatch();
  clearInterval();
  // The stock firmware keeps the time zone in the SD card's settings.json
  try { E.setTimeZone(JSON.parse(require("fs").readFile("settings.json")).timezone || 0); } catch (e) {}
  // The companion extras from the SD card (see extras.js): their pages join the tabs
  let X = null;
  try {
    (0, eval)(require("fs").readFile("USER/MOJAVE.EXT")); // sets global.companionExtras
    X = global.companionExtras({ bC, list, notice, corners, sound, sel: () => sel, setSel: (n) => { sel = n; }, frame: () => frame });
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
  // Encoder direction comes from the other line's level when A rises (as Pip.addWatches)
  setWatch((e) => onKnob1(e.state ^ e.data ? -1 : 1), KNOB1_A, { data: KNOB1_B, edge: 1, repeat: true, debounce: 0 });
  setWatch((e) => onKnob2(e.state ^ e.data ? 1 : -1), KNOB2_B, { data: KNOB2_A, edge: 1, repeat: true, debounce: 0 });
  setWatch(onSelect, KNOB1_BTN, { edge: "rising", repeat: true, debounce: 20 });
  // PLAY: the radio on RADIO (and mute on REMOTE)
  setWatch(() => { const p = tab >= 0 && !torch && !popup && P[PAGES[tab][page]]; if (p && p.play) p.play(pageData); }, BTN_PLAY, { edge: "rising", repeat: true, debounce: 50 });
  setWatch(() => setTorch(!torch), BTN_TORCH, { edge: "rising", repeat: true, debounce: 50 });
  setWatch(() => { stopRadio(); stopVideo(); exitToStock(); }, BTN_POWER, { edge: "rising", repeat: true, debounce: 50 });

  boot(() => {
    drawHeader();
    drawFooter();
    setInterval(tick, 100);
  });
})();
