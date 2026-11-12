// ENDURANCE — an alternative Pip-Boy 3000 Mk V interface based on Christopher Nolan's film
// Interstellar (2014): a flight-deck display for the ship that goes through the wormhole.
// A fan piece. Three pictures come from the SD card's ENDURANC folder, used with the rights
// holders' permission for this unmonetised project (see README): the film's title, the black
// hole from the paper about how it was rendered, and Hamilton's watch. Everything else is drawn
// here from Graphics primitives, and the app works without the pictures.
//
// The look is a spacecraft console, not a Pip-Boy: white on black, hairlines and small labels, a
// lot of empty space, numbers set to the right. There are no tabs: the header names the section
// with its number, and carries two clocks. A list is a ruled table with a square marking the
// current row. Its own pages are the things the film is about:
//   SHIP     the ring and its spin, the crew, and the robot's settings (the wheel adjusts them)
//   CARGO    the manifest
//   MISSION  the three candidate worlds, both plans, and the time-slip calculator
//   NAV      the route: Earth, Saturn, the wormhole, the black hole and its planets; and the
//            black hole itself
//   COMMS    the beacons (and your real FM presets)
//
// The wheels, dial, video, radio, settings and companion extras are the shared engine
// (../shared/engine.js). Install: write endurance.min.js (./build.sh) to Storage under that name,
// then load("endurance.min.js"); sd/USER/ENDURANC.JS adds it to the stock INV > APPS menu.

import { run } from "../shared/engine.js";

run({
  settingsFile: "endurance.json",
  extFile: "USER/ENDURANC.EXT",
  themes: [
    { name: "WHITE", rgb: [1, 1, 1] },           // the console's own colour
    { name: "DUST", rgb: [1, 0.76, 0.42] },      // the sky at home
    { name: "ICE", rgb: [0.68, 0.9, 1] },        // the frozen world
    { name: "PIP-BOY", rgb: [0.2, 1, 0.3], stock: true }, // the stock interface's own colour
  ],
  pages: [
    ["RING", "CREW", "ROBOT"],
    ["MANIFEST", "ID"],
    ["WORLDS", "PLANS", "TIME SLIP", "FEEDS", "LISTS", "CLOCK", "SYSTEM"],
    ["ROUTE", "GARGANTUA"],
    ["SIGNALS"],
  ],
  bootLines: ["ENDURANCE FLIGHT SYSTEMS", "", "RING SPIN ........ OK", "LIFE SUPPORT ..... OK", "CRYO BEDS ........ OK", "ROBOTS ........... OK", "", "ALL STATIONS GO."],
  // Everything this app draws. k is the engine's kit (../shared/engine.js): its buffers and
  // helpers, and the values that change (k.sel, k.frame, k.tab, k.page, k.station, k.radioOn, k.X).
  build(k) {
    // (one by one: Espruino has no destructuring)
    const bC = k.bC, showC = k.showC, bH = k.bH, bF = k.bF, showH = k.showH, showF = k.showF, sound = k.sound, THEMES = k.THEMES, cfg = k.cfg, save = k.save, applyTheme = k.applyTheme, backlight = k.backlight, exitToStock = k.exitToStock, playing = k.playing, stopRadio = k.stopRadio, play = k.play, PAGES = k.PAGES, VBAT_MEAS = k.VBAT_MEAS, VUSB_PRESENT = k.VUSB_PRESENT;
    const P = {};
    const SECTIONS = ["SHIP", "CARGO", "MISSION", "NAV", "COMMS"];
    const started = Date.now();
    const two = (n) => ("0" + n).substr(-2);
    let clockRun = 0; // which opening of the CLOCK page is current (its timer stops when another starts)

    /**
     * Copy a picture from the SD card's ENDURANC folder into the page buffer, a row at a time.
     * They are raw 2 bit images (./make-images.py); w and x are multiples of 4. False without the file.
     */
    function image(file, w, h, x, y) {
      let f;
      try { f = E.openFile("ENDURANC/" + file, "r"); } catch (e) {}
      if (!f) return false;
      const buf = new Uint8Array(bC.buffer), rb = w >> 2;
      for (let r = 0; r < h; r++) {
        const s = f.read(rb);
        if (!s) break;
        buf.set(E.toUint8Array(s), (y + r) * 100 + (x >> 2));
      }
      f.close();
      return true;
    }

    // ------------------------------------------------------------------ drawing helpers

    /** A label and its value on one ruled row: the label small and dim at the left, the value at the right. */
    function row(b, x, y, w, label, value) {
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString(label, x, y);
      b.setFontAlign(1, -1).setColor(3).drawString(value, x + w, y).setFontAlign(-1, -1);
      b.setColor(1).drawLine(x, y + 19, x + w, y + 19);
    }

    /** A scale: a hairline with a tick every tenth and a pointer at frac (0..1). */
    function scale(b, x, y, w, frac) {
      b.setColor(1).drawLine(x, y, x + w, y);
      for (let i = 0; i <= 10; i++) b.drawLine(x + (w * i) / 10, y, x + (w * i) / 10, y + (i % 5 ? 3 : 6));
      const px = x + w * E.clip(frac, 0, 1);
      b.setColor(3).fillPoly([px - 4, y - 8, px + 4, y - 8, px, y - 1]);
    }

    /**
     * A scrolling list as a ruled table: a square marks the current row, the others are dim, and a
     * thumb on a track at the right shows where you are. items: [{t: label, mark, v: value}]
     */
    function list(b, items, x, y, w, rows, rowH) {
      const first = E.clip(k.sel - (rows >> 1), 0, Math.max(0, items.length - rows));
      b.setFontMonofonto16();
      for (let i = 0; i < rows && first + i < items.length; i++) {
        const it = items[first + i], yy = y + i * rowH, on = first + i == k.sel, ty = yy + ((rowH - 19) >> 1);
        b.setColor(1).drawLine(x, yy + rowH - 1, x + w - 8, yy + rowH - 1);
        if (on) b.setColor(3).fillRect(x, ty + 5, x + 6, ty + 11);
        else if (it.mark) b.setColor(2).drawRect(x, ty + 5, x + 6, ty + 11);
        b.setColor(on ? 3 : 2).setFontAlign(-1, -1).drawString(it.t, x + 14, ty);
        if (it.v !== undefined) b.setFontAlign(1, -1).drawString(it.v, x + w - 14, ty);
      }
      if (items.length > rows) {
        const h = rows * rowH - 2, th = Math.max(8, (h * rows) / items.length), t0 = y + ((h - th) * first) / (items.length - rows);
        b.setColor(1).drawLine(x + w - 2, y, x + w - 2, y + h).setColor(3).fillRect(x + w - 4, t0, x + w, t0 + th);
      }
      b.setFontAlign(-1, -1);
    }

    /** Word-wrapped text, dim. */
    function para(b, text, x, y, w, maxLines) {
      b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2);
      b.wrapString(text, w).slice(0, maxLines || 99).forEach((l, i) => b.drawString(l, x, y + i * 18));
    }

    // ------------------------------------------------------------------ SHIP

    // The ring: a wheel station seen face-on, turning. Spin is what gives the crew their weight.
    P.RING = {
      draw(b) {
        const cx = 104, cy = 104, R = 78, a0 = k.frame / 45;
        b.setColor(2).drawCircle(cx, cy, R).drawCircle(cx, cy, R - 12);
        b.setColor(1).drawCircle(cx, cy, 16);
        for (let i = 0; i < 12; i++) {
          const a = a0 + (i * Math.PI) / 6, c = Math.cos(a), s = Math.sin(a);
          // a module on the ring, and every third one carries a spoke to the hub
          b.setColor(3).fillPoly([cx + c * (R - 11) - s * 7, cy + s * (R - 11) + c * 7, cx + c * (R - 1) - s * 7, cy + s * (R - 1) + c * 7, cx + c * (R - 1) + s * 7, cy + s * (R - 1) - c * 7, cx + c * (R - 11) + s * 7, cy + s * (R - 11) - c * 7]);
          if (i % 3 == 0) b.setColor(2).drawLine(cx + c * 16, cy + s * 16, cx + c * (R - 12), cy + s * (R - 12));
        }
        b.setColor(3).fillCircle(cx, cy, 5);
        row(b, 214, 6, 182, "SPIN", "1.00 G");
        scale(b, 214, 44, 182, 0.5 + Math.sin(k.frame / 30) * 0.01);
        row(b, 214, 64, 182, "MODULES", "12 OF 12");
        row(b, 214, 90, 182, "RANGERS DOCKED", "2");
        row(b, 214, 116, 182, "LANDERS DOCKED", "2");
        row(b, 214, 142, 182, "CRYO BEDS", "4");
        row(b, 214, 168, 182, "HULL", "NOMINAL");
      },
    };

    P.CREW = {
      build: () => [
        ["COOPER", "PILOT", "Engineer and test pilot, back in a cockpit after years of farming."],
        ["BRAND", "BIOLOGIST", "Keeps the embryos. Knows the three worlds, and who was sent to each."],
        ["ROMILLY", "PHYSICIST", "Watches the black hole. Does not sleep well in a tin can."],
        ["DOYLE", "GEOGRAPHER", "Surveys the surface. First down the ramp."],
        ["TARS", "ROBOT", "Ex-military. Flies, lifts, and tells jokes at the setting you choose."],
        ["CASE", "ROBOT", "Says less than TARS. Flies the landers."],
      ],
      draw(b, d) {
        list(b, d.map((c) => ({ t: c[0], v: c[1] })), 0, 4, 400, 6, 23);
        b.setColor(3).setFontMonofonto23().setFontAlign(-1, -1).drawString(d[k.sel][0], 0, 144);
        b.setFontMonofonto16().setFontAlign(1, -1).setColor(2).drawString("ABOARD", 392, 150);
        para(b, d[k.sel][2], 0, 171, 392, 2);
      },
    };

    // The robot's settings, as percentages. Press to take hold of one, turn the wheel to change
    // it, press again to let go. Kept in Storage as robot.json, which the TARS app (../tars)
    // shares: [humor, honesty, trust, discretion].
    P.ROBOT = {
      build() {
        let r = require("Storage").readJSON("robot.json", true);
        if (!Array.isArray(r) || r.length != 4) r = cfg.robot ? [cfg.robot[0], cfg.robot[1], cfg.robot[3], cfg.robot[2]] : [75, 90, 60, 50]; // (it kept them in its own settings, in another order, before)
        cfg.robot = r;
        return { names: ["HUMOR", "HONESTY", "TRUST", "DISCRETION"], edit: false };
      },
      draw(b, d) {
        d.names.forEach((n, i) => {
          const y = 6 + i * 40, on = i == k.sel, v = cfg.robot[i];
          if (on) b.setColor(3).fillRect(0, y + 7, 6, y + 13);
          b.setFontMonofonto16().setFontAlign(-1, -1).setColor(on ? 3 : 2).drawString(n, 14, y);
          b.setFontMonofonto23().setFontAlign(1, -1).setColor(on ? 3 : 2).drawString(v + "%", 392, y - 4);
          scale(b, 150, y + 16, 170, v / 100);
          b.setColor(1).drawLine(0, y + 34, 392, y + 34);
        });
        const v = cfg.robot[k.sel];
        const say = [
          v > 80 ? "EXPECT JOKES. SOME OF THEM GOOD." : v > 40 ? "DRY. WILL FLASH A LIGHT WHEN JOKING." : "NO JOKES. ASK AGAIN AFTER DOCKING.",
          v > 80 ? "ALMOST ALL OF IT. THAT IS THE SAFE AMOUNT." : v > 40 ? "TRUE, BUT NOT THE WHOLE STORY." : "DO NOT ASK IT HOW YOU LOOK.",
          v > 80 ? "HANDS IT THE CONTROLS." : v > 40 ? "CHECKS ITS SUMS." : "KEEPS A HAND ON THE STICK.",
          v > 80 ? "KEEPS IT TO ITSELF." : v > 40 ? "TELLS YOU IF YOU ASK TWICE." : "TELLS EVERYONE.",
        ][k.sel];
        b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString(say, 0, 170);
        b.setColor(d.edit && k.frame & 4 ? 3 : 1).drawString(d.edit ? "WHEEL: CHANGE   PRESS: SET" : "WHEEL: CHOOSE   PRESS: ADJUST", 0, 190);
      },
      onKnob(dir, d) {
        if (d.edit) cfg.robot[k.sel] = E.clip(cfg.robot[k.sel] + dir * 5, 0, 100);
        else k.sel = E.clip(k.sel - dir, 0, 3);
        sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
      },
      select(d) {
        d.edit = !d.edit;
        if (!d.edit) require("Storage").writeJSON("robot.json", cfg.robot);
        sound("OK");
      },
    };

    // ------------------------------------------------------------------ CARGO

    P.MANIFEST = {
      build: () => [
        ["RANGER", "2", "DOCKED", "Single-stage spaceplanes. Fast, light, and the only way down a deep gravity well and back."],
        ["LANDER", "2", "DOCKED", "Heavy lifters for cargo and habitat modules. One way is easier than two."],
        ["HABITAT MODULES", "4", "RING", "A camp to start from, if one of the worlds will take it."],
        ["EMBRYOS", "5000", "COLD STORE", "Plan B. A population in a box, to be raised by whoever arrives."],
        ["SURFACE PROBES", "6", "LANDER 1", "Dropped ahead of the crew to say what the air is made of."],
        ["FUEL", "72%", "TANKS", "Every visit to a world costs some. The sums decide which worlds get a visit."],
        ["RATIONS", "2 YRS", "RING", "For those awake. The cryo beds stretch it."],
        ["CRYO BEDS", "4", "RING", "The long nap. Water-cooled, and dark."],
      ],
      draw(b, d) {
        b.setFontMonofonto16().setFontAlign(-1, -1).setColor(1).drawString("ITEM", 14, 0);
        b.setFontAlign(1, -1).drawString("QTY", 250, 0).drawString("WHERE", 378, 0).setFontAlign(-1, -1);
        const first = E.clip(k.sel - 2, 0, Math.max(0, d.length - 5));
        list(b, d.map((it) => ({ t: it[0], v: it[2] })), 0, 20, 400, 5, 23);
        // the quantity column, between the name and the place
        b.setFontMonofonto16().setFontAlign(1, -1);
        for (let i = 0; i < 5 && first + i < d.length; i++) b.setColor(first + i == k.sel ? 3 : 2).drawString(d[first + i][1], 250, 22 + i * 23);
        para(b, d[k.sel][3], 0, 146, 392, 3);
      },
    };

    // ------------------------------------------------------------------ MISSION

    // The three worlds the earlier missions reported from, side by side. The wheel moves between them.
    P.WORLDS = {
      build: () => [
        ["MILLER", "WATER", "130%", "1 HR = 7 YRS", "Closest to the black hole. Shallow sea from pole to pole, and something on the horizon."],
        ["MANN", "ICE", "80%", "NONE", "Frozen cloud above, and the beacon says there is ground beneath. The data looks very good."],
        ["EDMUNDS", "ROCK", "UNKNOWN", "NONE", "Furthest out, and furthest from the black hole. The beacon stopped sending years ago."],
      ],
      draw(b, d) {
        d.forEach((w, i) => {
          const x = i * 134, on = i == k.sel;
          b.setColor(on ? 3 : 1).drawRect(x, 0, x + 128, 132);
          if (on) b.fillRect(x, 0, x + 128, 3);
          // the world itself: a disc with its terminator, and bands for the kind of surface
          const cx = x + 64, cy = 36, r = 22;
          b.setColor(on ? 3 : 2).drawCircle(cx, cy, r);
          for (let j = -2; j <= 2; j++) {
            const hw = Math.sqrt(r * r - j * j * 49);
            if (i == 0) b.drawLine(cx - hw, cy + j * 7, cx + hw, cy + j * 7); // sea
            else if (i == 1) b.drawLine(cx - hw, cy + j * 7 + (j & 1 ? 3 : -3), cx + hw, cy + j * 7 + (j & 1 ? -3 : 3)); // ice cloud
            else b.setPixel(cx + j * 6, cy + j * 4).setPixel(cx - j * 5, cy + j * 6).setPixel(cx + j * 3, cy - j * 7); // rock
          }
          b.setFontMonofonto18().setFontAlign(0, -1).setColor(on ? 3 : 2).drawString(w[0], cx, 64);
          b.setFontMonofonto16().setFontAlign(-1, -1).setColor(1).drawString("SURF", x + 6, 90).drawString("GRAV", x + 6, 110);
          b.setFontAlign(1, -1).setColor(on ? 3 : 2).drawString(w[1], x + 122, 90).drawString(w[2], x + 122, 110);
        });
        const w = d[k.sel];
        row(b, 0, 138, 392, "TIME SLIP", w[3]);
        para(b, w[4], 0, 162, 392, 2);
      },
      onKnob(dir, d) {
        k.sel = E.clip(k.sel - dir, 0, d.length - 1);
        sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
      },
    };

    // Both plans as a checklist. Press ticks a step off (kept until the app closes).
    P.PLANS = {
      build: () => [
        { head: "PLAN A  /  EVERYONE" },
        { t: "Solve gravity", done: false },
        { t: "Build the stations", done: true },
        { t: "Lift everyone off the Earth", done: false },
        { head: "PLAN B  /  SOMEONE" },
        { t: "Reach the far side of the wormhole", done: true },
        { t: "Choose a world", done: false },
        { t: "Raise the first generation", done: false },
      ],
      draw(b, d) {
        if (d[k.sel].head) k.sel++;
        d.forEach((s, i) => {
          const y = 2 + i * 22, on = i == k.sel;
          b.setFontMonofonto16().setFontAlign(-1, -1);
          if (s.head) {
            b.setColor(3).drawString(s.head, 0, y + 2);
            b.setColor(2).drawLine(0, y + 21, 392, y + 21);
            return;
          }
          b.setColor(on ? 3 : 2).drawRect(14, y + 5, 24, y + 15);
          if (s.done) b.fillRect(17, y + 8, 21, y + 12);
          b.drawString(s.t, 34, y + 1);
          if (on) b.fillRect(0, y + 7, 6, y + 13);
        });
        const left = d.filter((s) => !s.head && !s.done).length;
        b.setColor(1).setFontAlign(1, -1).drawString(left ? left + " TO GO   PRESS: TICK" : "ALL DONE", 392, 190).setFontAlign(-1, -1);
      },
      onKnob(dir, d) {
        let n = k.sel;
        do { n -= dir; } while (d[n] && d[n].head);
        if (d[n]) { k.sel = n; sound(dir > 0 ? "ROT_V_1" : "ROT_V_2"); }
      },
      select(d) {
        d[k.sel].done = !d[k.sel].done;
        sound(d[k.sel].done ? "OK" : "CANCEL");
      },
    };

    // The time-slip calculator: hours spent on the water world against years gone by at home.
    P["TIME SLIP"] = {
      build: () => ({ hours: 3 }),
      draw(b, d) {
        const years = d.hours * 7;
        b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString("ON THE SURFACE", 0, 0);
        b.setFontAlign(1, -1).drawString("AT HOME", 392, 0);
        b.setFontMonofonto96().setColor(3).setFontAlign(-1, -1).drawString(d.hours, 0, 22);
        b.setFontAlign(1, -1).drawString(years, 392, 22);
        b.setFontMonofonto16().setColor(2).setFontAlign(-1, -1).drawString(d.hours == 1 ? "HOUR" : "HOURS", 0, 120);
        b.setFontAlign(1, -1).drawString("YEARS", 392, 120);
        // one hour here, seven years there: the same span on two scales
        b.setFontAlign(0, -1).setColor(1).drawString("=", 200, 60);
        scale(b, 0, 152, 392, d.hours / 12);
        b.setFontAlign(-1, -1).setColor(1).drawString("0", 0, 160);
        b.setFontAlign(1, -1).drawString("12 H / 84 Y", 392, 160);
        b.setFontAlign(-1, -1).setColor(2).drawString("MILLER'S WORLD   WHEEL: HOURS", 0, 186);
      },
      onKnob(dir, d) {
        d.hours = E.clip(d.hours + dir, 0, 12);
        sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
      },
    };

    // Two faces, changed with the wheel. DIAL: hands and a seconds hand that ticks, with the time
    // and date beside it. MURPH: Hamilton's watch from the SD card (a photograph, so its hands
    // stay where they are) with the time beside it, redrawn when the minute changes.
    P.CLOCK = {
      build() {
        const d = { run: ++clockRun, still: false };
        // The photograph is read from the SD card, so it is drawn once and left (d.still) until
        // the minute changes. The timer ends when the page is left or opened again.
        const watch = () => {
          if (d.run != clockRun || PAGES[k.tab][k.page] != "CLOCK") return;
          if (d.still && new Date().getMinutes() != d.min) d.still = false;
          setTimeout(watch, 1000);
        };
        setTimeout(watch, 1000);
        return d;
      },
      onKnob(dir, s) {
        cfg.face = cfg.face ? 0 : 1;
        s.still = false;
        save();
        sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
      },
      draw(b, s) {
        const d = new Date(), cx = 104, cy = 104, R = 86;
        if (cfg.face && image("MURPH.IMG", 184, 210, 0, 0)) {
          s.still = true;
          s.min = d.getMinutes();
          b.setColor(3).setFontMonofonto96().setFontAlign(1, -1).drawString(two(d.getHours()), 392, 4).drawString(two(s.min), 392, 100);
          b.setFontMonofonto16().setFontAlign(1, -1).setColor(2).drawString("MURPH", 250, 8).drawString("HAMILTON", 250, 26);
          b.setColor(1).drawString("WHEEL:", 250, 170).drawString("DIAL", 250, 188);
          return;
        }
        b.setColor(2).drawCircle(cx, cy, R).drawCircle(cx, cy, R + 3);
        for (let i = 0; i < 60; i++) {
          const a = (i * Math.PI) / 30, r1 = i % 5 ? R - 4 : R - 12;
          b.setColor(i % 5 ? 1 : 3).drawLine(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1, cx + Math.sin(a) * (R - 1), cy - Math.cos(a) * (R - 1));
        }
        const hand = (frac, len, wide) => {
          const a = frac * 2 * Math.PI, s = Math.sin(a), c = Math.cos(a);
          if (wide) b.fillPoly([cx - c * wide, cy - s * wide, cx + s * len, cy - c * len, cx + c * wide, cy + s * wide]);
          else b.drawLine(cx - s * 14, cy + c * 14, cx + s * len, cy - c * len);
        };
        b.setColor(3);
        hand(((d.getHours() % 12) + d.getMinutes() / 60) / 12, 46, 4);
        hand((d.getMinutes() + d.getSeconds() / 60) / 60, 70, 3);
        hand(d.getSeconds() / 60, 78, 0);
        b.fillCircle(cx, cy, 4);
        b.setFontMonofonto36().setFontAlign(1, -1).drawString(two(d.getHours()) + ":" + two(d.getMinutes()), 392, 30);
        row(b, 220, 84, 172, "SECONDS", two(d.getSeconds()));
        row(b, 220, 110, 172, "DATE", d.getFullYear() + "-" + two(d.getMonth() + 1) + "-" + two(d.getDate()));
        const up = Math.floor((Date.now() - started) / 60000);
        row(b, 220, 136, 172, "MISSION", "T+" + two(Math.floor(up / 60)) + ":" + two(up % 60));
        b.setFontMonofonto16().setFontAlign(1, -1).setColor(1).drawString("WHEEL: MURPH", 392, 190).setFontAlign(-1, -1);
      },
    };

    P.SYSTEM = {
      build: () => [
        { t: "COLOUR", v: () => THEMES[cfg.theme].name, go: () => { cfg.theme = (cfg.theme + 1) % THEMES.length; applyTheme(); drawHeader(); drawFooter(); } },
        { t: "BRIGHTNESS", v: () => (cfg.bright + 1) + " OF 5", go: () => { cfg.bright = (cfg.bright + 1) % 5; backlight(); } },
        { t: "SOUNDS", v: () => cfg.sound ? "ON" : "OFF", go: () => { cfg.sound = !cfg.sound; } },
        { t: "RETURN TO THE STOCK INTERFACE", v: () => "", go: exitToStock },
      ],
      draw(b, d) {
        list(b, d.map((o) => ({ t: o.t, v: o.v() })), 0, 4, 400, 4, 26);
        const m = process.memory(false);
        row(b, 0, 122, 392, "FIRMWARE", process.env.VERSION);
        row(b, 0, 146, 392, "MEMORY", m.usage + " OF " + m.total + " BLOCKS");
        row(b, 0, 170, 392, "STORAGE FREE", Math.round(require("Storage").getFree() / 1024) + " KB");
      },
      select(d) { d[k.sel].go(); save(); sound("OK"); },
    };

    // ------------------------------------------------------------------ NAV

    // The route as a chart, left to right: home, the ringed planet, the wormhole beside it, then
    // the black hole and the three worlds around it. The wheel steps along it.
    P.ROUTE = {
      build: () => [
        ["EARTH", 22, 96, "Dust and blight. The launch site is under a mountain."],
        ["SATURN", 104, 96, "Two years out. The wormhole keeps station here."],
        ["WORMHOLE", 150, 60, "A sphere, not a hole. Somebody put it there."],
        ["GARGANTUA", 276, 96, "A spinning black hole. Clocks run slow the closer you fly."],
        ["MILLER", 232, 132, "The inner world. An hour on its sea is seven years at home."],
        ["MANN", 318, 46, "The ice world. Its beacon sends good news."],
        ["EDMUNDS", 372, 118, "The outer world, furthest from the pull."],
      ],
      draw(b, d) {
        b.setColor(1);
        for (let x = 22; x < 104; x += 6) b.setPixel(x, 96); // the long leg out
        for (let x = 0; x < 46; x += 5) b.setPixel(104 + x, 96 - x * 0.78);
        for (let x = 162; x < 240; x += 6) b.setPixel(x, 60 + (x - 162) * 0.3); // and the short way through
        b.setColor(2);
        b.drawCircle(22, 96, 5); // home
        b.drawCircle(104, 96, 9).drawEllipse(86, 91, 122, 101); // the ringed planet
        b.drawCircle(150, 60, 8).drawCircle(150, 60, 4); // the wormhole: a ball you can see through
        b.fillCircle(276, 96, 13).setColor(0).fillCircle(276, 96, 11).setColor(2); // the black hole, its disc edge-on
        b.drawEllipse(240, 90, 312, 102).drawEllipse(206, 52, 346, 140);
        b.drawEllipse(226, 68, 384, 126);
        [4, 5, 6].forEach((i) => b.fillCircle(d[i][1], d[i][2], 3));
        const s = d[k.sel], x = s[1], y = s[2];
        b.setColor(3);
        if (k.frame & 4) b.drawRect(x - 16, y - 16, x + 16, y + 16);
        b.drawLine(x, y - 22, x, y - 17).drawLine(x, y + 17, x, y + 22).drawLine(x - 22, y, x - 17, y).drawLine(x + 17, y, x + 22, y);
        b.setColor(1).drawLine(0, 150, 392, 150);
        b.setFontMonofonto18().setFontAlign(-1, -1).setColor(3).drawString(s[0], 0, 154);
        b.setFontMonofonto16().setFontAlign(1, -1).setColor(2).drawString("STOP " + (k.sel + 1) + " OF " + d.length, 392, 156);
        para(b, s[3], 0, 176, 392, 2);
      },
    };

    // The black hole as the film rendered it: the picture from the SD card, left on screen (d.still).
    P.GARGANTUA = {
      build: () => ({ still: false }),
      draw(b, d) {
        if (image("GARGANTU.IMG", 400, 184, 0, 0)) {
          d.still = true;
          b.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString("GARGANTUA", 0, 190);
          b.setFontAlign(1, -1).setColor(1).drawString("IMAGE: JAMES ET AL. 2015 / DNEG", 392, 190).setFontAlign(-1, -1);
          return;
        }
        b.setFontMonofonto23().setFontAlign(0, 0).setColor(2).drawString("GARGANTUA", 200, 80);
        b.setFontMonofonto16().setColor(1).drawString("NO PICTURE ON THE SD CARD (ENDURANC/GARGANTU.IMG)", 200, 110).setFontAlign(-1, -1);
      },
    };

    // ------------------------------------------------------------------ COMMS

    // The FM dial and your presets from the companion (real FM stations), then the beacons
    // (clips from the SD card's RADIO folder). A strip of dots and dashes runs while one plays.
    P.SIGNALS = {
      build: () => (k.X ? [{ t: "FM DIAL", dial: 1 }].concat(k.X.presets().map((s) => ({ t: s.f.toFixed(1) + " " + s.name, f: s.f }))) : [])
        .concat(["HOME UPLINK", "MILLER BEACON", "MANN BEACON", "EDMUNDS BEACON", "RING INTERCOM"].map((t) => ({ t }))),
      draw(b, d) {
        list(b, d.map((s, i) => ({ t: (s.t.length > 22 ? s.t.slice(0, 21) + "." : s.t).toUpperCase(), mark: playing() && i == k.station })), 0, 4, 220, 6, 23);
        const on = playing(), s = d[k.station] || d[0], fm = k.X && k.X.fm.on && k.X.fm;
        // three tracks of marks moving right to left: long and short, like a hand on a key
        for (let t = 0; t < 3; t++) {
          const y = 24 + t * 30;
          b.setColor(1).drawLine(236, y + 10, 392, y + 10);
          if (!on) continue;
          b.setColor(t == 1 ? 3 : 2);
          for (let j = 0; j < 9; j++) {
            const n = (j * 7 + t * 5 + (k.frame >> 2)) % 23, x = 392 - ((j * 20 + k.frame * (2 + t)) % 156), w = n % 3 ? 4 : 12;
            if (n % 5 && x - w > 236) b.fillRect(x - w, y + 2, x, y + 7);
          }
        }
        row(b, 236, 118, 156, "SOURCE", fm ? "FM " + fm.freq.toFixed(1) : on ? "CLIP" : "NONE");
        row(b, 236, 144, 156, "STATE", on ? "RECEIVING" : "SILENT");
        b.setFontMonofonto16().setFontAlign(1, -1).setColor(1).drawString(on && s.dial ? "THUMBWHEEL: TUNE" : "PLAY / PRESS", 392, 176).setFontAlign(-1, -1);
      },
      select(d) {
        if (playing() && k.station == k.sel) stopRadio();
        else { k.station = k.sel; play(d); }
      },
      play(d) { if (playing()) stopRadio(); else { k.station = k.sel; play(d); } },
      onKnob2(dir, d) {
        // On the FM dial the thumbwheel tunes in 0.1 MHz steps; elsewhere it steps through the list
        if (k.X && k.X.fm.on && d[k.station].dial && k.station == k.sel) { k.X.fm.tune(k.X.fm.freq + dir / 10); return; }
        k.sel = (k.sel + d.length + dir) % d.length;
        if (playing()) { k.station = k.sel; play(d); }
        sound(dir > 0 ? "NEXT" : "PREV");
      },
    };

    // ------------------------------------------------------------------ header & footer

    // The section's number and name at the left, two clocks at the right: the time here, and how
    // long this has been running. One hairline under it all.
    function drawHeader() {
      const d = new Date(), up = Math.floor((Date.now() - started) / 60000);
      bH.clear();
      bH.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString("0" + (k.tab + 1) + " / 05", 0, 4);
      bH.setFontMonofonto23().setColor(3).drawString(SECTIONS[k.tab] || "ENDURANCE", 0, 22);
      bH.setFontMonofonto16().setFontAlign(1, -1).setColor(2).drawString("SHIP TIME", 290, 4).drawString("MISSION", 371, 4);
      bH.setFontMonofonto18().setColor(3).drawString(two(d.getHours()) + ":" + two(d.getMinutes()), 290, 24).drawString("T+" + two(Math.floor(up / 60)) + ":" + two(up % 60), 371, 24);
      bH.setColor(1).drawLine(0, 49, 371, 49);
      showH();
    }

    // A square for each page of the section (the current one filled) with its name, then power
    // and memory as plain numbers.
    function drawFooter() {
      let bat = 1;
      try { bat = E.clip((analogRead(VBAT_MEAS) * 2 * E.getAnalogVRef() - 3.5) / 0.6, 0, 1); } catch (e) {}
      if (VUSB_PRESENT.read()) bat = 1;
      const m = process.memory(false), names = PAGES[k.tab] || [];
      bF.clear().setColor(1).drawLine(0, 1, 371, 1);
      names.forEach((p, i) => {
        if (i == k.page) bF.setColor(3).fillRect(i * 12, 10, i * 12 + 7, 17);
        else bF.setColor(2).drawRect(i * 12, 10, i * 12 + 7, 17);
      });
      bF.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString(names[k.page] || "", names.length * 12 + 6, 5);
      bF.setFontAlign(1, -1).setColor(2).drawString("PWR " + Math.round(bat * 100) + "   MEM " + Math.round(100 - (m.usage / m.total) * 100), 371, 5);
      showF();
    }

    // The film's title from the SD card, held for two seconds after the boot lines. Without the
    // picture there is no title screen.
    function splash(done) {
      bC.clear();
      if (!image("TITLE.IMG", 400, 40, 0, 70)) return done();
      bC.setColor(1).drawLine(60, 128, 340, 128);
      bC.setFontMonofonto16().setFontAlign(0, -1).setColor(2).drawString("ENDURANCE FLIGHT SYSTEMS", 200, 138).setFontAlign(-1, -1);
      showC();
      setTimeout(done, 2000);
    }

    return { pages: P, list, drawHeader, drawFooter, splash };
  },
});
