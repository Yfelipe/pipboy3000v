// DATA > NOTES: text notes from the SD card's NOTES folder (*.txt), as holotape-style reading.
// Make and edit them on the companion's "ID, lists & notes" page, or copy .txt files there.
// companion-extension notes 1
(function () {
  var fs = require("fs");
  function files() {
    try { return fs.readdirSync("NOTES").filter(function (f) { return f[0] != "." && /\.txt$/i.test(f); }).sort(); } catch (e) { return []; }
  }
  function title(f) { return f.slice(0, -4).replace(/[_-]+/g, " ").toUpperCase(); }
  function read(f) {
    var lines = [];
    var text = "";
    try { text = String(fs.readFile("NOTES/" + f) || ""); } catch (e) {}
    bC.setFontMonofonto18();
    text.replace(/\r/g, "").split("\n").forEach(function (p) { lines = lines.concat(p ? bC.wrapString(p, 376) : [""]); });
    var top = 0, rows = 7;
    function draw() {
      bC.clear(1).setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString(title(f), 12, 4);
      bC.setColor(3).drawLine(12, 24, 388, 24).setFontMonofonto18();
      lines.slice(top, top + rows).forEach(function (l, k) { bC.drawString(l, 12, 32 + k * 22); });
      bC.setFontMonofonto16().setColor(2).setFontAlign(0, -1).drawString(lines.length > rows ? "WHEEL: SCROLL   PRESS: BACK" : "PRESS THE WHEEL TO GO BACK", 200, 190);
      if (lines.length > rows) bC.setColor(1).fillRect(394, 32 + (top / (lines.length - rows)) * 140, 398, 46 + (top / (lines.length - rows)) * 140);
      bC.flip();
    }
    function knob(d) {
      if (d) { top = E.clip(top - d, 0, Math.max(0, lines.length - rows)); draw(); }
      else { Pip.knob1Click(0); menu(); }
    }
    Pip.removeSubmenu && Pip.removeSubmenu();
    Pip.on("knob1", knob);
    Pip.removeSubmenu = function () { Pip.removeListener("knob1", knob); };
    draw();
  }
  function menu() {
    var list = files();
    if (!list.length) return submenuBlank("NO NOTES\n\nMAKE THEM WITH THE\nPIP-BOY COMPANION")();
    var items = { "": { title: "NOTES" } };
    list.forEach(function (f) { items[title(f)] = function () { read(f); }; });
    E.showMenu(items);
  }
  MODEINFO[3].submenu.NOTES = menu;
})();
