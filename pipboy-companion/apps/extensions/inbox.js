// STAT > INBOX: messages sent from the Pip-Boy Companion, kept on the SD card in
// USER/MESSAGES.json as [{ text, at, read }]. Unread ones are marked with a dot.
// companion-extension inbox 1
(function () {
  var FILE = "USER/MESSAGES.json", fs = require("fs");
  function load() {
    try { var d = JSON.parse(fs.readFile(FILE)); return Array.isArray(d) ? d : []; } catch (e) { return []; }
  }
  function save(list) { try { fs.writeFile(FILE, JSON.stringify(list)); } catch (e) {} }
  function when(t) {
    var d = new Date(t), two = function (n) { return ("0" + n).substr(-2); };
    return two(d.getDate()) + "." + two(d.getMonth() + 1) + " " + two(d.getHours()) + ":" + two(d.getMinutes());
  }
  function show(list, i) {
    var m = list[i], top = 0, rows = 7;
    if (!m.read) { m.read = true; save(list); }
    var lines = bC.setFontMonofonto18().wrapString(String(m.text), 376);
    function draw() {
      bC.clear(1).setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString("RECEIVED " + when(m.at), 12, 4);
      bC.setColor(3).drawLine(12, 24, 388, 24).setFontMonofonto18();
      lines.slice(top, top + rows).forEach(function (l, k) { bC.drawString(l, 12, 32 + k * 22); });
      bC.setFontMonofonto16().setColor(2).setFontAlign(0, -1).drawString(lines.length > rows ? "WHEEL: SCROLL   PRESS: BACK" : "PRESS THE WHEEL TO GO BACK", 200, 190);
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
    var list = load();
    if (!list.length) return submenuBlank("NO MESSAGES\n\nSEND ONE FROM THE\nPIP-BOY COMPANION")();
    var items = { "": { title: "INBOX" } };
    for (var i = list.length - 1; i >= 0; i--) (function (i) {
      var m = list[i];
      items["m" + i] = { title: (m.read ? "  " : "* ") + String(m.text).split("\n")[0], format: function () { return when(m.at); }, onchange: function () { show(list, i); } };
    })(i);
    E.showMenu(items);
  }
  MODEINFO[1].submenu.INBOX = menu; // STAT has room in its header for a fourth name
})();
