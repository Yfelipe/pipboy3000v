// STAND CLOCK: a clock for when the Pip-Boy sits on its stand. Big time, the date, and a
// company logo from the SD card's CLOCK folder (2 bit images made from the official artwork
// in assets/official: see README). While USB power is connected it keeps the Pip-Boy awake.
// Wheel: change the face. Thumbwheel or mode dial: leave.
//
// A holotape: see hack.js for how these run.
// companion-holotape clock 1
(function () {
  // name, image in CLOCK/, its width and height (widths are multiples of 4: 2 bits a pixel)
  var FACES = [["VAULT-TEC", "VAULTTEC.IMG", 240, 83], ["ROBCO INDUSTRIES", "ROBCO.IMG", 240, 94], ["NUKA-COLA", "NUKACOLA.IMG", 240, 66], ["PIP-BOY 3000 MK V"]];
  var DAYS = "SUNDAY,MONDAY,TUESDAY,WEDNESDAY,THURSDAY,FRIDAY,SATURDAY".split(",");
  var MONTHS = "JAN,FEB,MAR,APR,MAY,JUN,JUL,AUG,SEP,OCT,NOV,DEC".split(",");
  var face = 0, shown = "", timer;

  /** Copy a raw 2 bit image file into the page buffer, a row at a time. False if it isn't there. */
  function image(file, w, h, x, y) {
    var f, r, s, buf = new Uint8Array(bC.buffer), rb = w >> 2;
    try { f = E.openFile("CLOCK/" + file, "r"); } catch (e) {}
    if (!f) return false;
    for (r = 0; r < h; r++) {
      s = f.read(rb);
      if (!s) break;
      buf.set(E.toUint8Array(s), (y + r) * 100 + (x >> 2));
    }
    f.close();
    return true;
  }

  function time(d) {
    var h = d.getHours(), m = ("0" + d.getMinutes()).slice(-2);
    if (typeof settings == "object" && settings && settings.clock12hr) return ((h + 11) % 12 + 1) + ":" + m + (h < 12 ? " AM" : " PM");
    return ("0" + h).slice(-2) + ":" + m;
  }

  function draw() {
    var d = new Date(), F = FACES[face];
    shown = time(d);
    bC.clear(1);
    if (!F[1] || !image(F[1], F[2], F[3], 80, 4 + ((96 - F[3]) >> 1))) {
      bC.setFontMonofonto23().setFontAlign(0, 0).setColor(2).drawString(F[0], 200, 52);
    }
    bC.setFontMonofonto36().setFontAlign(0, -1).setColor(3).drawString(shown, 200, 108);
    bC.setFontMonofonto18().setColor(2).drawString(DAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(), 200, 154);
    bC.setFontMonofonto16().setColor(1).drawString("WHEEL: CHANGE THE FACE", 200, 192);
    bC.flip();
  }

  function tick() {
    // on the stand (USB power): don't fall asleep
    if (typeof VUSB_PRESENT != "undefined" && VUSB_PRESENT.read() && Pip.kickIdleTimer) Pip.kickIdleTimer();
    if (time(new Date()) != shown) draw();
  }

  function knob(d) {
    if (!d) return;
    face = (face + FACES.length - (d > 0 ? 1 : -1)) % FACES.length;
    draw();
  }

  if (Pip.removeSubmenu) Pip.removeSubmenu();
  Pip.on("knob1", knob);
  timer = setInterval(tick, 5000);
  Pip.removeSubmenu = function () { clearInterval(timer); Pip.removeListener("knob1", knob); };
  draw();
})();
