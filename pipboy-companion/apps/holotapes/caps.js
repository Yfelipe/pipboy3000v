// CAP COLLECTOR: a small arcade game in the spirit of Fallout 4's holotape games (an original
// game, not a copy of one). Bottle caps and mini nukes fall from the sky. Slide the crate under
// the caps; a nuke in the crate costs a life. It speeds up as the caps add up.
// Wheel: move the crate. Press the wheel: start (or play again). Thumbwheel or mode dial: leave.
//
// A holotape: see hack.js for how these run. It animates with an interval, stopped on leaving.
// companion-holotape caps 1
(function () {
  var x, items, score, lives, tick, state = 0, timer, best = 0; // state: 0 title, 1 playing, 2 over

  function sound(f) { try { Pip.audioStart("UI/" + f + ".wav"); } catch (e) {} }

  function start() {
    x = 200;
    items = [];
    score = 0;
    lives = 3;
    tick = 0;
    state = 1;
    if (!timer) timer = setInterval(step, 110);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  function step() {
    var speed = Math.min(14, 5 + score / 4), i, it;
    if (tick++ % Math.max(4, 9 - (score >> 3)) == 0) items.push({ x: 24 + Math.floor(Math.random() * 352), y: 30, nuke: Math.random() < 0.3 });
    for (i = items.length - 1; i >= 0; i--) {
      it = items[i];
      it.y += speed;
      if (it.y < 176) continue;
      items.splice(i, 1);
      if (Math.abs(it.x - x) > 26) continue; // missed the crate
      if (it.nuke) { lives--; sound("ALERT"); } else { score++; sound("OK"); }
    }
    if (lives <= 0) {
      state = 2;
      best = Math.max(best, score);
      stop();
    }
    draw();
  }

  function draw() {
    var i;
    bC.clear(1).setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString("CAP COLLECTOR", 12, 4);
    if (state) {
      bC.setColor(2).drawString("CAPS " + score, 200, 4);
      for (i = 0; i < 3; i++) {
        if (i < lives) bC.setColor(3).fillRect(334 + i * 18, 6, 346 + i * 18, 18);
        else bC.setColor(1).drawRect(334 + i * 18, 6, 346 + i * 18, 18);
      }
    }
    bC.setColor(3).drawLine(12, 24, 388, 24);
    if (state == 1) {
      items.forEach(function (it) {
        if (it.nuke) bC.setColor(3).fillPoly([it.x, it.y + 8, it.x - 6, it.y - 4, it.x + 6, it.y - 4]).fillRect(it.x - 2, it.y - 9, it.x + 2, it.y - 4);
        else bC.setColor(2).fillCircle(it.x, it.y, 5).setColor(0).fillCircle(it.x, it.y, 2);
      });
      bC.setColor(3).drawRect(x - 24, 180, x + 24, 194).drawLine(x - 24, 186, x + 24, 186);
    } else {
      bC.setFontAlign(0, -1).setColor(3);
      if (state == 2) bC.drawString("GAME OVER", 200, 60).drawString(score + " CAPS   BEST " + best, 200, 84);
      else bC.drawString("CATCH THE CAPS. DODGE THE NUKES.", 200, 72);
      bC.setColor(2).drawString("(o) CAP        \\/ MINI NUKE", 200, 120);
    }
    bC.setColor(2).setFontAlign(0, -1);
    if (state != 1) bC.drawString(state ? "PRESS THE WHEEL TO PLAY AGAIN" : "WHEEL: MOVE   PRESS: START", 200, 172);
    bC.flip();
  }

  function knob(d) {
    if (d) {
      if (state == 1) x = E.clip(x - (d > 0 ? 22 : -22), 26, 374); // wheel up: left
    } else if (state != 1) start();
    draw();
  }

  if (Pip.removeSubmenu) Pip.removeSubmenu();
  Pip.on("knob1", knob);
  Pip.removeSubmenu = function () { stop(); Pip.removeListener("knob1", knob); };
  draw();
})();
