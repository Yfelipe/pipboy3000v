// PIP-BOY 2000 — an alternative Pip-Boy 3000 Mk V interface styled after the Pip-Boy 2000 of
// Fallout and Fallout 2: Vault 13's dweller, the eighteen original skills, the hunt for the water
// chip and a map of Southern California. Original artwork drawn with Graphics primitives.
//
// The look is the Pip-Boy 2000's, not the 3000's: a column of buttons down the left with a lamp
// on the current section (the mode dial picks it), a text screen beside them, the date and time
// in boxes along the top, and everything on the screen as terminal text: a ">" cursor instead of
// a highlight bar, dotted leaders to the numbers, blocks for meters, a seven-segment clock.
// The wheels, dial, video, settings and companion extras work as in Mojave UI (../mojave/mojave.js),
// which this file's plumbing was taken from.
//
// Install: write pip2000.min.js (./build.sh) to Storage under that name, then load("pip2000.min.js").
// sd/USER/PIP2000.JS on the SD card adds it to the stock INV > APPS menu.
// It runs from flash and replaces the stock interface until the power button is pressed,
// which returns to the stock interface. Needs firmware 2v24 or later (Pip.blitImage);
// the Pip-OS 1.33 screens (INV > ID, DATA > FEEDS and LISTS, ../shared/pipos133.js) work on any.
// The companion's extras (../mojave/extras.js, read from sd/USER/PIP2000.EXT so they cost no
// Storage): FM radio and presets in RADIO, INV > REMOTE, DATA > NOTES and INBOX. Messages from
// the companion pop up over whatever is showing.
//
// Controls (as on the stock firmware): mode dial = tabs, thumbwheel = sub-pages,
// wheel = scroll, wheel press = select, PLAY = radio on/off, torch = flashlight, power = exit.

import { run } from "../shared/engine.js";

run({
  settingsFile: "pip2000.json",
  extFile: "USER/PIP2000.EXT",
  themes: [
    { name: "CRT GREEN", rgb: [0.25, 1, 0.2] },  // the Pip-Boy 2000's green tube
    { name: "AMBER", rgb: [1, 0.71, 0.26] },
    { name: "VAULT 13", rgb: [0.45, 0.7, 1] },   // jumpsuit blue
    { name: "PIP-BOY", rgb: [0.2, 1, 0.3], stock: true }, // the stock interface's own colour
  ],
  pages: [
    ["STATUS", "S.P.E.C.I.A.L.", "SKILLS"],
    ["WEAPONS", "APPAREL", "AID", "MISC", "ID"],
    ["QUESTS", "UPLINK", "FEEDS", "LISTS", "CLOCK", "SYSTEM"],
    ["WASTELAND"],
    ["STATIONS"],
  ],
  bootLines: ["ROBCO PIP-BOY 2000", "VAULT-TEC ISSUE, VAULT 13", "", "64K RAM SYSTEM", "38911 BYTES FREE", "LOADING STATUS...", "", "GOOD LUCK OUT THERE."],
  // Everything this app draws. k is the engine's kit (../shared/engine.js): its buffers and
  // helpers, and the values that change (k.sel, k.frame, k.tab, k.page, k.station, k.radioOn, k.X).
  build(k) {
    // (one by one: Espruino has no destructuring)
    const bH = k.bH, bF = k.bF, showH = k.showH, showF = k.showF, sound = k.sound, THEMES = k.THEMES, cfg = k.cfg, save = k.save, applyTheme = k.applyTheme, backlight = k.backlight, exitToStock = k.exitToStock, playing = k.playing, stopRadio = k.stopRadio, play = k.play, SHEET = k.SHEET, PAGES = k.PAGES, VBAT_MEAS = k.VBAT_MEAS, VUSB_PRESENT = k.VUSB_PRESENT;

    // ------------------------------------------------------------------ drawing helpers
    // The text screen sits right of the button column: 286 px, 35 characters of Monofonto16
    const SX = 106, SW = 286;
    const SECTIONS = ["STATUS", "ITEMS", "ARCHIVES", "AUTOMAPS", "RADIO"];
    const MONTHS = "JAN,FEB,MAR,APR,MAY,JUN,JUL,AUG,SEP,OCT,NOV,DEC".split(",");

    /** The column of buttons, lit on the section the mode dial points at, and the screen's bezel. */
    function buttons(b) {
      b.setFontMonofonto16().setFontAlign(0, 0);
      SECTIONS.forEach((name, i) => {
        const y = 2 + i * 42, on = i == k.tab;
        b.setColor(on ? 3 : 1).drawRect(0, y, 92, y + 36).drawRect(3, y + 3, 89, y + 33);
        if (on) b.fillRect(6, y + 6, 86, y + 30).setColor(0);
        else b.setColor(2);
        b.drawString(name, 46, y + 18);
      });
      b.setColor(1).drawRect(98, 0, 399, 209).drawRect(100, 2, 397, 207);
      b.setFontAlign(-1, -1);
    }

    /** "LABEL ...... VALUE" filling w pixels of Monofonto16 (8 px a character). */
    function leader(label, value, w) {
      value = String(value);
      const room = (w >> 3) - value.length - 2;
      if (label.length > room - 2) label = label.slice(0, room - 3) + ".";
      return label + " " + ".".repeat(Math.max(2, room - label.length)) + " " + value;
    }

    /** A meter made of n blocks. */
    function blocks(b, x, y, n, frac) {
      const lit = Math.round(n * E.clip(frac, 0, 1));
      for (let i = 0; i < n; i++) {
        if (i < lit) b.setColor(3).fillRect(x + i * 10, y, x + i * 10 + 6, y + 11);
        else b.setColor(1).drawRect(x + i * 10, y, x + i * 10 + 6, y + 11);
      }
    }

    /** A scrolling list as terminal text: a ">" cursor and an underline on the current row. items: [{t: label, mark}] */
    function list(b, items, x, y, w, rows, rowH) {
      const first = E.clip(k.sel - (rows >> 1), 0, Math.max(0, items.length - rows));
      b.setFontMonofonto16().setFontAlign(-1, -1);
      for (let i = 0; i < rows && first + i < items.length; i++) {
        const it = items[first + i], yy = y + i * rowH, on = first + i == k.sel;
        b.setColor(on ? 3 : 2).drawString((on ? ">" : " ") + (it.mark ? "*" : " ") + it.t, x, yy);
        if (on) b.drawLine(x + 16, yy + 17, x + w, yy + 17);
      }
      b.setColor(1);
      if (first > 0) b.drawString("^", x + w - 8, y - 14);
      if (first + rows < items.length) b.drawString("v", x + w - 8, y + rows * rowH - 4);
    }

    /** Word-wrapped text in a box. */
    function para(b, text, x, y, w, maxLines) {
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2);
      b.wrapString(text, w).slice(0, maxLines || 99).forEach((l, i) => b.drawString(l, x, y + i * 18));
    }

    // ------------------------------------------------------------------ pages
    // Each page: build() -> data (called on open), draw(b, data) (called every frame), select(data)

    const P = {};

    // Layout units: Monofonto16 is 8x19 px per character, Monofonto18 9x21, Monofonto23 12x27.
    // The content buffer is 400x210; pages split it into columns with a 1 px divider.

    // STATUS: the dweller's condition as the Pip-Boy 2000 would print it, and Vault 13's water
    P.STATUS = {
      draw(b) {
        buttons(b);
        const hp = 34, max = 42, days = 98;
        b.setColor(3).drawString("VAULT DWELLER", SX, 8);
        b.setFontAlign(1, -1).drawString("LEVEL " + (SHEET && SHEET.level || 9), SX + SW, 8).setFontAlign(-1, -1);
        b.setColor(1).drawLine(SX, 28, SX + SW, 28);
        [["HIT POINTS", hp / max, hp + "/" + max], ["RADIATION", 0.15, "LOW"], ["POISON", 0, "NONE"]].forEach((r, i) => {
          const y = 36 + i * 22;
          b.setColor(2).drawString(r[0], SX, y);
          blocks(b, SX + 96, y + 2, 12, r[1]);
          b.setColor(3).setFontAlign(1, -1).drawString(r[2], SX + SW, y).setFontAlign(-1, -1);
        });
        b.setColor(1).drawLine(SX, 106, SX + SW, 106);
        b.setColor(2).drawString("VAULT 13 WATER RESERVE", SX, 112);
        b.setFontMonofonto36().setColor(3).drawString(days, SX, 132);
        b.setFontMonofonto16().drawString("DAYS LEFT", SX + 54, 148);
        blocks(b, SX + 136, 150, 15, days / 150);
        b.setColor(k.frame & 8 ? 3 : 1).drawString("> FIND THE WATER CHIP", SX, 184);
      },
    };

    P["S.P.E.C.I.A.L."] = {
      build: () => [
        ["Strength", 5, "Raw physical power. Hit points, melee damage and how much you can carry."],
        ["Perception", 6, "Sight and hearing. Decides who shoots first, and from how far."],
        ["Endurance", 6, "Stamina. Shrugs off poison and the rads around the Glow."],
        ["Charisma", 5, "Looks and charm. The Hub's merchants notice."],
        ["Intelligence", 7, "Knowledge. More skill points every level, and more to say."],
        ["Agility", 8, "Coordination. Action points, and not being where the bullet is."],
        ["Luck", 5, "Fate. Critical hits, and what waits at a random encounter."],
      ].map((r, i) => SHEET ? [r[0], E.clip(SHEET.special[i] | 0, 1, 10), r[2]] : r),
      draw(b, d) {
        buttons(b);
        list(b, d.map((s) => ({ t: leader(s[0].toUpperCase(), ("0" + s[1]).slice(-2), SW - 16) })), SX, 6, SW, 7, 20);
        b.setColor(1).drawLine(SX, 150, SX + SW, 150);
        para(b, d[k.sel][2], SX, 154, SW, 3);
      },
    };

    P.SKILLS = {
      build: () => [
        ["Small Guns", 72, "Pistols, rifles and shotguns."],
        ["Big Guns", 14, "Miniguns, flamers and rocket launchers."],
        ["Energy Weapons", 22, "Lasers and plasma. The Brotherhood has the good ones."],
        ["Unarmed", 48, "Fists and feet."],
        ["Melee Weapons", 40, "Knives, spears and sledgehammers."],
        ["Throwing", 30, "Grenades, rocks and throwing knives."],
        ["First Aid", 44, "Patching up small wounds."],
        ["Doctor", 20, "Setting crippled limbs."],
        ["Sneak", 38, "Moving without being noticed."],
        ["Lockpick", 52, "Opening doors without the key."],
        ["Steal", 26, "Other people's pockets."],
        ["Traps", 24, "Finding them before they find you."],
        ["Science", 46, "Computers, and the Glow's old machines."],
        ["Repair", 50, "Fixing what two centuries broke."],
        ["Speech", 60, "Talking your way in, or out."],
        ["Barter", 34, "Prices at the Hub."],
        ["Gambling", 18, "The tables in Junktown."],
        ["Outdoorsman", 42, "Fewer nasty surprises between towns."],
      ],
      draw(b, d) {
        buttons(b);
        list(b, d.map((s) => ({ t: leader(s[0].toUpperCase(), s[1] + "%", SW - 16) })), SX, 6, SW, 7, 20);
        b.setColor(1).drawLine(SX, 150, SX + SW, 150);
        blocks(b, SX, 156, 20, d[k.sel][1] / 100);
        para(b, d[k.sel][2], SX, 174, SW, 2);
      },
    };

    /** Inventory pages share one layout: the list, then the chosen item's figures and description. */
    function inventory(items, cols) {
      return {
        build: () => items,
        draw(b, d) {
          buttons(b);
          list(b, d.map((it) => ({ t: leader(it[0].toUpperCase(), cols[0] + " " + it[1], SW - 16), mark: it[4] })), SX, 6, SW, 6, 20);
          const it = d[k.sel];
          b.setColor(1).drawLine(SX, 130, SX + SW, 130);
          b.setColor(3).drawString(cols[1] + " " + it[2] + "   " + cols[2] + " " + it[3] + (it[4] ? "   * IN USE" : ""), SX, 134);
          para(b, it[5], SX, 154, SW, 3);
        },
        select(d) {
          d[k.sel][4] = !d[k.sel][4];
          sound(d[k.sel][4] ? "OK" : "CANCEL");
        },
      };
    }

    P.WEAPONS = inventory([
      ["10mm Pistol", "5-12", "3", "250", true, "Colt 6520. It left Vault 13 with you."],
      ["Hunting Rifle", "8-20", "9", "1000", false, "Good at range. Better with a scope."],
      ["Desert Eagle .44", "10-16", "4", "800", false, "A heavy pistol for people who mean it."],
      ["Combat Shotgun", "15-25", "10", "2750", false, "Winchester City-Killer. The name is fair."],
      ["Spear", "3-10", "4", "80", false, "A sharp point on a long stick. Shady Sands makes them."],
      ["Knife", "1-6", "1", "40", false, "For when the ammunition runs out."],
      ["Flare", "1-1", "1", "35", false, "Lights up the caves under Vault 15."],
    ], ["DAM", "WG", "VAL"]);

    P.APPAREL = inventory([
      ["Vault 13 Jumpsuit", "0", "0", "0", true, "Blue, with a yellow 13 on the back."],
      ["Leather Jacket", "8", "5", "250", false, "One sleeve, as the fashion goes in Junktown."],
      ["Leather Armor", "15", "8", "700", false, "Boiled hide. Stops knives, mostly."],
      ["Metal Armor", "10", "35", "1100", false, "Road signs and scrap, bolted together."],
      ["Combat Armor", "20", "20", "6500", false, "Pre-war military issue."],
      ["Power Armor", "25", "85", "12500", false, "T-51b. The Brotherhood does not hand these out."],
    ], ["AC", "WG", "VAL"]);

    P.AID = inventory([
      ["Stimpak", "+15HP", "0", "175", false, "Heals as fast as it hurts."],
      ["First Aid Kit", "+SKILL", "2", "200", false, "Bandages and a steadier hand."],
      ["RadAway", "-RADS", "0", "500", false, "Flushes the rads. Tastes like it."],
      ["Rad-X", "+RES", "0", "300", false, "Take two before the Glow."],
      ["Nuka-Cola", "+0HP", "1", "3", false, "Warm and flat. Keep the cap."],
      ["Iguana-on-a-stick", "+8HP", "1", "8", false, "Sold in the Hub. Mostly iguana."],
    ], ["EFF", "WG", "VAL"]);

    P.MISC = inventory([
      ["Water Chip", "-", "2", "???", false, "Vault 13's is broken. Somewhere there is a spare."],
      ["Rope", "-", "10", "25", false, "For the lift shaft in Vault 15."],
      ["Geiger Counter", "-", "5", "650", false, "Clicks faster the worse it gets."],
      ["Lockpicks", "-", "1", "150", false, "A proper set. Try the lockpicking holotape."],
      ["Holodisk", "-", "1", "0", false, "Someone's last recording."],
      ["Bottle Caps", "-", "0", "1337", false, "Backed by the Hub's water merchants."],
    ], ["DAM", "WG", "VAL"]);

    P.QUESTS = {
      build: () => [
        ["Leave Vault 13", "Get past the rats in the cave", "Walk east", true],
        ["Shady Sands", "Deal with the radscorpions", "Bring Tandi home", true],
        ["Vault 15", "Search the control room", "Find a rope first", true],
        ["Junktown", "Sort out Killian and Gizmo", "Get directions to the Hub", true],
        ["The Hub", "Hire the water merchants", "Ask about the missing caravans", true],
        ["Necropolis", "Fix the water pump", "Take the water chip", true],
        ["Destroy the Vats", "Find the military base", "Stop the army at its source", true],
        ["Destroy the Master", "Get inside the Cathedral", "End it", false],
      ],
      draw(b, d) {
        buttons(b);
        list(b, d.map((q) => ({ t: leader(q[0].toUpperCase(), q[3] ? "DONE" : "OPEN", SW - 16) })), SX, 6, SW, 6, 20);
        const q = d[k.sel];
        b.setColor(1).drawLine(SX, 130, SX + SW, 130);
        [q[1], q[2]].forEach((o, i) => {
          const done = q[3] || (i == 0 && k.sel < 7);
          b.setColor(done ? 2 : 3).drawString((done ? "[k.X] " : "[ ] ") + (o.length > 31 ? o.slice(0, 30) + "." : o), SX, 136 + i * 22);
        });
        b.setColor(q[3] ? 1 : 3).drawString(q[3] ? "STATUS: COMPLETED" : "STATUS: ACTIVE", SX, 184);
      },
    };

    P.UPLINK = {
      build: () => ({
        lines: [
          "VAULT 13 // OVERSEER'S OFFICE",
          "CONNECTION ESTABLISHED.",
          "",
          "> O: The water chip has failed.",
          "> O: We have 150 days of water.",
          "> O: Find a replacement. Try",
          "  Vault 15, to the east.",
          "> O: We are counting on you.",
          "",
          "> END OF MESSAGE.",
        ],
        t: 0,
      }),
      draw(b, d) {
        buttons(b);
        d.t = Math.min(d.t + 3, 999);
        let left = d.t;
        b.setColor(3);
        for (let i = 0; i < d.lines.length && left > 0; i++) {
          const l = d.lines[i].substr(0, left);
          b.drawString(l, SX, 6 + i * 18);
          left -= d.lines[i].length + 1;
          if (left <= 0 && k.frame & 4) b.fillRect(SX + b.stringWidth(l), 8 + i * 18, SX + 8 + b.stringWidth(l), 20 + i * 18);
        }
      },
      select(d) { d.t = 0; sound("OK"); },
    };

    // The alarm clock's display: seven-segment digits drawn from bars
    const SEGS = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f]; // bits: a b c d e f g
    function digit(b, x, y, n) {
      const m = SEGS[n], w = 40, h = 76, t = 7, mid = y + (h >> 1);
      b.setColor(3);
      [[x + t, y, x + w - t, y + t], [x + w - t, y + t, x + w, mid - 3], [x + w - t, mid + 3, x + w, y + h - t], [x + t, y + h - t, x + w - t, y + h],
        [x, mid + 3, x + t, y + h - t], [x, y + t, x + t, mid - 3], [x + t, mid - 3, x + w - t, mid + 3]].forEach((r, i) => {
        if (m >> i & 1) b.fillRect(r[0], r[1], r[2], r[3]);
      });
    }

    P.CLOCK = {
      draw(b) {
        buttons(b);
        const d = new Date(), two = (n) => ("0" + n).substr(-2), t = two(d.getHours()) + two(d.getMinutes());
        const x0 = SX + 34;
        [0, 1, 2, 3].forEach((i) => digit(b, x0 + i * 50 + (i > 1 ? 20 : 0), 14, +t[i]));
        b.setColor(d.getSeconds() & 1 ? 3 : 1).fillRect(x0 + 100, 36, x0 + 108, 44).fillRect(x0 + 100, 62, x0 + 108, 70);
        b.setColor(3).setFontMonofonto23().setFontAlign(0, -1).drawString(MONTHS[d.getMonth()] + " " + two(d.getDate()) + " " + d.getFullYear(), SX + SW / 2, 106);
        b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString("SECONDS", SX, 150);
        blocks(b, SX + 72, 152, 20, d.getSeconds() / 59);
        b.setColor(1).drawString("ALARM CLOCK: SET IT IN THE STOCK UI", SX, 184);
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
        buttons(b);
        list(b, d.map((o) => ({ t: leader(o.t.toUpperCase(), o.v() || "GO", SW - 16) })), SX, 6, SW, 4, 24);
        const m = process.memory(false);
        b.setColor(1).drawLine(SX, 110, SX + SW, 110);
        b.setColor(2).drawString("ROBCO PIP-BOY 2000", SX, 118);
        b.drawString("FIRMWARE " + process.env.VERSION, SX, 138);
        b.drawString("MEMORY " + m.usage + "/" + m.total + " BLOCKS", SX, 158);
        b.drawString("STORAGE " + Math.round(require("Storage").getFree() / 1024) + "KB FREE", SX, 178);
      },
      select(d) { d[k.sel].go(); save(); sound("OK"); },
    };

    // Southern California landmarks on a schematic map (x, y in the 400x210 content area, kind)
    P.WASTELAND = {
      build: () => [
        ["Vault 13", 96, 28, 1, "Home. A hundred and fifty days of water, and counting."],
        ["Shady Sands", 196, 34, 0, "Farmers behind an adobe wall. They will go far."],
        ["Vault 15", 248, 28, 3, "Abandoned, and collapsed below the second level."],
        ["Junktown", 180, 98, 0, "A town built of wrecked cars. No weapons past the gate."],
        ["The Hub", 206, 128, 2, "Where every caravan starts and ends."],
        ["Necropolis", 280, 122, 3, "The city of the dead. Its ghouls keep the pumps running."],
        ["Lost Hills", 128, 76, 1, "The Brotherhood of Steel's bunker. Knock first."],
        ["Boneyard", 196, 172, 0, "What is left of Los Angeles."],
        ["The Glow", 300, 194, 3, "A crater that used to be West Tek. Bring Rad-k.X."],
        ["Mariposa", 60, 20, 3, "A military base, and the vats under it."],
        ["Cathedral", 204, 198, 3, "The Children's temple. Something lives beneath it."],
      ],
      draw(b, d) {
        // The automap: a ruled grid over the top 140 px of the text screen, a ring for each place and
        // cross-hairs on the chosen one. Places are listed in a 400x210 space and scaled to fit.
        buttons(b);
        const MX = (x) => SX + x * 0.7, Y = (y) => 6 + y * 0.64;
        b.setColor(1);
        for (let x = SX; x <= SX + SW; x += 26) b.drawLine(x, 4, x, 140);
        for (let y = 4; y <= 140; y += 17) b.drawLine(SX, y, SX + SW, y);
        b.setColor(2).drawPoly([40, 0, 52, 50, 84, 100, 120, 150, 150, 180, 170, 210].map((v, i) => i & 1 ? Y(v) : MX(v)), false); // the coast
        const m = d[k.sel], mx = MX(m[1]), my = Y(m[2]);
        b.drawLine(SX, my, SX + SW, my).drawLine(mx, 4, mx, 140);
        d.forEach((p, i) => {
          const x = MX(p[1]), y = Y(p[2]);
          b.setColor(0).fillCircle(x, y, 5).setColor(i == k.sel ? 3 : 2).drawCircle(x, y, 5);
          if (i == k.sel) b.fillCircle(x, y, k.frame & 4 ? 5 : 2);
          else if (p[3] == 2) b.fillCircle(x, y, 2);
        });
        b.setColor(3).drawString("> " + m[0].toUpperCase(), SX, 146);
        b.setColor(2);
        b.wrapString(m[4], SW).slice(0, 2).forEach((l, i) => b.drawString(l, SX, 166 + i * 18));
      },
    };

    // RADIO: the FM dial, your presets from the companion (real FM stations), then the
    // wasteland's own stations (clips from the SD card's RADIO folder).
    P.STATIONS = {
      build: () => (k.X ? [{ t: "FM DIAL", dial: 1 }].concat(k.X.presets().map((s) => ({ t: s.f.toFixed(1) + " " + s.name, f: s.f }))) : [])
        .concat(["Vault 13 Intercom", "Hub Caravan Band", "Brotherhood Channel", "Junktown Skum Pitt", "Cathedral Sermon"].map((t) => ({ t }))),
      draw(b, d) {
        buttons(b);
        list(b, d.map((s, i) => ({ t: (s.t.length > 30 ? s.t.slice(0, 29) + "." : s.t).toUpperCase(), mark: playing() && i == k.station })), SX, 6, SW, 5, 20);
        // the tuning scale, 88 to 108, with a pointer
        const on = playing(), s = d[k.station] || d[0], fm = k.X && k.X.fm.on && k.X.fm;
        b.setColor(1).drawLine(SX, 112, SX + SW, 112);
        for (let k = 0; k <= 20; k++) b.drawLine(SX + 8 + k * 13.5, 126, SX + 8 + k * 13.5, k % 5 ? 132 : 138);
        b.drawString("88", SX, 140).setFontAlign(1, -1).drawString("108", SX + SW, 140).setFontAlign(-1, -1);
        const f = fm ? fm.freq : on ? 88 + (k.frame / 3) % 20 : 88, px = SX + 8 + (f - 88) * 13.5;
        b.setColor(3).fillPoly([px - 5, 116, px + 5, 116, px, 126]);
        b.setFontAlign(0, -1).setColor(on ? 3 : 1).drawString(fm ? "FM " + fm.freq.toFixed(1) + " MHZ" : on ? "PLAYING" : "PRESS PLAY / SELECT", SX + SW / 2, 146);
        b.setColor(2).drawString(!on ? "" : s.dial ? "THUMBWHEEL: TUNE" : s.f ? s.t.slice(s.t.indexOf(" ") + 1) : s.t.toUpperCase(), SX + SW / 2, 166).setFontAlign(-1, -1);
        b.setColor(2).drawString("SIGNAL", SX, 188);
        blocks(b, SX + 64, 190, 20, fm ? fm.signal() : on ? 0.5 + Math.random() * 0.4 : 0);
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
      const d = new Date(), two = (n) => ("0" + n).substr(-2);
      bH.clear().setFontMonofonto23().setFontAlign(-1, -1);
      // the Pip-Boy 2000 shows the date and the time in two windows along its top edge
      bH.setColor(1).drawRect(0, 0, 148, 28).drawRect(154, 0, 216, 28);
      bH.setColor(3).drawString(MONTHS[d.getMonth()] + " " + two(d.getDate()) + " " + d.getFullYear(), 8, 1).drawString(two(d.getHours()) + two(d.getMinutes()), 162, 1);
      bH.setFontMonofonto16().setFontAlign(1, -1).setColor(2).drawString("PIP-BOY 2000", 371, 5);
      // Sub-pages as plain text, the current one in brackets; the row scrolls to keep it in view
      bH.setFontAlign(-1, -1);
      const names = (PAGES[k.tab] || []).map((p, i) => i == k.page ? "[" + p + "]" : " " + p + " "), xs = [];
      let x = 0;
      names.forEach((p) => { xs.push(x); x += bH.stringWidth(p) + 6; });
      const room = 372, total = x - 6, off = total > room && names.length ? E.clip(xs[k.page] + bH.stringWidth(names[k.page]) / 2 - room / 2, 0, total - room) : 0;
      names.forEach((p, i) => bH.setColor(i == k.page ? 3 : 1).drawString(p, xs[i] - off, 34));
      showH();
    }

    function drawFooter() {
      let bat = 1;
      try { bat = E.clip((analogRead(VBAT_MEAS) * 2 * E.getAnalogVRef() - 3.5) / 0.6, 0, 1); } catch (e) {}
      if (VUSB_PRESENT.read()) bat = 1;
      const m = process.memory(false);
      bF.clear().setColor(1).drawLine(0, 2, 371, 2);
      bF.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString("POWER " + Math.round(bat * 100) + "%", 0, 7);
      bF.setFontAlign(0, -1).drawString("VAULT-TEC ISSUE", 186, 7);
      bF.setFontAlign(1, -1).drawString("MEM " + Math.round(100 - (m.usage / m.total) * 100) + "% FREE", 371, 7);
      showF();
    }

    return { pages: P, list, drawHeader, drawFooter };
  },
});
