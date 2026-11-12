// FM SCAN: sweeps the FM band with the Pip-Boy's own radio, draws the signal strength across
// the dial and lists the strongest stations. Choose one to tune to it. The stations found are
// also saved on the SD card (USER/FMSCAN.json) for the companion's Radio presets page.
// Press the wheel: scan (or tune to the chosen station). Wheel: choose. Thumbwheel or mode dial: leave.
//
// A holotape: see hack.js for how these run. It needs the stock interface, which owns the radio
// (its rd object); the radio is left on only if it was on, or a station was chosen.
// companion-holotape fmscan 1
(function () {
  var LO = 875, HI = 1080, N = HI - LO + 1; // tenths of a MHz
  var levels = new Uint8Array(N), found = [], sel = 0, i = -1, timer, state = 0, wasOn, tuned; // state: 0 ready, 1 scanning, 2 done
  var radio = typeof rd == "object" && rd && rd.freqSet && rd.getRSSI ? rd : null;

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function scan() {
    wasOn = !!Pip.radioOn;
    if (!wasOn) radio.enable(true);
    found = [];
    tuned = undefined;
    i = -1;
    state = 1;
    stop();
    // one channel per tick: read the level of the channel set on the last tick, then move on
    timer = setInterval(function () {
      if (i >= 0) levels[i] = radio.getRSSI();
      if (++i < N) {
        radio.freqSet((LO + i) / 10);
        if (i % 8 == 0) draw();
        return;
      }
      stop();
      finish();
      draw();
    }, 50);
  }

  function finish() {
    var lo = 255, hi = 0, k, v, peaks = [];
    for (k = 0; k < N; k++) { lo = Math.min(lo, levels[k]); hi = Math.max(hi, levels[k]); }
    // a station: clearly above the floor, and the strongest channel within 0.2 MHz
    for (k = 0; k < N; k++) {
      v = levels[k];
      if (hi - lo < 6 || v < lo + (hi - lo) / 2) continue;
      if (v < (levels[k - 1] | 0) || v < (levels[k - 2] | 0) || v <= (levels[k + 1] | 0) || v <= (levels[k + 2] | 0)) continue;
      peaks.push({ frequency: (LO + k) / 10, level: v });
    }
    peaks.sort(function (a, b) { return b.level - a.level; });
    found = peaks.slice(0, 8).sort(function (a, b) { return a.frequency - b.frequency; });
    sel = 0;
    state = 2;
    try {
      require("fs").writeFile("USER/FMSCAN.json", JSON.stringify({ at: Date.now(), stations: found }));
    } catch (e) {}
    if (!wasOn) radio.enable(false);
  }

  function draw() {
    var k, lo = 255, hi = 0, n = state == 1 ? Math.max(i, 0) : N;
    bC.clear(1).setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString("FM SCAN", 12, 4);
    bC.setColor(2).setFontAlign(1, -1).drawString("87.5 - 108.0 MHZ", 388, 4).setFontAlign(-1, -1);
    bC.setColor(3).drawLine(12, 24, 388, 24);
    if (!radio) {
      bC.setFontAlign(0, -1).drawString("THE RADIO BELONGS TO THE STOCK", 200, 70).drawString("INTERFACE. RUN THIS FROM INV > APPS.", 200, 92);
      return bC.flip();
    }
    if (state) {
      for (k = 0; k < n; k++) { lo = Math.min(lo, levels[k]); hi = Math.max(hi, levels[k]); }
      bC.setColor(2);
      for (k = 0; k < n; k++) bC.drawLine(14 + k * 1.8, 96, 14 + k * 1.8, 96 - (hi > lo ? ((levels[k] - lo) / (hi - lo)) * 62 : 0));
      bC.setColor(1).drawLine(12, 98, 388, 98);
    }
    if (state == 1) bC.setColor(3).setFontAlign(0, -1).drawString("SCANNING " + ((LO + Math.max(i, 0)) / 10).toFixed(1), 200, 130);
    if (state == 2) {
      if (!found.length) bC.setColor(3).setFontAlign(0, -1).drawString("NO STATIONS FOUND", 200, 130);
      found.forEach(function (s, k) {
        var x = 20 + (k >> 2) * 190, y = 106 + (k & 3) * 19, t = s.frequency.toFixed(1) + " MHZ" + (tuned === k ? " <" : "");
        if (k == sel) bC.setColor(3).fillRect(x - 4, y - 1, x + 150, y + 16).setColor(0);
        else bC.setColor(3);
        bC.setFontAlign(-1, -1).drawString(t, x, y);
      });
    }
    bC.setColor(2).setFontAlign(0, -1).drawString(
      state == 0 ? "PRESS THE WHEEL TO SCAN (ABOUT 10 S)" : state == 1 ? "PRESS THE WHEEL TO STOP" : found.length ? "WHEEL: CHOOSE   PRESS: TUNE" : "PRESS THE WHEEL TO SCAN AGAIN", 200, 192);
    bC.flip();
  }

  function knob(d) {
    if (!radio) return;
    if (d) {
      if (state != 2 || !found.length) return;
      sel = (sel + found.length - (d > 0 ? 1 : -1)) % found.length;
    } else if (state == 1) {
      stop();
      state = 0;
      if (!wasOn) radio.enable(false);
    } else if (state == 2 && found.length) {
      if (!Pip.radioOn) radio.enable(true);
      radio.freqSet(found[sel].frequency);
      tuned = sel;
    } else scan();
    draw();
  }

  if (Pip.removeSubmenu) Pip.removeSubmenu();
  Pip.on("knob1", knob);
  Pip.removeSubmenu = function () {
    if (state == 1 && radio && !wasOn) radio.enable(false);
    stop();
    Pip.removeListener("knob1", knob);
  };
  draw();
})();
