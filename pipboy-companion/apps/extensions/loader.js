// Pip-Boy Companion extension loader (companion-loader 2), kept in Storage as .boot0.
// Espruino runs .boot0-.boot3 before the firmware's .bootcde. Pip-OS clears every timer when
// it starts, so extensions run from the "init" event, once Pip-OS has loaded, and only when
// Pip-OS is what's running (not an app). Each Storage file ext.<id>.js is one extension.
// Hold the torch button while the Pip-Boy starts to skip them all.
if (!BTN4.read()) E.on("init", function () {
  if (typeof MODEINFO == "undefined") return;
  var S = require("Storage");
  S.list(/^ext\..+\.js$/).forEach(function (f) {
    try { eval(S.read(f)); }
    catch (e) { (typeof log == "function" ? log : print)("Extension " + f + " failed: " + e); }
  });
  // The stock header has room for about five screen names under each tab. When extensions
  // add more, scroll that row so the current screen's name is always in view.
  if (typeof drawHeader != "function") return;
  var stockHeader = drawHeader;
  drawHeader = function (mode) {
    stockHeader(mode);
    var m = MODEINFO[mode];
    if (!m || !m.submenu) return;
    var names = Object.keys(m.submenu), room = 320;
    bH.setFontMonofonto18().setFontAlign(-1, -1);
    var w = names.map(function (n) { return bH.stringWidth(n) + 10; });
    var total = w.reduce(function (a, b) { return a + b; }, 0);
    if (total <= room) return;
    var before = 0;
    for (var i = 0; i < sm0; i++) before += w[i];
    var x = 50 - E.clip(before + w[sm0] - room, 0, total - room);
    bH.setColor(0).fillRect(48, 31, 369, 50);
    names.forEach(function (n, i) {
      if (x >= 48 && x + w[i] - 10 <= 370) bH.setColor(15 / (1 + Math.abs(i - sm0))).drawString(n, x, 34);
      x += w[i];
    });
    bH.flip();
  };
});
