// TERMINAL HACKING: the word puzzle from the terminals of Fallout 3, New Vegas and 4.
// One of the words on screen is the password. Each guess shows its likeness: how many letters
// are right and in the right place. Four attempts, then the terminal locks.
// Wheel: choose a word. Press the wheel: guess (or play again). Thumbwheel or mode dial: leave.
//
// A holotape: it runs from the SD card (INV > APPS in the stock interface runs USER/*.JS), so it
// costs no Storage. It draws into the stock interface's page buffer (bC) and takes over the
// wheel until Pip.removeSubmenu is called, like the firmware's own pages.
// companion-holotape hack 1
(function () {
  var WORDS = ("ACCESS,ARMORY,ATOMIC,BANDIT,BARTER,BEACON,BOTTLE,BUNKER,CANYON,CASINO,COLONY,COMBAT,CRATES,DANGER," +
    "DEPUTY,DESERT,ENERGY,ENGINE,FERALS,FUSION,GEIGER,GHOULS,HAZARD,HELMET,HUNTER,KNIGHT,LEGION,LOCKER,MEDICS," +
    "MOJAVE,MUTANT,OUTLAW,PATROL,PISTOL,PLASMA,POISON,RADIUM,RAIDER,RANGER,RATION,RELICS,RIFLES,ROBOTS,ROCKET," +
    "RUBBLE,SALOON,SCRAPS,SCRIBE,SECURE,SENSOR,SENTRY,SEWERS,SHIELD,SIGNAL,SNIPER,SQUIRE,SUPPLY,SYSTEM,TARGET," +
    "TRADER,TUNNEL,TURRET,VAULTS,WASTES,WRENCH").split(",");
  var COUNT = 8, TRIES = 4;
  var words, answer, tried, log, tries, sel, state; // state: 0 playing, 1 in, 2 locked out

  function likeness(a, b) {
    var n = 0;
    for (var i = 0; i < a.length; i++) if (a[i] == b[i]) n++;
    return n;
  }
  function sound(f) { try { Pip.audioStart("UI/" + f + ".wav"); } catch (e) {} }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1)), t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  // The password, up to four words that share a letter with it in the same place (so a guess
  // tells you something), and the rest at random
  function deal() {
    var pool = shuffle(WORDS.slice());
    answer = pool.pop();
    var near = pool.filter(function (w) { return likeness(w, answer); }).slice(0, 4);
    var rest = pool.filter(function (w) { return near.indexOf(w) < 0; });
    words = shuffle([answer].concat(near, rest.slice(0, COUNT - 1 - near.length)));
    tried = [];
    log = [];
    tries = TRIES;
    sel = 0;
    state = 0;
  }

  function draw() {
    var i, y;
    bC.clear(1).setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString("ROBCO TERMLINK", 12, 4);
    bC.setColor(2).drawString("ATTEMPTS", 236, 4);
    for (i = 0; i < TRIES; i++) {
      if (i < tries) bC.setColor(3).fillRect(316 + i * 18, 6, 328 + i * 18, 18);
      else bC.setColor(1).drawRect(316 + i * 18, 6, 328 + i * 18, 18);
    }
    bC.setColor(3).drawLine(12, 24, 388, 24);
    for (i = 0; i < COUNT; i++) {
      y = 30 + i * 19;
      bC.setColor(1).drawString("0x" + (0xF4A0 + i * 12).toString(16).toUpperCase(), 12, y);
      if (i == sel && !state) bC.setColor(3).fillRect(76, y - 1, 140, y + 16).setColor(0);
      else bC.setColor(tried[i] ? 1 : 3);
      bC.drawString(words[i], 80, y);
    }
    bC.setColor(2);
    log.slice(-6).forEach(function (l, k) { bC.drawString(l, 220, 30 + k * 19); });
    if (state) {
      bC.setColor(3).drawRect(214, 146, 388, 180).setFontAlign(0, -1);
      bC.drawString(state == 1 ? "ACCESS GRANTED" : "TERMINAL LOCKED", 301, 155).setFontAlign(-1, -1);
    }
    bC.setColor(2).setFontAlign(0, -1).drawString(state ? "PRESS THE WHEEL TO PLAY AGAIN" : "WHEEL: CHOOSE   PRESS: GUESS", 200, 192);
    bC.flip();
  }

  function guess() {
    if (tried[sel]) return sound("CANCEL");
    var w = words[sel], n = likeness(w, answer);
    tried[sel] = true;
    log.push(">" + w);
    if (w == answer) {
      log.push(">EXACT MATCH");
      state = 1;
      sound("OK2");
    } else {
      tries--;
      log.push(">DENIED " + n + "/" + w.length);
      if (!tries) { log.push(">" + answer + " WAS IT"); state = 2; }
      sound(tries ? "CANCEL" : "ALERT");
    }
  }

  function knob(d) {
    if (d) {
      if (state) return;
      sel = (sel + COUNT - (d > 0 ? 1 : -1)) % COUNT;
      if (Pip.knob1Click) Pip.knob1Click(d);
    } else if (state) deal();
    else guess();
    draw();
  }

  if (Pip.removeSubmenu) Pip.removeSubmenu();
  Pip.on("knob1", knob);
  Pip.removeSubmenu = function () { Pip.removeListener("knob1", knob); };
  deal();
  draw();
})();
