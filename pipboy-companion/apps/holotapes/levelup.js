// LEVEL UP: experience points for real tasks. Every item ticked off in DATA > LISTS (on the
// Pip-Boy, in Mojave UI or PIP-OS X, or on the companion's ID, lists & notes page) is worth
// 10 XP, counted once, the first time this holotape sees it done. Enough XP and you level up,
// with Vault Boy and the level-up sound from the SD card's LEVELUP folder (made from the
// official artwork and sound in assets/official: see README).
// Press the wheel: count again. Thumbwheel or mode dial: leave.
//
// XP is kept in USER/XP.json: { xp, level, seen: { <item id>: 1 } }. Unticking or deleting an
// item doesn't take XP away.
// A holotape: see hack.js for how these run.
// companion-holotape levelup 1
(function () {
  var fs = require("fs"), LISTS = "USER/customLists.json", SAVE = "USER/XP.json", EACH = 10;
  var st = { xp: 0, level: 1, seen: {} }, gained, done, total, up;

  /** Total XP needed to reach a level: 50 for level 2, 150 for 3, 300 for 4, ... */
  function need(l) { return 25 * l * (l - 1); }
  function levelFor(xp) { var l = 1; while (need(l + 1) <= xp) l++; return l; }

  function count() {
    var d, was = st.level;
    gained = done = total = 0;
    try { d = JSON.parse(fs.readFile(LISTS)); } catch (e) {}
    ((d && d.categories) || []).forEach(function (c) {
      ((c && c.items) || []).forEach(function (i) {
        if (!i) return;
        total++;
        if (!i.done) return;
        done++;
        if (i.id && !st.seen[i.id]) { st.seen[i.id] = 1; gained += EACH; }
      });
    });
    st.xp += gained;
    st.level = levelFor(st.xp);
    up = st.level > was;
    if (gained) try { fs.writeFile(SAVE, JSON.stringify(st)); } catch (e) {}
    if (up) try { Pip.audioStart("LEVELUP/LEVELUP.WAV"); } catch (e) {}
  }

  /** Copy a raw 2 bit image file into the page buffer, a row at a time. */
  function image(path, w, h, x, y) {
    var f, r, s, buf = new Uint8Array(bC.buffer), rb = w >> 2;
    try { f = E.openFile(path, "r"); } catch (e) {}
    if (!f) return;
    for (r = 0; r < h; r++) {
      s = f.read(rb);
      if (!s) break;
      buf.set(E.toUint8Array(s), (y + r) * 100 + (x >> 2));
    }
    f.close();
  }

  function draw() {
    var lo = need(st.level), hi = need(st.level + 1);
    bC.clear(1);
    image("LEVELUP/VAULTBOY.IMG", 100, 167, 16, 30);
    bC.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString("EXPERIENCE", 12, 4);
    bC.drawLine(12, 24, 388, 24);
    if (up) bC.setFontMonofonto23().drawString("LEVEL UP!", 140, 32);
    bC.setFontMonofonto36().setColor(3).drawString("LEVEL " + st.level, 140, 60);
    bC.setColor(1).drawRect(140, 108, 384, 122);
    if (st.xp > lo) bC.setColor(3).fillRect(142, 110, 142 + ((st.xp - lo) / (hi - lo)) * 240, 120);
    bC.setFontMonofonto16().setColor(2).drawString(st.xp + " / " + hi + " XP", 140, 128);
    bC.setColor(3).drawString(gained ? "+" + gained + " XP: " + gained / EACH + " NEW" : "NOTHING NEW YET", 140, 148);
    bC.setColor(2).drawString("TASKS DONE " + done + " OF " + total, 140, 168);
    bC.setColor(1).setFontAlign(1, -1).drawString("PRESS: COUNT AGAIN", 388, 192);
    bC.flip();
  }

  function knob(d) {
    if (d) return;
    count();
    draw();
  }

  try {
    var saved = JSON.parse(fs.readFile(SAVE));
    if (saved && saved.seen && saved.xp >= 0) st = { xp: saved.xp, level: levelFor(saved.xp), seen: saved.seen };
  } catch (e) {}
  if (Pip.removeSubmenu) Pip.removeSubmenu();
  Pip.on("knob1", knob);
  Pip.removeSubmenu = function () { Pip.removeListener("knob1", knob); };
  count();
  draw();
})();
