// LOCKPICKING: the bobby-pin lock from Fallout 3, New Vegas and 4, with the wheel alone.
// Somewhere over the top of the lock is a sweet spot. Turn the wheel to move the pin, press it
// to try the lock: the closer the pin, the further the lock turns before it binds. A try that
// binds wears the pin, and a worn pin breaks. Four locks, each with a smaller sweet spot.
// Wheel: move the pin. Press the wheel: turn the lock (or go on). Thumbwheel or mode dial: leave.
//
// A holotape: see hack.js for how these run.
// companion-holotape lockpick 1
(function () {
  var LEVELS = [["NOVICE", 14], ["ADVANCED", 10], ["EXPERT", 7], ["MASTER", 4]]; // name, sweet spot +/- degrees
  var STEP = 4, PINS = 5, WEAR = 4, CX = 118, CY = 112, R = 70;
  var level = 0, pins = PINS, wear, spot, pick, turned, msg, state; // state: 0 picking, 1 open, 2 out of pins

  function sound(f) { try { Pip.audioStart("UI/" + f + ".wav"); } catch (e) {} }

  function lock() {
    spot = 8 + Math.floor(Math.random() * 42) * STEP; // 8..172 degrees, 0 = left, 180 = right
    pick = 90;
    wear = WEAR;
    turned = 0;
    state = 0;
    msg = "FIND THE SWEET SPOT";
  }

  function draw() {
    var i, a = turned * Math.PI / 2, p = pick * Math.PI / 180, dx = Math.sin(a) * 34, dy = Math.cos(a) * 34;
    bC.clear(1).setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString("LOCKPICKING", 12, 4);
    bC.setColor(2).setFontAlign(1, -1).drawString("LOCK: " + LEVELS[level][0], 388, 4).setFontAlign(-1, -1);
    bC.setColor(3).drawLine(12, 24, 388, 24);
    bC.setColor(2).drawCircle(CX, CY, R).drawCircle(CX, CY, R - 5);
    bC.setColor(1).drawCircle(CX, CY, 40);
    // the keyway turns with the lock
    bC.setColor(3);
    for (i = -1; i <= 1; i++) bC.drawLine(CX - dx + i, CY - dy, CX + dx + i, CY + dy);
    // the bobby pin, from the keyway out over the top
    bC.drawLine(CX, CY, CX - Math.cos(p) * (R + 8), CY - Math.sin(p) * (R + 8));
    bC.fillCircle(CX - Math.cos(p) * (R + 8), CY - Math.sin(p) * (R + 8), 3);
    bC.setColor(2).drawString("BOBBY PINS", 226, 36);
    for (i = 0; i < PINS; i++) {
      if (i < pins) bC.setColor(3).fillRect(226 + i * 18, 58, 238 + i * 18, 70);
      else bC.setColor(1).drawRect(226 + i * 18, 58, 238 + i * 18, 70);
    }
    bC.setColor(2).drawString("THIS PIN", 226, 82);
    bC.setColor(1).drawRect(226, 104, 386, 116);
    if (wear > 0) bC.setColor(3).fillRect(228, 106, 228 + (wear / WEAR) * 156, 114);
    bC.setColor(3).drawString(msg, 226, 132);
    if (turned) bC.setColor(2).drawString("TURNED " + Math.round(turned * 100) + "%", 226, 152);
    bC.setColor(2).setFontAlign(0, -1).drawString(state ? "PRESS THE WHEEL TO GO ON" : "WHEEL: MOVE PIN   PRESS: TURN", 200, 192);
    bC.flip();
  }

  function tryLock() {
    var d = Math.abs(pick - spot), tol = LEVELS[level][1];
    if (d <= tol) {
      turned = 1;
      state = 1;
      msg = level < LEVELS.length - 1 ? "LOCK OPENED" : "MASTER LOCK OPENED";
      return sound("OK2");
    }
    turned = Math.max(0.05, 0.9 * (1 - (d - tol) / 60)); // binds sooner the further off the pin is
    if (--wear > 0) { msg = "IT BINDS"; return sound("CANCEL"); }
    pins--;
    wear = WEAR;
    msg = "THE PIN BROKE";
    if (!pins) { state = 2; msg = "OUT OF BOBBY PINS"; }
    sound("ALERT");
  }

  function knob(d) {
    if (d) {
      if (state) return;
      pick = E.clip(pick - (d > 0 ? STEP : -STEP), 0, 180);
      turned = 0;
      if (Pip.knob1Click) Pip.knob1Click(d);
    } else if (state) {
      if (state == 1) level = Math.min(level + 1, LEVELS.length - 1);
      else { level = 0; pins = PINS; }
      lock();
    } else tryLock();
    draw();
  }

  if (Pip.removeSubmenu) Pip.removeSubmenu();
  Pip.on("knob1", knob);
  Pip.removeSubmenu = function () { Pip.removeListener("knob1", knob); };
  lock();
  draw();
})();
