// Pip-Boy Companion starter: the boot code of the emulator's starter Pip-Boy (emulator/starter).
// There's no Pip-OS here: it belongs to The Wand Company, so it isn't in this project. This
// menu opens the companion's own apps and holotapes instead. To run the stock interface, add the
// official Pip-OS update on the emulator's Load tab (it comes from https://www.thewandcompany.com/pip-boy/upgrade/).
// Wheel: choose; press the wheel: open. The power button comes back here.
//
// Holotapes (USER/*.JS on the SD card, apps/holotapes) are written for the stock interface: they
// draw into its page buffer, bC, and take the wheel from Pip's "knob1" event. This menu stands in
// for both, so they run here as they do from INV > APPS. runHolotape(file) opens one directly
// (the emulator page's Run button uses it).
(function () {
  var S = require("Storage"), fs = require("fs");
  var W = g.getWidth(), ROWS = 4, sel = 0, top = 0, running = null;
  // [name, what opens it, note, is a holotape]
  var apps = [["MOJAVE UI", "mojave.min.js", "NEW VEGAS"], ["PIP-OS X", "pipos-x.min.js", "CONCEPT"], ["CAPITAL UI", "capital.min.js", "FALLOUT 3"], ["PIP-BOY 2000", "pip2000.min.js", "FALLOUT 1 & 2"], ["ENDURANCE", "endurance.min.js", "INTERSTELLAR"], ["TARS", "tars.min.js", "INTERSTELLAR"]]
    .filter(function (a) { return S.read(a[1]) !== undefined; });
  try {
    fs.readdirSync("USER").filter(function (f) { return /\.JS$/.test(f); }).sort().forEach(function (f) {
      if (String(fs.readFile("USER/" + f)).indexOf("companion-holotape") < 0) return; // a load() launcher
      var name = f.slice(0, -3);
      try { name = JSON.parse(fs.readFile("APPINFO/" + name + ".json")).name || name; } catch (e) {}
      apps.push([name, f, "HOLOTAPE", true]);
    });
  } catch (e) {}

  function draw() {
    var fg = g.theme.fg;
    g.clear().setColor(fg).setFontMonofonto23().setFontAlign(0, -1).drawString("PIP-BOY COMPANION", W / 2, 34);
    g.setFontMonofonto16().drawString("EMULATOR STARTER", W / 2, 64);
    g.drawLine(60, 92, W - 60, 92);
    g.setFontMonofonto18();
    apps.slice(top, top + ROWS).forEach(function (a, k) {
      var y = 100 + k * 30;
      if (top + k == sel) g.fillRect(60, y, W - 60, y + 26).setColor(0);
      g.setFontAlign(-1, -1).drawString(a[0], 76, y + 4);
      g.setFontMonofonto16().setFontAlign(1, -1).drawString(a[2], W - 76, y + 6).setFontMonofonto18().setColor(fg);
    });
    if (!apps.length) g.setFontAlign(0, -1).drawString("NO APPS IN STORAGE", W / 2, 130);
    g.setFontMonofonto16().setFontAlign(0, -1);
    if (apps.length > ROWS) g.drawString((sel + 1) + " OF " + apps.length, W / 2, 222);
    g.drawString("WHEEL: CHOOSE   PRESS: OPEN", W / 2, 240);
    g.drawString("NO PIP-OS HERE: ADD THE OFFICIAL UPDATE", W / 2, 258);
    g.drawString("ON THE EMULATOR'S LOAD TAB. GET IT AT", W / 2, 274);
    g.drawString("THEWANDCOMPANY.COM/PIP-BOY/UPGRADE", W / 2, 290);
  }

  // The stock interface's page buffer and its green palette, made when the first holotape opens
  function pageBuffer() {
    if (global.bC) return;
    global.bC = Graphics.createArrayBuffer(400, 210, 2, { msb: true, buffer: E.toArrayBuffer(E.memoryArea(0x10008000, 21000)) });
    bC.flip = function () { Pip.blitImage(bC, 40, 65); };
    Pip.setPalette([0.86, 0.65, 1, 0.75].map(function (k) {
      var row = new Uint16Array(16);
      for (var i = 0; i < 16; i++) row[i] = ((0.2 * (i / 15) * k * 31) << 11) | (((i / 15) * k * 63) << 5) | (0.3 * (i / 15) * k * 31);
      return row;
    }));
  }

  // No Pip-OS, so no radio object either: a pretend one with three stations over some noise,
  // so the FM scan holotape has something to find here
  function demoRadio() {
    if (typeof rd != "undefined") return;
    global.rd = {
      f: 87.5,
      enable: function (on) { Pip.radioOn = !!on; },
      freqSet: function (f) { this.f = f; },
      getRSSI: function () {
        var f = this.f, s = 10 + Math.random() * 4;
        [[88.9, 38], [96.3, 52], [101.7, 60]].forEach(function (st) { s += st[1] * Math.max(0, 1 - Math.abs(f - st[0]) / 0.25); });
        return s;
      },
    };
  }

  function leave() {
    if (!running) return;
    if (Pip.removeSubmenu) Pip.removeSubmenu();
    delete Pip.removeSubmenu;
    running = null;
    draw();
  }

  global.runHolotape = function (file) {
    leave();
    pageBuffer();
    demoRadio();
    running = file;
    g.clear().setColor(g.theme.fg).setFontMonofonto16().setFontAlign(0, -1);
    g.drawString("HOLOTAPE: " + file.slice(0, -3), W / 2, 34);
    g.drawString("POWER BUTTON: BACK TO THE MENU", W / 2, 290);
    eval(fs.readFile("USER/" + file));
  };

  function open() {
    var a = apps[sel];
    if (!a) return;
    if (a[3]) runHolotape(a[1]);
    else load(a[1]);
  }

  pinMode(BTN9, "input");
  setWatch(function (e) {
    var d = e.state ^ e.data ? 1 : -1; // 1: down the list
    if (running) return Pip.emit("knob1", -d); // the firmware's wheel event: positive is up
    if (!apps.length) return;
    sel = (sel + apps.length + d) % apps.length;
    top = E.clip(top, sel - ROWS + 1, sel);
    draw();
  }, BTN8, { data: BTN9, edge: 1, repeat: true, debounce: 0 });
  setWatch(function () { if (running) Pip.emit("knob1", 0); else open(); }, BTN7, { edge: "rising", repeat: true, debounce: 20 });
  setWatch(leave, BTN10, { edge: "rising", repeat: true, debounce: 20 });
  draw();
})();
