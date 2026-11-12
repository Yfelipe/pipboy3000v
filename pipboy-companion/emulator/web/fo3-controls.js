// FO3 prototype control test: the boot code the emulator gives the FO3 board (board SAPLING) when
// its Storage is empty, until FO3 firmware is added. Every control does something visible. It
// uses the FO3 firmware's own pin names, which web/sapling-boot0.js (run before this, as .boot0)
// puts on pins. The state is in global FO3 for tests.
//
//   STATS / ITEMS / DATA buttons: mode, with that button's lamp lit (LED_STATS/ITEMS/DATA)
//   page select knob (MODE_SELECTOR): page 1-5, decoded as the firmware does
//   left wheel (ENC1): moves the selection; its click (ENC1_PRESS) toggles LED_DOWNFIRE
//   top wheel (ENC2): a counter; power: counted
(function () {
  var MODES = ["STATS", "ITEMS", "DATA"];
  var PAGES = [
    ["STATUS", "S.P.E.C.I.A.L.", "SKILLS", "PERKS", "GENERAL"],
    ["WEAPONS", "APPAREL", "AID", "MISC", "AMMO"],
    ["LOCAL MAP", "WORLD MAP", "QUESTS", "NOTES", "RADIO"],
  ];
  var LAMPS = [LED_STATS, LED_ITEMS, LED_DATA];
  var S = global.FO3 = { mode: 0, page: 0, sel: 0, secondary: 0, light: false, power: 0, last: "" };

  function readPage() {
    // as the firmware: above 0.7 is the first page ... below 0.1 the fifth; over 0.9 is between positions
    var v = MODE_SELECTOR.analog();
    return v > 0.9 ? S.page : v < 0.1 ? 4 : v < 0.3 ? 3 : v < 0.5 ? 2 : v < 0.7 ? 1 : 0;
  }

  function draw() {
    g.clear().setColor(0, 1, 0);
    g.setFontMonofonto18().setFontAlign(0, -1).drawString("PIP-BOY 3000 (FO3) PROTOTYPE", 240, 8);
    g.setFontMonofonto16().drawString("CONTROL TEST  -  ADD FO3 FIRMWARE ON THE LOAD TAB", 240, 32);
    MODES.forEach(function (m, i) {
      var x = 90 + i * 150;
      g.setFontMonofonto23().setFontAlign(0, -1).drawString(m, x, 60);
      if (i == S.mode) g.drawRect(x - 56, 56, x + 56, 88);
    });
    g.setFontMonofonto16();
    PAGES[S.mode].forEach(function (p, i) {
      var on = i == S.page;
      g.setColor(on ? 1 : 0, on ? 1 : 0.5, on ? 1 : 0).setFontAlign(0, -1).drawString(p, 48 + i * 96, 270);
    });
    g.setColor(0, 1, 0).setFontAlign(-1, -1).setFontMonofonto18();
    [
      ["PAGE", (S.page + 1) + " " + PAGES[S.mode][S.page]],
      ["SELECTION", String(S.sel)],
      ["TOP WHEEL", String(S.secondary)],
      ["DOWNFIRE LED", S.light ? "ON" : "OFF"],
      ["POWER", String(S.power)],
      ["LAST", S.last],
    ].forEach(function (r, i) { g.drawString(r[0], 60, 104 + i * 26).drawString(r[1], 260, 104 + i * 26); });
  }

  function event(name) { S.last = name; draw(); }
  function setMode(i) {
    S.mode = i;
    LAMPS.forEach(function (l, k) { l.write(k == i); });
    event(MODES[i]);
  }

  pinMode(MEAS_ENB, "opendrain");
  MEAS_ENB.write(0);
  pinMode(ENC1_B, "input");
  pinMode(ENC2_B, "input");
  // the wheels, read the way the firmware reads them: for the left wheel, +1 is down the list
  setWatch(function (e) {
    if (!e.state) return;
    var d = e.state ^ e.data ? 1 : -1;
    S.sel += d;
    event(d > 0 ? "LEFT WHEEL DOWN" : "LEFT WHEEL UP");
  }, ENC1_A, { data: ENC1_B, edge: 0, repeat: true, debounce: 0 });
  setWatch(function (e) {
    var d = e.state ^ e.data ? 1 : -1;
    S.secondary += d;
    event(d > 0 ? "TOP WHEEL +" : "TOP WHEEL -");
  }, ENC2_A, { data: ENC2_B, edge: 1, repeat: true, debounce: 0 });
  setWatch(function () { S.light = !S.light; LED_DOWNFIRE.write(S.light); event("CLICK SELECT"); }, ENC1_PRESS, { edge: "rising", repeat: true, debounce: 20 });
  [BTN_STATS, BTN_ITEMS, BTN_DATA].forEach(function (b, i) {
    setWatch(function () { setMode(i); }, b, { edge: "rising", repeat: true, debounce: 30 });
  });
  setWatch(function () { S.power++; event("POWER"); }, BTN_POWER, { edge: "rising", repeat: true, debounce: 30 });
  setInterval(function () {
    var p = readPage();
    if (p != S.page) { S.page = p; event("PAGE " + (p + 1)); }
  }, 100);
  setMode(0);
})();
