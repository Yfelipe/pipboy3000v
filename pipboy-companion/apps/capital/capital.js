// CAPITAL — an alternative Pip-Boy 3000 Mk V interface styled after Fallout 3's Pip-Boy 3000:
// green phosphor, the Capital Wasteland map, skills, the main quest line and the D.C. radio
// stations. Original artwork drawn with Graphics primitives.
//
// The look is the Fallout 3 Pip-Boy 3000's: the section's name in a box at the top left with
// the top line running out of it and the readouts (level, HP, AP, time) hanging on that line;
// the sub-pages along the bottom line with the current one boxed; a list's current row in an
// outlined box with its value at the right; an item's figures in bordered cells along the
// bottom; and Vault Boy in the middle of the status screen with CND / RAD / EFF down the left.
// The wheels, dial, video, settings and companion extras work as in Mojave UI (../mojave/mojave.js),
// which this file's plumbing was taken from.
//
// Install: write capital.min.js (./build.sh) to Storage under that name, then load("capital.min.js").
// sd/USER/CAPITAL.JS on the SD card adds it to the stock INV > APPS menu.
// It runs from flash and replaces the stock interface until the power button is pressed,
// which returns to the stock interface. Needs firmware 2v24 or later (Pip.blitImage);
// the Pip-OS 1.33 screens (INV > ID, DATA > FEEDS and LISTS, ../shared/pipos133.js) work on any.
// The companion's extras (../mojave/extras.js, read from sd/USER/CAPITAL.EXT so they cost no
// Storage): FM radio and presets in RADIO, INV > REMOTE, DATA > NOTES and INBOX. Messages from
// the companion pop up over whatever is showing.
//
// Controls (as on the stock firmware): mode dial = tabs, thumbwheel = sub-pages,
// wheel = scroll, wheel press = select, PLAY = radio on/off, torch = flashlight, power = exit.

import { run } from "../shared/engine.js";

run({
  settingsFile: "capital.json",
  extFile: "USER/CAPITAL.EXT",
  themes: [
    { name: "GREEN", rgb: [0.1, 1, 0.5] },       // Fallout 3's default Pip-Boy colour
    { name: "AMBER", rgb: [1, 0.71, 0.26] },     // its other three display colours
    { name: "BLUE", rgb: [0.18, 0.81, 1] },
    { name: "WHITE", rgb: [1, 1, 1] },
    { name: "PIP-BOY", rgb: [0.2, 1, 0.3], stock: true }, // the stock interface's own colour
  ],
  pages: [
    ["STATUS", "S.P.E.C.I.A.L.", "SKILLS"],
    ["WEAPONS", "APPAREL", "AID", "MISC", "ID"],
    ["QUESTS", "UPLINK", "FEEDS", "LISTS", "CLOCK", "SYSTEM"],
    ["WASTELAND"],
    ["STATIONS"],
  ],
  bootLines: ["PIP-BOY 3000 MK V", "CAPITAL INTERFACE 1.0", "", "LOADING WASTELAND DATA...", "VAULT 101 RECORD: OK", "SIGNAL: GALAXY NEWS RADIO", "", "WELCOME BACK, 101."],
  // Everything this app draws. k is the engine's kit (../shared/engine.js): its buffers and
  // helpers, and the values that change (k.sel, k.frame, k.tab, k.page, k.station, k.radioOn, k.X).
  build(k) {
    // (one by one: Espruino has no destructuring)
    const bC = k.bC, bH = k.bH, bF = k.bF, showC = k.showC, showH = k.showH, showF = k.showF, sound = k.sound, playVideo = k.playVideo, corners = k.corners, THEMES = k.THEMES, cfg = k.cfg, save = k.save, applyTheme = k.applyTheme, backlight = k.backlight, exitToStock = k.exitToStock, playing = k.playing, stopRadio = k.stopRadio, play = k.play, SHEET = k.SHEET, PAGES = k.PAGES, VBAT_MEAS = k.VBAT_MEAS, VUSB_PRESENT = k.VUSB_PRESENT;

    // ------------------------------------------------------------------ drawing helpers
    function bar(b, x, y, w, h, frac, ticks) {
      b.setColor(1).drawRect(x, y, x + w, y + h);
      b.setColor(3).fillRect(x + 2, y + 2, x + 2 + Math.round((w - 4) * E.clip(frac, 0, 1)), y + h - 2);
      if (ticks) for (let i = 1; i < ticks; i++) b.setColor(0).drawLine(x + (w * i) / ticks, y + 2, x + (w * i) / ticks, y + h - 2);
    }

    const TITLES = ["STATS", "ITEMS", "DATA", "MAP", "RADIO"];
    const DAYS = "SUN,MON,TUE,WED,THU,FRI,SAT".split(",");

    /**
     * A scrolling list as the Pip-Boy 3000 shows one: the current row in an outlined box, a square
     * beside a marked row, and an optional value at the right. items: [{t: label, mark, v: value}]
     */
    function list(b, items, x, y, w, rows, rowH) {
      const first = E.clip(k.sel - (rows >> 1), 0, Math.max(0, items.length - rows));
      b.setFontMonofonto18();
      for (let i = 0; i < rows && first + i < items.length; i++) {
        const it = items[first + i], yy = y + i * rowH, on = first + i == k.sel, mid = yy + rowH / 2 - 1;
        b.setColor(on ? 3 : 2);
        if (on) b.drawRect(x, yy, x + w, yy + rowH - 3);
        if (it.mark) b.fillRect(x + 5, mid - 4, x + 12, mid + 3);
        b.setFontAlign(-1, 0).drawString(it.t, x + 18, mid);
        if (it.v !== undefined) b.setFontAlign(1, 0).drawString(it.v, x + w - 6, mid);
      }
      b.setColor(2);
      if (first > 0) b.fillPoly([x + w - 14, y - 1, x + w - 2, y - 1, x + w - 8, y - 6]);
      if (first + rows < items.length) {
        const yb = y + rows * rowH;
        b.fillPoly([x + w - 14, yb, x + w - 2, yb, x + w - 8, yb + 5]);
      }
    }

    /** A row of bordered cells, each a label and a value, as along the bottom of the Pip-Boy 3000's screens. row: [[label, value, width]] */
    function cells(b, x, y, row) {
      b.setFontMonofonto16();
      row.forEach((c) => {
        b.setColor(1).drawRect(x, y, x + c[2], y + 22);
        b.setColor(2).setFontAlign(-1, -1).drawString(c[0], x + 5, y + 3);
        b.setColor(3).setFontAlign(1, -1).drawString(c[1], x + c[2] - 5, y + 3);
        x += c[2] + 4;
      });
      b.setFontAlign(-1, -1);
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

    // STAT > STATUS: Vault Boy in the middle of the screen, from the SD card's own STAT videos
    // (STAT/VB*.avi, the animations the stock interface plays there), with the wheel changing the
    // animation; CND / RAD / EFF down the left as on the Pip-Boy 3000. The video plays straight to
    // the screen, so the columns beside it are drawn once, before it starts. A card without those
    // videos gets a figure drawn from primitives, with a condition bar per limb.
    P.STATUS = {
      video: true,
      build() {
        let files = [];
        try { files = require("fs").readdirSync("STAT").filter((f) => f[0] != "." && /^VB.*\.AVI$/i.test(f)).sort(); } catch (e) {}
        return { files, i: 0 };
      },
      start(d) {
        if (!d.files.length) return;
        bC.clear().setFontMonofonto16().setFontAlign(-1, -1).setColor(3);
        this.side(bC, d);
        showC();
        playVideo("STAT/" + d.files[d.i], { x: 138, y: 66 });
      },
      onKnob(dir, d) {
        if (!d.files.length) return;
        d.i = (d.i + d.files.length - dir) % d.files.length;
        sound("ROT_V_1");
        this.start(d);
      },
      draw(b, d) {
        // No videos: a figure built from primitives in the middle, a condition bar per limb
        const cx = 200, w = Math.sin(k.frame / 6) * 2;
        b.setColor(3).fillCircle(cx, 40, 14).setColor(0).fillCircle(cx, 40, 11).setColor(3).fillCircle(cx, 40, 8);
        b.fillRect(cx - 14, 58, cx + 14, 110);
        b.fillPoly([cx - 14, 60, cx - 32, 100 + w, cx - 25, 104 + w, cx - 12, 72]);
        b.fillPoly([cx + 14, 60, cx + 32, 100 - w, cx + 25, 104 - w, cx + 12, 72]);
        b.fillRect(cx - 13, 112, cx - 3, 165).fillRect(cx + 3, 112, cx + 13, 165);
        b.setFontMonofonto16().setFontAlign(-1, -1);
        [["HEAD", 104, 14, 1], ["TORSO", 252, 44, 0.95], ["L.ARM", 104, 84, 0.9], ["R.ARM", 252, 100, 0.55], ["L.LEG", 104, 146, 1], ["R.LEG", 252, 146, 0.8]]
          .forEach((l) => { b.setColor(2).drawString(l[0], l[1], l[2]); bar(b, l[1], l[2] + 20, 46, 7, l[3]); });
        this.side(b, d);
      },
      side(b, d) {
        // the three buttons down the left: condition is the one showing
        b.setFontMonofonto18().setFontAlign(0, 0);
        ["CND", "RAD", "EFF"].forEach((t, i) => {
          const y = 44 + i * 36;
          b.setColor(i ? 1 : 3).drawRect(4, y, 62, y + 28);
          b.setColor(i ? 2 : 3).drawString(t, 33, y + 14);
        });
        // radiation and karma down the right
        b.setFontMonofonto16().setFontAlign(0, -1).setColor(2).drawString("RADS", 356, 30);
        b.setFontMonofonto23().setColor(3).drawString("320", 356, 48);
        b.setFontMonofonto16().setColor(2).drawString("KARMA", 356, 96);
        b.setColor(3).drawString("VERY GOOD", 356, 114);
        if (d.files.length) b.setColor(1).drawString((d.i + 1) + " OF " + d.files.length, 356, 168).drawString("WHEEL", 356, 186);
        b.setFontAlign(-1, -1);
      },
    };

    P["S.P.E.C.I.A.L."] = {
      build: () => [
        ["Strength", 5, "Raw physical power. Decides how much scrap you can haul out of a ruin."],
        ["Perception", 7, "Awareness. Puts a red mark on the compass before the raider sees you."],
        ["Endurance", 6, "Stamina. Nineteen years of vault air leaves room to improve."],
        ["Charisma", 4, "Being liked. Helps with Megaton's sheriff and Rivet City's council."],
        ["Intelligence", 8, "Book learning. The G.O.A.T. said so, and the G.O.A.T. is never wrong."],
        ["Agility", 6, "Speed and reflexes. More Action Points for V.A.T.S."],
        ["Luck", 4, "Fortune. You found the way out of Vault 101, so it can't be all bad."],
      ].map((r, i) => SHEET ? [r[0], E.clip(SHEET.special[i] | 0, 1, 10), r[2]] : r),
      draw(b, d) {
        list(b, d.map((s) => ({ t: s[0], v: s[1] })), 2, 6, 198, 7, 27);
        // the chosen attribute's card
        const s = d[k.sel];
        b.setColor(1).drawRect(210, 6, 397, 196);
        b.setColor(3).setFontMonofonto23().setFontAlign(-1, -1).drawString(s[0].toUpperCase(), 220, 12);
        for (let i = 0; i < 10; i++) {
          if (i < s[1]) b.setColor(3).fillRect(220 + i * 17, 46, 232 + i * 17, 58);
          else b.setColor(1).drawRect(220 + i * 17, 46, 232 + i * 17, 58);
        }
        para(b, s[2], 220, 70, 170, 6);
      },
    };

    P.SKILLS = {
      build: () => [
        ["Barter", 34, "Better prices from the caravans and from Moira."],
        ["Big Guns", 22, "Miniguns, missile launchers and the Fat Man."],
        ["Energy Weapons", 61, "Laser and plasma. The Enclave's favourites, and now yours."],
        ["Explosives", 45, "Grenades, mines, and disarming the bomb in Megaton."],
        ["Lockpick", 78, "Bobby pins and patience. Opens most of the Capital Wasteland."],
        ["Medicine", 52, "More health from every Stimpak."],
        ["Melee Weapons", 30, "Bats, sledgehammers and the Shishkebab."],
        ["Repair", 66, "Keeps a hunting rifle shooting straight."],
        ["Science", 80, "Terminals, turrets and robots do as they are told."],
        ["Small Guns", 88, "Pistols and rifles: what the wasteland runs on."],
        ["Sneak", 41, "Past the super mutants on the Mall, quietly."],
        ["Speech", 57, "Talks down a sheriff, a president and a computer."],
        ["Unarmed", 18, "Fists, and the Power Fist."],
      ],
      draw(b, d) {
        list(b, d.map((s) => ({ t: s[0], v: s[1] })), 2, 6, 198, 7, 27);
        const s = d[k.sel];
        b.setColor(1).drawRect(210, 6, 397, 196);
        b.setColor(3).setFontMonofonto18().setFontAlign(-1, -1).drawString(s[0].toUpperCase(), 220, 14);
        bar(b, 220, 44, 168, 12, s[1] / 100, 10);
        para(b, s[2], 220, 70, 170, 6);
      },
    };

    /** Inventory pages share one layout: the list, the description beside it, and the figures in cells along the bottom. */
    function inventory(items, cols) {
      return {
        build: () => items,
        draw(b, d) {
          list(b, d.map((it) => ({ t: it[0], mark: it[4] })), 2, 6, 216, 6, 27);
          const it = d[k.sel];
          para(b, it[5], 230, 10, 166, 6);
          cells(b, 230, 150, [[cols[0], it[1], 166]]);
          cells(b, 230, 176, [[cols[1], it[2], 74], [cols[2], it[3], 88]]);
          cells(b, 2, 176, [["Wg", "84/250", 108], ["Caps", "1277", 104]]);
        },
        select(d) {
          d[k.sel][4] = !d[k.sel][4];
          sound(d[k.sel][4] ? "OK" : "CANCEL");
        },
      };
    }

    P.WEAPONS = inventory([
      ["10mm Pistol", "9", "3", "225", true, "Standard issue for Vault 101 security. Yours now."],
      ["Hunting Rifle", "25", "6", "150", false, "Bolt action. Half the wasteland hunts with one, and not for food."],
      ["Chinese Assault Rifle", "11", "7", "500", false, "Left behind when the invasion of Anchorage failed."],
      ["Laser Rifle", "23", "8", "1000", false, "AER9. The Brotherhood keeps them working."],
      ["Combat Shotgun", "55", "7", "200", false, "Drum-fed. Settles an argument in a metro tunnel."],
      ["Fat Man", "1610", "30", "1000", false, "A catapult for mini nukes. Stand well back."],
      ["BB Gun", "4", "2", "36", false, "A tenth birthday present. Good against radroaches."],
    ], ["DAM", "WG", "VAL"]);

    P.APPAREL = inventory([
      ["Vault 101 Jumpsuit", "1", "1", "6", true, "Blue and gold, with the number on the back."],
      ["Leather Armor", "24", "15", "160", false, "Stitched from brahmin hide. A wastelander's first armor."],
      ["Combat Armor", "32", "25", "390", false, "Pre-war military plate. Talon Company wears it in black."],
      ["T-45d Power Armor", "40", "45", "740", false, "Brotherhood of Steel issue. Needs training to wear."],
      ["Tunnel Snakes Outfit", "4", "2", "8", false, "Leather jacket with a snake on the back. They rule."],
    ], ["DR", "WG", "VAL"]);

    P.AID = inventory([
      ["Stimpak", "+30HP", "0", "25", false, "Heals as fast as it hurts."],
      ["RadAway", "-50RAD", "0", "20", false, "Flushes the rads. Tastes like it."],
      ["Rad-X", "+25RES", "0", "20", false, "Take before wading into the Potomac."],
      ["Nuka-Cola", "+10HP", "1", "20", false, "Warm, flat, and two hundred years old. Keep the cap."],
      ["Purified Water", "+20HP", "1", "20", false, "No rads. The whole point of Project Purity."],
      ["Sugar Bombs", "+5HP", "1", "5", false, "Breakfast cereal with a faint glow."],
    ], ["EFF", "WG", "VAL"]);

    P.MISC = inventory([
      ["Bobby Pin", "-", "0", "1", false, "For locks. Try the lockpicking holotape."],
      ["G.E.C.K.", "-", "1", "???", false, "Garden of Eden Creation Kit. Project Purity needs it."],
      ["Sensor Module", "-", "2", "30", false, "Scrap. Someone at Rivet City will want it."],
      ["Pre-War Book", "-", "1", "1", false, "Scorched, but readable. The Arlington Library pays for these."],
      ["Bobblehead", "-", "1", "0", false, "Vault-Tec's nodding little collectible."],
      ["Bottle Caps", "-", "0", "1277", false, "Currency of the wasteland."],
    ], ["DAM", "WG", "VAL"]);

    P.QUESTS = {
      build: () => [
        ["Escape!", "Get out of Vault 101", "Find the door controls", true],
        ["Following in His Footsteps", "Ask about Dad in Megaton", "Head for Galaxy News Radio", true],
        ["Galaxy News Radio", "Help Three Dog get his signal back", "Fetch the dish from the Museum", true],
        ["Scientific Pursuits", "Find Doctor Li in Rivet City", "Search the Jefferson Memorial", true],
        ["Tranquility Lane", "Find Dad in Vault 112", "Get out of the simulation", true],
        ["The Waters of Life", "Help restart Project Purity", "Escape to the Citadel", true],
        ["The American Dream", "Bring the G.E.C.K. out of Vault 87", "Deal with the President", true],
        ["Take It Back!", "Follow Liberty Prime to the Memorial", "Start the purifier", false],
      ],
      draw(b, d) {
        list(b, d.map((q) => ({ t: q[0].length > 21 ? q[0].slice(0, 20) + "." : q[0], mark: !q[3] })), 2, 6, 226, 7, 27);
        const q = d[k.sel];
        b.setFontMonofonto16().setFontAlign(-1, -1);
        [q[1], q[2]].forEach((o, i) => {
          const y = 10 + i * 62, done = q[3] || (i == 0 && k.sel < 7);
          b.setColor(3).drawRect(240, y + 2, 250, y + 12);
          if (done) b.fillRect(243, y + 5, 247, y + 9);
          b.setColor(done ? 2 : 3);
          b.wrapString(o, 140).slice(0, 3).forEach((l, j) => b.drawString(l, 258, y + j * 18));
        });
        cells(b, 240, 176, [["", q[3] ? "COMPLETED" : "ACTIVE", 156]]);
      },
    };

    P.UPLINK = {
      build: () => ({
        lines: [
          "PROJECT PURITY // CONTROL ROOM",
          "CONNECTION ESTABLISHED.",
          "",
          "> J: Revelation 21:6.",
          "> J: I am Alpha and Omega,",
          "  the beginning and the end.",
          "> J: The code is your mother's",
          "  favourite verse. Remember it.",
          "",
          "> PURIFIER STATUS: STANDBY",
          "> AWAITING ACTIVATION CODE...",
        ],
        t: 0,
      }),
      draw(b, d) {
        d.t = Math.min(d.t + 3, 999);
        let left = d.t;
        b.setFontMonofonto16().setFontAlign(-1, -1).setColor(3);
        for (let i = 0; i < d.lines.length && left > 0; i++) {
          const l = d.lines[i].substr(0, left);
          b.drawString(l, 8, 4 + i * 15);
          left -= d.lines[i].length + 1;
          if (left <= 0 && k.frame & 4) b.fillRect(8 + b.stringWidth(l), 6 + i * 15, 16 + b.stringWidth(l), 18 + i * 15);
        }
        cells(b, 240, 176, [["PURIFIER", k.frame & 8 ? "STANDBY" : "", 156]]);
      },
      select(d) { d.t = 0; sound("OK"); },
    };

    P.CLOCK = {
      draw(b) {
        const d = new Date(), two = (n) => ("0" + n).substr(-2);
        // Hours and minutes either side of a fixed, blinking colon, so nothing shifts
        b.setFontMonofonto96().setColor(3).setFontAlign(1, -1).drawString(two(d.getHours()), 184, 20);
        b.setFontAlign(-1, -1).drawString(two(d.getMinutes()), 216, 20);
        b.setColor(d.getSeconds() & 1 ? 3 : 1).fillRect(195, 52, 205, 62).fillRect(195, 86, 205, 96);
        cells(b, 28, 136, [["DAY", DAYS[d.getDay()], 96], ["DATE", two(d.getDate()) + "." + two(d.getMonth() + 1) + "." + d.getFullYear(), 162], ["SEC", two(d.getSeconds()), 78]]);
        bar(b, 28, 172, 344, 10, d.getSeconds() / 59, 12);
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
        list(b, d.map((o) => ({ t: o.t, v: o.v() })), 2, 6, 395, 4, 30);
        const m = process.memory(false);
        cells(b, 2, 150, [["FIRMWARE", process.env.VERSION, 196], ["MEMORY", m.usage + "/" + m.total, 196]]);
        cells(b, 2, 176, [["STORAGE", Math.round(require("Storage").getFree() / 1024) + "KB FREE", 196], ["CAPITAL UI", "1.0", 196]]);
      },
      select(d) { d[k.sel].go(); save(); sound("OK"); },
    };

    // Capital Wasteland landmarks on a schematic map (x, y in the 400x210 content area, kind)
    P.WASTELAND = {
      build: () => [
        ["Megaton", 150, 124, 0, "A town built around an atom bomb that didn't go off. Yet."],
        ["Vault 101", 128, 108, 1, "Home for nineteen years. Nobody enters, nobody leaves."],
        ["Rivet City", 322, 168, 2, "A beached aircraft carrier, and the biggest settlement there is."],
        ["GNR Building", 296, 104, 1, "Galaxy News Radio. Three Dog, bringing you the truth."],
        ["Jefferson Memorial", 282, 150, 1, "Project Purity, in the rotunda by the Tidal Basin."],
        ["The Citadel", 250, 134, 1, "The Brotherhood of Steel, in what is left of the Pentagon."],
        ["Raven Rock", 44, 18, 3, "The Enclave's mountain. The President is expecting you."],
        ["Paradise Falls", 104, 40, 3, "A shopping mall run by slavers."],
        ["Arefu", 124, 72, 0, "A few houses on a broken overpass."],
        ["Tenpenny Tower", 92, 178, 0, "Luxury living for those the gate lets in."],
        ["Vault 112", 58, 150, 3, "Under a garage. Its residents never left their loungers."],
      ],
      draw(b, d) {
        // The world map: a framed chart over the top 144 px with the rivers drawn in, a square for
        // each place, and brackets and a label on the chosen one. Places are listed in a 400x210
        // space and squashed vertically into the frame.
        const Y = (y) => 4 + y * 0.66;
        b.setColor(1).drawRect(0, 0, 399, 144);
        b.setColor(2);
        b.drawPoly([150, 0, 170, 40, 200, 70, 230, 100, 250, 125, 270, 150, 300, 180, 330, 210].map((v, i) => i & 1 ? Y(v) : v), false); // the Potomac
        b.drawPoly([300, Y(180), 334, Y(160), 372, Y(130), 398, Y(120)], false); // and the Anacostia
        d.forEach((m, i) => {
          const x = m[1], y = Y(m[2]);
          b.setColor(i == k.sel ? 3 : 2);
          if (m[3] == 2) b.fillRect(x - 4, y - 4, x + 4, y + 4); // the city
          else b.drawRect(x - 3, y - 3, x + 3, y + 3);
        });
        const m = d[k.sel], mx = m[1], my = Y(m[2]);
        b.setColor(3);
        if (k.frame & 4) corners(b, mx - 9, my - 9, mx + 9, my + 9, 5);
        // its name beside it, on a cleared strip so the rivers don't run through the letters
        const label = m[0].toUpperCase(), lw = b.setFontMonofonto16().stringWidth(label), lx = mx > 230 ? mx - 16 - lw : mx + 16;
        b.setColor(0).fillRect(lx - 3, my - 9, lx + lw + 3, my + 9).setColor(3).setFontAlign(-1, 0).drawString(label, lx, my);
        b.setFontAlign(-1, -1).setColor(2);
        b.wrapString(m[4], 392).slice(0, 3).forEach((l, i) => b.drawString(l, 4, 150 + i * 18));
      },
    };

    // RADIO: the FM dial, your presets from the companion (real FM stations), then the
    // wasteland's own stations (clips from the SD card's RADIO folder).
    P.STATIONS = {
      build: () => (k.X ? [{ t: "FM DIAL", dial: 1 }].concat(k.X.presets().map((s) => ({ t: s.f.toFixed(1) + " " + s.name, f: s.f }))) : [])
        .concat(["Galaxy News Radio", "Enclave Radio", "Agatha's Station", "Vault 101 Emergency", "Ranger Distress Signal"].map((t) => ({ t }))),
      draw(b, d) {
        list(b, d.map((s, i) => ({ t: s.t.length > 21 ? s.t.slice(0, 20) + "." : s.t, mark: playing() && i == k.station })), 2, 6, 226, 6, 30);
        // the signal graph: axes along the right and the bottom, with ticks
        const cy = 78, fm = k.X && k.X.fm.on && k.X.fm, amp = fm ? 6 + fm.signal() * 40 : k.radioOn ? 40 : 2;
        b.setColor(2).drawLine(244, 140, 392, 140).drawLine(392, 16, 392, 140);
        for (let k = 0; k <= 12; k++) b.drawLine(248 + k * 12, 140, 248 + k * 12, k % 3 ? 136 : 132).drawLine(392, 20 + k * 10, k % 3 ? 388 : 384, 20 + k * 10);
        b.setColor(3);
        let py = cy;
        for (let x = 0; x <= 140; x += 4) {
          const y = cy + Math.sin(x / 10 + k.frame / 2) * amp * (0.55 + 0.45 * Math.sin(x / 33 + k.frame / 9));
          if (x) b.drawLine(244 + x - 4, py, 244 + x, y);
          py = y;
        }
        const on = playing(), s = d[k.station] || d[0];
        cells(b, 240, 150, [["", fm ? "FM " + fm.freq.toFixed(1) + " MHZ" : on ? "PLAYING" : "PLAY / SELECT", 156]]);
        cells(b, 240, 176, [["", !on ? "OFF" : s.dial ? "THUMBWHEEL TUNES" : (s.f ? s.t.slice(s.t.indexOf(" ") + 1) : s.t).toUpperCase().slice(0, 18), 156]]);
      },
      select(d) {
        if (playing() && k.station == k.sel) stopRadio();
        else { k.station = k.sel; play(d); }
      },
      play(d) { if (playing()) stopRadio(); else { k.station = k.sel; play(d); } },
      onKnob2(dir, d) {
        // On the FM dial the thumbwheel tunes in 0.1 MHz steps; elsewhere it steps through the stations
        if (k.X && k.X.fm.on && d[k.station].dial && k.station == k.sel) { k.X.fm.tune(k.X.fm.freq + dir / 10); return; }
        k.sel = (k.sel + d.length + dir) % d.length;
        if (playing()) { k.station = k.sel; play(d); }
        sound(dir > 0 ? "NEXT" : "PREV");
      },
    };

    // ------------------------------------------------------------------ header & footer

    function drawHeader() {
      const d = new Date(), two = (n) => ("0" + n).substr(-2), m = process.memory(false), Y = 40;
      let bat = 1;
      try { bat = E.clip((analogRead(VBAT_MEAS) * 2 * E.getAnalogVRef() - 3.5) / 0.6, 0, 1); } catch (e) {}
      if (VUSB_PRESENT.read()) bat = 1;
      bH.clear().setFontMonofonto23();
      const title = TITLES[k.tab] || "", w = bH.stringWidth(title) + 22;
      bH.setColor(3).drawRect(0, 10, w, Y).setFontAlign(0, 0).drawString(title, w / 2, 26);
      bH.drawLine(w, Y, 371, Y).drawLine(371, Y, 371, 50).drawLine(0, Y, 0, 50);
      // level, HP (the battery), AP (free memory) and the time, right to left
      bH.setFontMonofonto16().setFontAlign(1, -1);
      let x = 366;
      [two(d.getHours()) + ":" + two(d.getMinutes()), "AP " + Math.round(100 - (m.usage / m.total) * 100), "HP " + Math.round(bat * 100), "LVL " + (SHEET && SHEET.level || 20)].forEach((t) => {
        bH.setColor(3).drawString(t, x, 20);
        x -= bH.stringWidth(t) + 8;
        bH.setColor(2).drawLine(x, 24, x, Y);
        x -= 8;
      });
      showH();
    }

    function drawFooter() {
      bF.clear().setFontMonofonto16().setFontAlign(-1, -1);
      const names = PAGES[k.tab] || [], xs = [];
      let x = 0;
      names.forEach((p) => { xs.push(x); x += bF.stringWidth(p) + 20; });
      // centred when they fit; otherwise the row scrolls to keep the current one in view
      const room = 356, total = x - 20;
      const off = !names.length ? 0 : total > room ? E.clip(xs[k.page] + bF.stringWidth(names[k.page]) / 2 - room / 2, 0, total - room) : (total - room) / 2;
      bF.setColor(2).drawLine(0, 3, 371, 3).drawLine(0, 0, 0, 3).drawLine(371, 0, 371, 3);
      names.forEach((p, i) => {
        const px = 8 + xs[i] - off, w = bF.stringWidth(p);
        if (i == k.page) bF.setColor(0).fillRect(px - 6, 0, px + w + 6, 24).setColor(3).drawRect(px - 6, 2, px + w + 6, 23);
        bF.setColor(i == k.page ? 3 : 1).drawString(p, px, 5);
      });
      showF();
    }

    return { pages: P, list, drawHeader, drawFooter };
  },
});
