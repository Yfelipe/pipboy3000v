// RADIO: your companion stations as presets in the stock radio menu, tuned with one press.
// The stations come from the companion's Radio presets page ("Send to Pip-Boy" writes
// companion-radio.json to Storage).
// companion-extension radio 1
(function () {
  var list = require("Storage").readJSON("companion-radio.json", true);
  if (!Array.isArray(list) || !list.length) return;
  var stations = list.map(function (p) { return { name: String(p.name || "").toUpperCase(), f: +p.frequency }; })
    .filter(function (s) { return s.f >= 87.5 && s.f <= 108; }).slice(0, 12);
  if (!stations.length) return;
  function tune(f) {
    try {
      if (!rd.isOn()) { Pip.radioKPSS = false; rd.enable(true); }
      rd.freq = f;
      rd.freqSet(f);
      rd.drawFreq();
    } catch (e) { log("Radio preset " + f + ": " + e); }
  }
  var stockRadio = submenuRadio;
  submenuRadio = function () {
    var show = E.showMenu;
    E.showMenu = function (menu) {
      E.showMenu = show;
      stations.forEach(function (s) { menu[s.name.slice(0, 9) + " " + s.f.toFixed(1)] = function () { tune(s.f); }; });
      return show(menu);
    };
    try { stockRadio(); } finally { E.showMenu = show; }
  };
  MODEINFO[5].fn = submenuRadio;
})();
