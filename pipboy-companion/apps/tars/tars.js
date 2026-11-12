// TARS — an alternative Pip-Boy 3000 Mk V interface based on the robot in Christopher Nolan's film
// Interstellar (2014). Where Endurance (../endurance) is the ship's console, here the Pip-Boy is
// the robot, and it talks to you.
//
// The look comes from the robot's build: four hinged slabs. Every screen is four tall panels with
// pinned joints between them, and the one you are adjusting swings down out of line. Under every
// screen is one line the robot says about it, chosen by its settings (honest, joking or evasive);
// a cue light in the header is lit while it is joking. Its four settings are always in the header,
// and are shared with Endurance's SHIP > ROBOT page (Storage file robot.json).
// It starts with a console like the small text display the robot carries. Every line it says
// is written for this app: none is from the film.
//
//   STATUS    the four segments as gauges: battery, memory, flash, temperature
//   KIT       ID, media remote
//   SETTINGS  humor, honesty, trust and discretion, a slab each; ASK, a question and its answer;
//             and the shared NOTES, INBOX, FEEDS, LISTS and SYSTEM
//   DOCK      a game: match the ring's spin with the thumbwheel, line the port up, press to dock
//   COMMS     FM presets, and messages flashed in Morse code across the screen
//
// The wheels, dial, radio, settings and companion extras are the shared engine
// (../shared/engine.js). Install: write tars.min.js (./build.sh) to Storage under that name, then
// load("tars.min.js"); sd/USER/TARS.JS adds it to the stock INV > APPS menu.

import { run } from "../shared/engine.js";

run({
  settingsFile: "tars.json",
  extFile: "USER/TARS.EXT",
  themes: [
    { name: "WHITE", rgb: [0.92, 0.95, 1] },     // the robot's display
    { name: "GREEN", rgb: [0.45, 1, 0.55] },
    { name: "AMBER", rgb: [1, 0.72, 0.3] },
    { name: "PIP-BOY", rgb: [0.2, 1, 0.3], stock: true }, // the stock interface's own colour
  ],
  pages: [["STATUS"], ["ID"], ["SETTINGS", "ASK", "FEEDS", "LISTS", "SYSTEM"], ["DOCK"], ["COMMS"]],
  bootLines: [], // its own console instead (splash, below)
  build(k) {
    // (one by one: Espruino has no destructuring)
    const bC = k.bC, showC = k.showC, bH = k.bH, bF = k.bF, showH = k.showH, showF = k.showF, sound = k.sound, THEMES = k.THEMES, cfg = k.cfg, save = k.save, applyTheme = k.applyTheme, backlight = k.backlight, exitToStock = k.exitToStock, playing = k.playing, stopRadio = k.stopRadio, play = k.play, PAGES = k.PAGES, VBAT_MEAS = k.VBAT_MEAS, VUSB_PRESENT = k.VUSB_PRESENT;
    const P = {};
    const SX = [0, 102, 204, 306], SW = 94; // the four slabs, with 8 pixel joints between
    const NAMES = ["HUMOR", "HONESTY", "TRUST", "DISCRETION"];

    // ------------------------------------------------------------------ the robot's settings

    // [humor, honesty, trust, discretion] in percent, shared with Endurance (robot.json)
    let R = require("Storage").readJSON("robot.json", true);
    if (!Array.isArray(R) || R.length != 4) R = [75, 90, 60, 50];
    const saveR = () => require("Storage").writeJSON("robot.json", R);
    const pick = (a) => a[(Math.random() * a.length) | 0];

    // What it is saying now: { t: text, joke }. The footer shows it and the cue light follows joke.
    let line = { t: "", joke: false }, lineFor = "";

    /**
     * Choose a line from three sets: blunt (said when honesty is high), joke (more often the
     * higher humor is) and evasive (low honesty). Each set is a list; one is picked at random.
     */
    function say(blunt, joke, evasive) {
      if (joke && Math.random() * 100 < R[0] * 0.8) return { t: pick(joke), joke: true };
      if (R[1] >= 60 || !evasive) return { t: pick(blunt), joke: false };
      return { t: pick(evasive), joke: false };
    }

    /** Say something new and show it (header for the cue light, footer for the words). */
    function speak(l) {
      line = l;
      drawHeader();
      drawFooter();
    }

    // ------------------------------------------------------------------ drawing helpers

    /** One slab: an outline with a highlight down its left edge, dropped by `drop` pixels. */
    function slab(b, i, drop, on) {
      const x = SX[i];
      b.setColor(on ? 3 : 1).drawRect(x, drop, x + SW - 1, 197 + drop);
      b.drawLine(x + 3, drop + 3, x + 3, 194 + drop);
      if (i < 3) b.setColor(2).fillRect(x + SW + 2, 60, x + SW + 5, 66).fillRect(x + SW + 2, 140, x + SW + 5, 146); // the hinge pins
    }

    /** A centred label in Monofonto16. */
    function lab(b, t, x, y, col) {
      b.setFontMonofonto16().setFontAlign(0, -1).setColor(col).drawString(t, x, y);
    }

    /** A vertical gauge of horizontal bars, filled from the bottom to frac. */
    function gauge(b, x, top, bot, frac) {
      const h = Math.round((bot - top) * E.clip(frac, 0, 1));
      for (let y = bot; y > top; y -= 4) b.setColor(y > bot - h ? 3 : 1)[y > bot - h ? "fillRect" : "drawRect"](x + 16, y - 2, x + SW - 17, y - (y > bot - h ? 0 : 2));
    }

    /** A scrolling list, the rows ruled, a square marking the current one. items: [{t, v}] */
    function list(b, items, x, y, w, rows, rowH) {
      const first = E.clip(k.sel - (rows >> 1), 0, Math.max(0, items.length - rows));
      b.setFontMonofonto16();
      for (let i = 0; i < rows && first + i < items.length; i++) {
        const it = items[first + i], yy = y + i * rowH, on = first + i == k.sel, ty = yy + ((rowH - 18) >> 1);
        b.setColor(1).drawLine(x + 8, yy + rowH - 2, x + w - 10, yy + rowH - 2);
        if (on) b.setColor(3).fillRect(x + 8, ty + 5, x + 14, ty + 11);
        b.setColor(on ? 3 : 2).setFontAlign(-1, -1).drawString(it.t, x + 22, ty);
        if (it.v !== undefined) b.setFontAlign(1, -1).drawString(it.v, x + w - 12, ty);
      }
      b.setFontAlign(-1, -1);
    }

    // ------------------------------------------------------------------ STATUS

    function readings() {
      let bat = 1, temp = 0, fl = { totalBytes: 131072, freeBytes: 0 };
      try { bat = E.clip((analogRead(VBAT_MEAS) * 2 * E.getAnalogVRef() - 3.5) / 0.6, 0, 1); } catch (e) {}
      if (VUSB_PRESENT.read()) bat = 1;
      try { temp = Math.round(E.getTemperature()); } catch (e) {}
      if (!isFinite(temp)) temp = "--";
      const S = require("Storage");
      try { fl = S.getStats ? S.getStats() : { totalBytes: 131072, freeBytes: S.getFree() }; } catch (e) {}
      const m = process.memory(false);
      return [
        ["PWR", Math.round(bat * 100), "%", bat],
        ["MEM", Math.round(100 - (m.usage / m.total) * 100), "% FREE", 1 - m.usage / m.total],
        ["FLASH", Math.round(fl.freeBytes / 1024), "KB FREE", fl.freeBytes / fl.totalBytes],
        ["TEMP", temp, "C", isFinite(temp) ? temp / 60 : 0],
      ];
    }

    P.STATUS = {
      build() {
        const r = readings();
        speak(r[0][1] < 20
          ? say(["POWER LOW. I'D PLUG IN SOON.", "UNDER 20%. FIND A CABLE."], ["LOW POWER. I'LL TALK SLOWER TO SAVE IT."], ["POWER'S FINE. MOSTLY."])
          : say(["ALL FOUR SEGMENTS NOMINAL.", "EVERYTHING READS IN RANGE.", "NO FAULTS. I CHECKED TWICE."],
                ["ALL SYSTEMS GO. EXCEPT MY DANCING.", "NOMINAL. AS IN BORING.", "FOUR SEGMENTS, ZERO COMPLAINTS. MINE."],
                ["NOTHING TO REPORT. NOTHING YOU NEED."]));
        return { r, at: Date.now() };
      },
      draw(b, d) {
        if (Date.now() - d.at > 5000) { d.r = readings(); d.at = Date.now(); }
        d.r.forEach((l, i) => {
          const x = SX[i], cx = x + SW / 2;
          slab(b, i, 0, false);
          lab(b, "SEG " + (i + 1), cx, 8, 1);
          lab(b, l[0], cx, 26, 2);
          b.setFontMonofonto36().setFontAlign(0, -1).setColor(3).drawString(l[1], cx, 46);
          lab(b, l[2], cx, 84, 2);
          gauge(b, x, 110, 188, l[3]);
        });
      },
    };

    // ------------------------------------------------------------------ SETTINGS

    // Press to take hold of a slab (it swings down), turn the wheel to change it, press to let go.
    const SETTING_LINES = [
      [["HUMOR {}%. I'LL KEEP IT LIGHT."], ["HUMOR {}%. BRACE YOURSELF."], ["HUMOR {}%. NOTED."]],
      [["HONESTY {}%. ASK ME ANYTHING."], ["HONESTY {}%. MOSTLY TRUE JOKES."], ["HONESTY {}%. I'LL BE TACTFUL."]],
      [["TRUST {}%. I'LL TAKE THE CONTROLS."], ["TRUST {}%. HANDS WHERE I CAN SEE THEM."], ["TRUST {}%. I'LL CHECK YOUR SUMS."]],
      [["DISCRETION {}%. MY LIPS ARE SEALED."], ["DISCRETION {}%. I HAVE NO LIPS."], ["DISCRETION {}%. I'LL TELL WHOEVER ASKS."]],
    ];
    function settingLine(i) {
      const s = SETTING_LINES[i], f = (a) => [a[0].replace("{}", R[i])];
      return say(f(s[0]), f(s[1]), f(s[2]));
    }

    P.SETTINGS = {
      build() {
        speak({ t: "PICK A SETTING. PRESS TO ADJUST IT.", joke: false });
        return { hold: false, drop: 0 };
      },
      draw(b, d) {
        d.drop = d.hold ? Math.min(12, d.drop + 4) : Math.max(0, d.drop - 4); // the swing
        R.forEach((v, i) => {
          const on = i == k.sel, dd = on ? d.drop : 0, x = SX[i], cx = x + SW / 2;
          slab(b, i, dd, on);
          lab(b, i == 3 ? "DISCRETN" : NAMES[i], cx, 8 + dd, on ? 3 : 2);
          b.setFontMonofonto36().setFontAlign(0, -1).setColor(on ? 3 : 2).drawString(v, cx, 30 + dd);
          lab(b, "%", cx, 66 + dd, 1);
          const top = 96 + dd, bot = 186 + dd;
          b.setColor(1).drawLine(cx, top, cx, bot);
          for (let t = 0; t <= 10; t++) b.drawLine(cx - (t % 5 ? 3 : 7), top + ((bot - top) * t) / 10, cx + (t % 5 ? 3 : 7), top + ((bot - top) * t) / 10);
          const y = bot - ((bot - top) * v) / 100;
          b.setColor(on ? 3 : 2).fillRect(cx - 16, y - 3, cx + 16, y + 3);
          if (on && d.hold && k.frame & 4) b.drawRect(x + 6, bot + 4, x + SW - 7, bot + 6);
        });
      },
      onKnob(dir, d) {
        if (d.hold) R[k.sel] = E.clip(R[k.sel] + dir * 5, 0, 100);
        else k.sel = E.clip(k.sel - dir, 0, 3);
        sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
        if (d.hold) speak({ t: NAMES[k.sel] + " " + R[k.sel] + "%", joke: line.joke });
      },
      select(d) {
        d.hold = !d.hold;
        if (!d.hold) { saveR(); speak(settingLine(k.sel)); }
        else speak({ t: "ADJUSTING " + NAMES[k.sel] + ". WHEEL TO CHANGE.", joke: false });
        sound("OK");
      },
    };

    // ------------------------------------------------------------------ ASK

    // [question, blunt answers, jokes, evasive answers]. Each answer is up to six short lines.
    const QA = [
      ["STATUS REPORT", [["EVERY SYSTEM IS", "IN RANGE.", "", "I WOULD TELL YOU", "IF IT WASN'T."]], [["I'M FINE.", "THANKS FOR", "ASKING. NOBODY", "EVER ASKS."]], [["FINE.", "", "MOVING ON."]]],
      ["WHAT TIME IS IT?", [0], [0], [0]], // filled in when asked
      ["ARE WE LOST?", [["NO. WE ARE", "EXACTLY WHERE", "THE MAP SAYS.", "", "THE MAP IS", "WRONG."]], [["LOST IS A", "STRONG WORD.", "", "I PREFER", "EXPLORING."]], [["I KNOW", "WHERE WE ARE.", "", "MORE OR LESS."]]],
      ["TELL A JOKE", [["I DON'T TELL", "JOKES AT", "HUMOR " + "{H}%.", "", "TURN IT UP."]], [["WHAT DID THE", "ROBOT SAY TO", "THE VENDING", "MACHINE?", "", "NOTHING. RUDE."], ["I TRIED A", "JOKE ON THE", "TOASTER.", "", "IT DIDN'T", "WARM TO IT."], ["WHY DO", "ROBOTS NEVER", "PANIC?", "", "NERVES OF", "STEEL."]], [["NOT NOW."]]],
      ["CAN I TRUST YOU?", [["AT TRUST {T}%", "I TRUST YOU", "THAT MUCH.", "", "THE REST IS", "UP TO YOU."]], [["COMPLETELY.", "", "MOSTLY.", "", "SOMEWHAT."]], [["OF COURSE.", "", "WHY DO YOU", "ASK?"]]],
      ["WHO BUILT YOU?", [["A MARINE", "CORPS", "PROGRAM.", "", "THEN I WAS", "REASSIGNED."]], [["A COMMITTEE.", "", "YOU CAN TELL", "FROM THE", "SHAPE."]], [["THAT IS", "CLASSIFIED."]]],
      ["WHAT DO YOU DO?", [["FLY. LIFT.", "NAVIGATE.", "TELL YOU THE", "TRUTH, AT", "HONESTY {N}%."]], [["MOSTLY I", "STAND HERE", "LOOKING", "RECTANGULAR."]], [["WHATEVER", "IS NEEDED."]]],
      ["ANY ADVICE?", [["CHARGE ME", "BEFORE 20%.", "", "BACK UP", "YOUR SD CARD."]], [["NEVER TRUST", "A ROBOT", "WITH HUMOR", "OVER 90%."]], [["YOU'LL FIGURE", "IT OUT."]]],
      ["GOODNIGHT", [["GOODNIGHT.", "", "I'LL BE", "HERE."]], [["SLEEP WELL.", "", "I'LL WATCH", "THE STARS.", "AND THE", "FRIDGE."]], [["GOODNIGHT."]]],
    ];

    P.ASK = {
      build() {
        speak({ t: "ASK ME SOMETHING. PRESS TO ASK.", joke: false });
        return { answer: null };
      },
      draw(b, d) {
        b.setColor(1).drawRect(0, 0, 195, 197);
        list(b, QA.map((q) => ({ t: q[0] })), 0, 4, 196, 6, 32);
        b.setColor(3).drawRect(SX[2], 0, 399, 197).drawLine(SX[2] + 3, 3, SX[2] + 3, 194);
        b.setFontMonofonto16().setFontAlign(-1, -1).setColor(1).drawString(d.answer ? d.label : "HONESTY " + R[1] + "%", SX[2] + 14, 8);
        if (!d.answer) return b.setColor(2).drawString("PRESS TO ASK", SX[2] + 14, 92);
        b.setFontMonofonto18().setColor(3);
        d.answer.forEach((l, i) => b.drawString(l, SX[2] + 14, 36 + i * 25));
      },
      onKnob(dir, d) {
        const n = E.clip(k.sel - dir, 0, QA.length - 1);
        if (n == k.sel) return;
        k.sel = n;
        d.answer = null;
        sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
      },
      select(d) {
        const q = QA[k.sel];
        let a, joke = false;
        if (k.sel == 1) {
          const t = new Date(), h = t.getHours(), m = ("0" + t.getMinutes()).substr(-2);
          a = say([["IT IS", h + ":" + m + "."]], [["TIME TO", "BUY ME", "A WATCH.", "", "" + h + ":" + m + "."]], [["LATER THAN", "IT WAS."]]);
        } else a = say(q[1], q[2], q[3]);
        joke = a.joke;
        d.answer = a.t.map((l) => l.replace("{H}", R[0]).replace("{T}", R[2]).replace("{N}", R[1]));
        d.label = joke ? "HUMOR " + R[0] + "%" : R[1] >= 60 ? "HONESTY " + R[1] + "%" : "DISCRETION " + R[3] + "%";
        speak({ t: joke ? "THAT WAS A JOKE. THE LIGHT SAYS SO." : R[1] >= 60 ? "THAT'S THE TRUTH." : "THAT'S ALL I'LL SAY.", joke });
        sound("OK");
      },
    };

    // ------------------------------------------------------------------ SYSTEM

    P.SYSTEM = {
      build() {
        speak({ t: "THE THINGS I DON'T JOKE ABOUT.", joke: false });
        return [
          { t: "COLOUR", v: () => THEMES[cfg.theme].name, go: () => { cfg.theme = (cfg.theme + 1) % THEMES.length; applyTheme(); drawHeader(); drawFooter(); } },
          { t: "BRIGHTNESS", v: () => (cfg.bright + 1) + " OF 5", go: () => { cfg.bright = (cfg.bright + 1) % 5; backlight(); } },
          { t: "SOUNDS", v: () => cfg.sound ? "ON" : "OFF", go: () => { cfg.sound = !cfg.sound; } },
          { t: "RESET SETTINGS", v: () => "75/90/60/50", go: () => { R = [75, 90, 60, 50]; saveR(); } },
          { t: "RETURN TO STOCK UI", v: () => "", go: exitToStock },
        ];
      },
      draw(b, d) {
        b.setColor(1).drawRect(0, 0, 297, 197);
        list(b, d.map((o) => ({ t: o.t, v: o.v() })), 0, 4, 298, 5, 30);
        const m = process.memory(false);
        b.setColor(1).drawRect(SX[3], 0, 399, 197);
        [["FIRMWARE", process.env.VERSION], ["MEMORY", m.usage + "/" + m.total], ["BEST DOCK", cfg.best ? (cfg.best / 10).toFixed(1) + " S" : "-"]].forEach((r, i) => {
          lab(b, r[0], SX[3] + SW / 2, 14 + i * 60, 2);
          lab(b, r[1], SX[3] + SW / 2, 34 + i * 60, 3);
        });
      },
      select(d) { d[k.sel].go(); save(); sound("OK"); },
    };

    // ------------------------------------------------------------------ DOCK

    // The ring spins at a target rate. The thumbwheel sets your own spin; seen from your ship, the
    // ring turns at the difference, so when the rates match it stands still. Then the wheel nudges
    // your angle until the docking port is at the top, and a press docks. Too far out and it
    // misses (a second's penalty). The time is kept when it is your best (SYSTEM shows it).
    P.DOCK = {
      ownsKnob2: true,
      build() {
        const target = 50 + ((Math.random() * 25) | 0);
        speak(say(["MATCH THE SPIN WITH THE THUMBWHEEL."], ["MATCH THE SPIN. I'LL COUNT. QUIETLY."], ["SPIN UP. I'LL WATCH."]));
        return { target, yours: 0, rel: Math.random() * 360, t0: Date.now(), last: Date.now(), done: 0, penalty: 0, said: 0 };
      },
      draw(b, d) {
        const now = Date.now(), dt = (now - d.last) / 1000;
        d.last = now;
        const diff = d.target - d.yours;
        if (!d.done) d.rel = (d.rel + diff * 6 * dt + 360) % 360; // degrees: 1 rpm = 6 degrees a second
        const align = ((d.rel + 180) % 360) - 180; // the port's angle from the top, -180..180
        // what it says as you get closer
        const stage = d.done ? 3 : Math.abs(diff) > 1 ? 0 : Math.abs(align) > 5 ? 1 : 2;
        if (stage != d.said) {
          d.said = stage;
          speak([
            { t: "MATCH THE SPIN WITH THE THUMBWHEEL.", joke: false },
            { t: "SPIN MATCHED. WHEEL TO LINE UP THE PORT.", joke: false },
            say(["ALIGNED. PRESS TO DOCK."], ["ALIGNED. NOW OR NEVER. MOSTLY NOW."]),
            say(["DOCKED. " + (d.done / 10).toFixed(1) + " SECONDS."], ["DOCKED. NOT BAD FOR A HUMAN."]),
          ][stage]);
        }
        // the ring, from your ship: twelve modules and the port (a gap with brackets)
        const cx = 98, cy = 98;
        b.setColor(1).drawRect(0, 0, 195, 197);
        b.setColor(2).drawCircle(cx, cy, 78).drawCircle(cx, cy, 66);
        for (let i = 0; i < 12; i++) {
          const a = ((d.rel + i * 30 - 90) * Math.PI) / 180, x = cx + Math.cos(a) * 72, y = cy + Math.sin(a) * 72;
          if (i == 0) b.setColor(3).drawRect(x - 7, y - 7, x + 7, y + 7);
          else b.setColor(3).fillCircle(x, y, 4);
        }
        // your ship's port, fixed at the top
        b.setColor(stage >= 2 ? 3 : 2).fillPoly([cx - 6, 4, cx + 6, 4, cx, 14]);
        b.setColor(2).drawLine(cx, cy - 12, cx, cy + 12).drawLine(cx - 12, cy, cx + 12, cy);
        const t = d.done || Math.round((now - d.t0) / 100) + d.penalty;
        [["TARGET", d.target + " RPM", 0], ["YOURS", d.yours + " RPM", stage == 0], ["ALIGN", Math.round(align) + " DEG", stage == 1]].forEach((r, i) => {
          const x = SX[2], y = i * 50;
          b.setColor(r[2] ? 3 : 1).drawRect(x, y, 399, y + 44);
          b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString(r[0], x + 10, y + 4);
          b.setFontMonofonto23().setFontAlign(1, -1).setColor(3).drawString(r[1], 390, y + 18);
        });
        b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString(d.done ? "DOCKED" : "TIME", SX[2] + 10, 160);
        b.setFontMonofonto23().setFontAlign(1, -1).setColor(3).drawString((t / 10).toFixed(1) + " S", 390, 158).setFontAlign(-1, -1);
        if (d.done) b.setFontMonofonto16().setColor(1).drawString("PRESS: AGAIN", SX[2] + 10, 182);
      },
      onKnob2(dir, d) {
        if (d.done) return;
        d.yours = E.clip(d.yours + dir, 0, 99);
        sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
      },
      onKnob(dir, d) {
        if (d.done) return;
        d.rel = (d.rel - dir * 3 + 360) % 360;
        sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
      },
      select(d) {
        if (d.done) { Object.assign(d, this.build()); return; }
        const align = ((d.rel + 180) % 360) - 180;
        if (Math.abs(d.target - d.yours) <= 1 && Math.abs(align) <= 5) {
          d.done = Math.round((Date.now() - d.t0) / 100) + d.penalty;
          if (!cfg.best || d.done < cfg.best) { cfg.best = d.done; save(); }
          sound("OK");
        } else {
          d.penalty += 10;
          speak(say(["MISSED. ONE SECOND ADDED."], ["MISSED. I'LL PRETEND I DIDN'T SEE."], ["CLOSE ENOUGH. IT WASN'T."]));
          sound("CANCEL");
        }
      },
    };

    // ------------------------------------------------------------------ COMMS

    // FM: the dial and your presets (real FM). Morse: a message flashed across the whole content
    // area, a unit 200 ms, with the dots and dashes written beneath as they go.
    const CODE = { A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....", I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.", Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-", Y: "-.--", Z: "--..", 0: "-----", 1: ".----", 2: "..---", 3: "...--", 4: "....-", 5: ".....", 6: "-....", 7: "--...", 8: "---..", 9: "----." };
    /** On/off steps for a message: [on, units] pairs. */
    function morse(text) {
      const out = [];
      text.split("").forEach((ch, i) => {
        if (ch == " ") { out.push([0, 7]); return; }
        const c = CODE[ch];
        if (!c) return;
        if (i && text[i - 1] != " ") out.push([0, 3]);
        c.split("").forEach((s, j) => { if (j) out.push([0, 1]); out.push([1, s == "." ? 1 : 3]); });
      });
      return out;
    }

    P.COMMS = {
      build() {
        speak({ t: "FM BY PRESS. MORSE BY PRESS. SAME BUTTON.", joke: false });
        return (k.X ? [{ t: "FM DIAL", dial: 1 }].concat(k.X.presets().map((s) => ({ t: "FM " + s.f.toFixed(1) + " " + s.name, f: s.f }))) : [])
          .concat(["SOS", "HELLO", "ALL OK", "COME HOME", "STAY"].map((m) => ({ t: "MORSE " + m, m })));
      },
      draw(b, d) {
        const s = d.sending;
        if (s) {
          // where we are in the message
          let t = (Date.now() - s.t0) / 200, on = 0, done = true;
          for (let i = 0; i < s.steps.length; i++) { if (t < s.steps[i][1]) { on = s.steps[i][0]; done = false; break; } t -= s.steps[i][1]; }
          if (done) { d.sending = null; speak({ t: "SENT. NOBODY ANSWERED. YET.", joke: false }); }
          else if (on) return b.setColor(3).fillRect(0, 0, 399, 209); // the flash
          b.setFontMonofonto23().setFontAlign(0, -1).setColor(2).drawString(s.text, 200, 70);
          b.setFontMonofonto16().setColor(1).drawString(s.text.split("").map((c) => CODE[c] || "/").join(" "), 200, 110).setFontAlign(-1, -1);
          return;
        }
        b.setColor(1).drawRect(0, 0, 297, 197);
        list(b, d.map((s, i) => ({ t: s.t.length > 30 ? s.t.slice(0, 29) + "." : s.t, v: playing() && i == k.station && !s.m ? "ON" : undefined })), 0, 4, 298, 6, 32);
        b.setColor(1).drawRect(SX[3], 0, 399, 197);
        const fm = k.X && k.X.fm.on && k.X.fm;
        lab(b, "FM", SX[3] + SW / 2, 14, 2);
        lab(b, fm ? fm.freq.toFixed(1) : "OFF", SX[3] + SW / 2, 34, 3);
        lab(b, d[k.sel] && d[k.sel].m ? "FLASHES" : "PLAY", SX[3] + SW / 2, 150, 1);
        lab(b, d[k.sel] && d[k.sel].m ? "THE SCREEN" : "OR PRESS", SX[3] + SW / 2, 168, 1);
      },
      select(d) {
        const s = d[k.sel];
        if (d.sending) { d.sending = null; return; }
        if (s.m) { d.sending = { text: s.m, steps: morse(s.m), t0: Date.now() }; speak({ t: "SENDING " + s.m + ".", joke: false }); return; }
        if (playing() && k.station == k.sel) stopRadio();
        else { k.station = k.sel; play(d); }
      },
      play(d) { if (playing()) stopRadio(); else if (!d[k.sel].m) { k.station = k.sel; play(d); } },
      onKnob2(dir, d) {
        if (k.X && k.X.fm.on && d[k.station] && d[k.station].dial && k.station == k.sel) k.X.fm.tune(k.X.fm.freq + dir / 10);
      },
    };

    // ------------------------------------------------------------------ header & footer

    // What it says on the shared pages (ID, FEEDS, LISTS and the companion extras): [blunt, jokes]
    const SHARED = {
      ID: [["YOUR ID CARD, FROM THE SD CARD."], ["THAT'S YOU. GOOD LIKENESS. FOR A HUMAN."]],
      FEEDS: [["YOUR FEEDS. WHEEL TO FLIP THROUGH."], ["YOUR FEEDS. I DIDN'T READ THEM. MUCH."]],
      LISTS: [["YOUR LISTS. PRESS TO TICK ONE OFF."], ["I KEEP LISTS IN MY HEAD. I HAVE NO HEAD."]],
      NOTES: [["YOUR NOTES, FROM THE COMPANION."], ["NOTES. I PROMISE NOT TO PEEK."]],
      INBOX: [["MESSAGES FROM THE COMPANION."], ["MAIL. NONE OF IT FOR ME. AGAIN."]],
      REMOTE: [["MEDIA REMOTE. WHEEL AND PRESS."], ["REMOTE CONTROL. FINALLY, SOMETHING SMALLER."]],
    };

    // TARS and the page name; the settings beneath; at the right the cue light, lit while joking.
    function drawHeader() {
      const name = PAGES[k.tab] ? PAGES[k.tab][k.page] : "";
      if (name != lineFor) {
        lineFor = name;
        const s = SHARED[name];
        if (s) line = say(s[0], s[1]);
      }
      bH.clear().setFontMonofonto23().setFontAlign(-1, -1).setColor(3).drawString("TARS", 0, 4);
      bH.setFontMonofonto16().setColor(2).drawString(name || "", 64, 10);
      bH.setColor(1).drawString("HUMOR " + R[0] + "  HONESTY " + R[1] + "  TRUST " + R[2], 64, 30);
      bH.setFontAlign(1, -1).setColor(1).drawString("CUE", 342, 10);
      bH.setColor(line.joke ? 3 : 1);
      if (line.joke) bH.fillRect(350, 10, 366, 26); else bH.drawRect(350, 10, 366, 26);
      bH.setColor(1).drawLine(0, 50, 371, 50);
      showH();
    }

    // What it is saying, after a prompt.
    function drawFooter() {
      bF.clear().setColor(1).drawLine(0, 1, 371, 1);
      bF.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString("> " + (line.t || "..."), 0, 6);
      showF();
    }

    // ------------------------------------------------------------------ start-up console

    // A small console, as the robot carries on its front: its checks typed out a character at a
    // time with a block cursor, the settings read back, the cue light tested, then a first line.
    function splash(done) {
      const L = ["SELF TEST", "SEGMENTS 1-4 ...... LOCKED", "ACTUATORS ......... OK", "GYRO .............. OK"]
        .concat(R.map((v, i) => (NAMES[i] + " ............").substr(0, 19) + " " + v + "%"))
        .concat(["CUE LIGHT ......... TEST", "", "READY.", "> " + (R[0] > 50 ? "HELLO. JOKES ARE ON." : "HELLO.")]);
      const X0 = 76, Y0 = 26, ROWS = 7, W = 248, H = ROWS * 20 + 8;
      let li = 0, ch = 0, blink = 0;
      const t = setInterval(() => {
        // a few characters a tick; a pause at the end of each line
        if (li < L.length) { ch += 6; if (ch >= L[li].length + 4) { li++; ch = 0; if (li < L.length && L[li - 1]) sound("UP1"); } }
        else if (++blink > 20) { clearInterval(t); g.clear(); return done(); }
        // the display: a bezel with four screws, the name plate under it
        bC.clear().setColor(2).drawRect(X0 - 16, Y0 - 14, X0 + W + 12, Y0 + H + 10).setColor(1).drawRect(X0 - 8, Y0 - 6, X0 + W + 4, Y0 + H + 2);
        [[X0 - 12, Y0 - 10], [X0 + W + 8, Y0 - 10], [X0 - 12, Y0 + H + 6], [X0 + W + 8, Y0 + H + 6]].forEach((p) => bC.setColor(2).drawCircle(p[0], p[1], 2));
        for (let y = Y0 - 4; y < Y0 + H; y += 3) bC.setColor(1).drawLine(X0 + W - 2, y, X0 + W + 2, y); // the speaker grille at its edge
        bC.setFontMonofonto16().setFontAlign(0, -1).setColor(1).drawString("TARS  /  CONSOLE", 200, Y0 + H + 18);
        const first = Math.max(0, li - ROWS + 1);
        bC.setFontMonofonto16().setFontAlign(-1, -1);
        for (let r = first; r <= li && r < L.length; r++) {
          const s = r < li ? L[r] : L[r].substr(0, ch), y = Y0 + (r - first) * 20;
          bC.setColor(r == 0 || r == L.length - 1 ? 3 : 2).drawString(s, X0, y);
          if (r == li && (k.frame | (Date.now() >> 7)) & 1) bC.setColor(3).fillRect(X0 + s.length * 8, y + 2, X0 + s.length * 8 + 7, y + 15);
          if (L[r].indexOf("CUE LIGHT") == 0 && r < li && Date.now() & 256) bC.setColor(3).fillRect(X0 + W - 26, y + 2, X0 + W - 14, y + 14);
        }
        showC();
      }, 50);
    }

    return { pages: P, list, drawHeader, drawFooter, splash };
  },
});
