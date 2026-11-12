// The plumbing every tabbed Pip-Boy app shares (Mojave UI, Capital UI, Pip-Boy 2000, Endurance): the wheels,
// the mode dial, the torch and power buttons, sounds, video, the display palette and settings,
// the radio, messages from the companion, the companion extras from the SD card, and the three
// Pip-OS 1.33 screens (INV > ID, DATA > FEEDS and LISTS). An app supplies what it looks like:
//
//   run({
//     settingsFile: "mojave.json",             // its settings in Storage
//     extFile: "USER/MOJAVE.EXT",              // its companion extras on the SD card
//     themes: [{ name, rgb, stock }],          // display colours; new ones go at the end
//     pages: [[...], [...], [...], [...], [...]], // page names for the five dial positions
//     bootLines: ["..."],                      // printed while it starts
//     build(k) { ...; return { pages, list, drawHeader, drawFooter }; },
//   });
//
// build(k) is the app's drawing code. pages: { NAME: { build, draw, select, onKnob, start, ... } }.
// list(b, items, x, y, w, rows, rowH) draws a scrolling list its way (the extras' pages use it).
// drawHeader() and drawFooter() draw into k.bH and k.bF and show them; both are redrawn when a
// page opens and every 15 seconds. build may also return splash(done): a title screen of the
// app's own, shown after the boot lines; it calls done when it is over. k is described where it
// is made, below.
//
// Appearance belongs to the app; this file must not decide how an app's own screens look.
import { feeds, hasIdCard, ID_CARD, blitRaw, readLists, setDone, modeFor, fallbackMode, stockPalette, charSheet } from "./pipos133.js";

export function run(app) {
  // ------------------------------------------------------------------ hardware
  const KNOB1_A = BTN8, KNOB1_B = BTN9, KNOB1_BTN = BTN7;
  const KNOB2_A = BTN5, KNOB2_B = BTN6;
  const BTN_POWER = BTN10, BTN_PLAY = BTN1, BTN_TORCH = BTN4;
  const MODE_SELECTOR = A7, VBAT_MEAS = A6, VUSB_PRESENT = A9, LCD_BL = B15, MEAS_ENB = C4;

  // Off-screen buffers in the STM32's CCM RAM, where the stock firmware keeps its own
  // (so they don't use JS variables). Drawn with colours 0..3 and shown with Pip.blitImage.
  const area = (offset, bytes) => E.toArrayBuffer(E.memoryArea(0x10008000 + offset, bytes));
  const bC = Graphics.createArrayBuffer(400, 210, 2, { msb: true, buffer: area(0, 21000) });
  const bH = Graphics.createArrayBuffer(372, 51, 2, { msb: true, buffer: area(21000, 4743) });
  const bF = Graphics.createArrayBuffer(372, 25, 2, { msb: true, buffer: area(25743, 2325) });
  const showC = () => Pip.blitImage(bC, 40, 65);
  const showH = () => Pip.blitImage(bH, 53, 7, { noScanEffect: true });
  const showF = () => Pip.blitImage(bF, 52, 290, { noScanEffect: true });

  // ------------------------------------------------------------------ settings & theme
  const SETTINGS_FILE = app.settingsFile;
  const SHEET = charSheet(); // level and S.P.E.C.I.A.L. from the companion, if the SD card has them
  let cfg = Object.assign({ theme: 0, sound: true, bright: 3 }, require("Storage").readJSON(SETTINGS_FILE, true) || {});
  const save = () => require("Storage").writeJSON(SETTINGS_FILE, cfg);

  const THEMES = app.themes;
  if (!THEMES[cfg.theme]) cfg.theme = 0;

  /** Pip palettes: [even lines, odd (scanline) lines, glow even, glow odd] x 16 levels. */
  function applyTheme() {
    const stock = THEMES[cfg.theme].stock && stockPalette();
    if (stock) { Pip.setPalette(stock); g.setBgColor(0); return; }
    const c = THEMES[cfg.theme].rgb;
    const rows = [0.86, 0.65, 1, 0.75];
    Pip.setPalette(rows.map((k) => {
      const row = new Uint16Array(16);
      for (let i = 0; i < 16; i++) {
        const v = (i / 15) * k;
        row[i] = ((c[0] * v * 31) << 11) | ((c[1] * v * 63) << 5) | (c[2] * v * 31);
      }
      return row;
    }));
    g.setBgColor(0);
  }

  function backlight() {
    analogWrite(LCD_BL, [0.05, 0.12, 0.3, 0.6, 1][cfg.bright], { freq: 200 });
  }

  function sound(file) {
    if (!cfg.sound || (video && !videoTimer)) return; // a UI sound would stop the video (see playVideo)
    try { Pip.audioStart("UI/" + file + ".wav"); } catch (e) {}
  }

  // ------------------------------------------------------------------ state
  const PAGES = app.pages;
  const P = {}; // every page by name: the shared ones below, then the app's own
  let X = null; // the companion extras (see ../mojave/extras.js), when the SD card has them
  let tab = -1, page = 0, sel = 0, frame = 0, torch = false;
  let pageData = null; // the current page's items, built when the page opens
  let radioOn = false, station = 0;
  let video = null, videoTimer, stillTimer, covered = false;
  let popup = null; // a message from the companion: { lines }

  /** Corner brackets around a box (the extras' pages draw them). */
  function corners(b, x1, y1, x2, y2, len) {
    b.drawLine(x1, y1, x1 + len, y1).drawLine(x1, y1, x1, y1 + len);
    b.drawLine(x2, y1, x2 - len, y1).drawLine(x2, y1, x2, y1 + len);
    b.drawLine(x1, y2, x1 + len, y2).drawLine(x1, y2, x1, y2 - len);
    b.drawLine(x2, y2, x2 - len, y2).drawLine(x2, y2, x2, y2 - len);
  }

  // ---- Pip-OS 1.33 screens, from the same SD card files as the stock firmware

  /** A message in the middle of the content area. */
  function notice(b, title, lines) {
    b.setFontMonofonto18().setFontAlign(0, 0).setColor(3).drawString(title, 200, 80);
    b.setFontMonofonto16().setColor(2);
    (lines || []).forEach((l, i) => b.drawString(l, 200, 110 + i * 20));
  }
  const MAKE = ["MAKE THEM WITH THE PIP-BOY COMPANION", "(ID, LISTS & FEEDS) OR PIP-BOY TOOLS"];

  // DATA > FEEDS: the videos and pictures in DATA/ (and USER/USERIMG.img); the wheel flips through
  P.FEEDS = {
    video: true,
    build: () => ({ list: feeds(), i: 0, still: false }),
    start(d) { showFeed(d); },
    onKnob(dir, d) {
      if (!d.list.length) return;
      d.i = (d.i + d.list.length - dir) % d.list.length;
      sound("ROT_V_1");
      showFeed(d);
    },
    draw(b, d) { notice(b, d.list.length ? "TUNING FEED..." : "NO FEEDS ON SD CARD"); },
  };

  function showFeed(d) {
    const f = d.list[d.i];
    if (!f) return;
    d.still = false;
    if (f.video) return playVideo(f.path, { x: 40, y: 40 }, f.loop);
    stopVideo();
    stillTimer = setTimeout(() => {
      stillTimer = undefined;
      try { blitRaw(bC, f.path, 400, 248, 40, 40); d.still = true; } catch (e) { print("ERROR:", e.message); }
    }, 150);
  }

  // INV > ID: the ID card over the whole screen, as on the stock firmware
  P.ID = {
    build: () => ({ card: hasIdCard(), still: false }),
    start(d) {
      if (!d.card) return;
      stillTimer = setTimeout(() => {
        stillTimer = undefined;
        g.clear();
        try { blitRaw(bC, ID_CARD, 400, 300, 40, 10); d.still = covered = true; } catch (e) { print("ERROR:", e.message); }
      }, 200);
    },
    draw(b) { notice(b, "NO ID CARD ON SD CARD", MAKE); },
  };

  // DATA > LISTS: the wheel picks, pressing it opens a list or ticks an item off
  P.LISTS = {
    build: () => ({ lists: readLists(), open: -1 }),
    rows(d) {
      if (!d.lists) return [];
      if (d.open < 0) return d.lists.categories.map((c) => [c.name || "UNTITLED", c.items.filter((i) => i.done).length + "/" + c.items.length]);
      return [["< BACK", ""]].concat(d.lists.categories[d.open].items.map((i) => [i.text || "", i.done ? 1 : 0]));
    },
    draw(b, d) {
      const rows = this.rows(d);
      if (!rows.length) return notice(b, d.lists ? "NO LISTS" : "NO LISTS ON SD CARD", MAKE);
      let top = 6;
      if (d.open >= 0) {
        b.setFontMonofonto18().setFontAlign(-1, -1).setColor(3).drawString(d.lists.categories[d.open].name.toUpperCase(), 10, 4);
        b.setColor(1).drawLine(0, 28, 399, 28);
        top = 34;
      }
      const R = d.open < 0 ? 7 : 6, H = 28, first = E.clip(sel - (R >> 1), 0, Math.max(0, rows.length - R));
      b.setFontMonofonto18();
      for (let k = 0; k < R && first + k < rows.length; k++) {
        const i = first + k, y = top + k * H, row = rows[i], on = i == sel;
        if (on) b.setColor(2).fillRect(0, y, 399, y + H - 3);
        const fg = on ? 0 : 3;
        let x = 10;
        if (d.open >= 0 && i > 0) {
          b.setColor(fg).drawRect(x, y + 6, x + 12, y + 18);
          if (row[1]) b.fillRect(x + 3, y + 9, x + 9, y + 15);
          x += 22;
        }
        b.setColor(fg).setFontAlign(-1, 0).drawString(row[0], x, y + H / 2 - 1);
        if (d.open < 0) b.setFontAlign(1, 0).drawString(row[1], 390, y + H / 2 - 1);
      }
    },
    onKnob(dir, d) {
      const n = this.rows(d).length;
      if (!n) return;
      const before = sel;
      sel = E.clip(sel - dir, 0, n - 1);
      if (sel != before) sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
    },
    select(d) {
      if (!d.lists || !this.rows(d).length) return;
      if (d.open < 0) { d.open = sel; sel = 0; sound("OK"); return; }
      if (sel == 0) { sel = d.open; d.open = -1; sound("CANCEL"); return; }
      const item = d.lists.categories[d.open].items[sel - 1];
      setDone(d.lists, item, !item.done);
      sound("OK");
    },
  };

  // The Pip-Boy has one SD stream for audio and video: Pip.audioStart() closes a playing video,
  // so a video starts a moment after the page-change sound, and no UI sounds play while it runs.
  // `loop` plays on after `file` (FEEDS' X_LOOP.avi) via 2v29's videoStopped event.
  const quietStop = () => { if (Pip.removeAllListeners) Pip.removeAllListeners("videoStopped"); Pip.videoStop(); };
  function playVideo(file, pos, loop) {
    if (videoTimer) clearTimeout(videoTimer);
    if (stillTimer) clearTimeout(stillTimer);
    stillTimer = undefined;
    video = file;
    videoTimer = setTimeout(() => {
      videoTimer = undefined;
      try {
        quietStop();
        const chain = loop && Pip.on;
        if (chain) Pip.on("videoStopped", () => {
          Pip.removeAllListeners("videoStopped");
          if (video == file) { video = loop; Pip.videoStart(loop, { x: pos.x, y: pos.y, repeat: true }); }
        });
        Pip.videoStart(file, { x: pos.x, y: pos.y, repeat: !chain });
      } catch (e) { video = null; }
    }, 150);
  }

  function stopVideo() {
    if (videoTimer) clearTimeout(videoTimer);
    if (stillTimer) clearTimeout(stillTimer);
    videoTimer = stillTimer = undefined;
    if (!video) return;
    try { quietStop(); } catch (e) {}
    video = null;
  }

  const playing = () => radioOn || (X && X.fm.on);
  function stopRadio() { radio(false); if (X) X.fm.enable(false); }
  /** Play station `station` of the list `d`: FM (the dial or a preset) or Mojave clips. */
  function play(d) {
    const s = d[station];
    if (s.dial || s.f) {
      if (radioOn) radio(false);
      if (s.f) X.fm.tune(s.f);
      if (!X.fm.on && !X.fm.enable(true)) print("ERROR: the FM radio didn't answer");
    } else { stopRadio(); radio(true); }
  }

  /** Play a random clip from the SD card's RADIO folder, as the stock radio does. */
  function radio(on) {
    radioOn = on;
    try {
      if (on) {
        const files = require("fs").readdirSync("RADIO").filter((f) => f.toUpperCase().endsWith(".WAV"));
        if (files.length) Pip.audioStart("RADIO/" + files[(Math.random() * files.length) | 0]);
      } else Pip.audioStop();
    } catch (e) {}
  }

  // ------------------------------------------------------------------ navigation

  function openPage() {
    stopVideo();
    sel = 0;
    pageData = null;
    const p = P[PAGES[tab][page]];
    if (p.build) pageData = p.build();
    if (covered) { covered = false; g.clear(); }
    g.setBgColor(0).clearRect(36, 37, 444, 288);
    ui.drawHeader();
    ui.drawFooter();
    if (p.start) p.start(pageData);
  }

  function setTab(t) {
    if (t == tab) return;
    tab = t;
    page = 0;
    openPage();
    sound("ROT_H_1");
  }

  function onKnob1(dir) {
    if (torch || tab < 0 || popup) return;
    const p = P[PAGES[tab][page]];
    if (p.onKnob) return p.onKnob(dir, pageData);
    const n = Array.isArray(pageData) ? pageData.length : 0;
    if (!n) return;
    const before = sel;
    sel = E.clip(sel - dir, 0, n - 1);
    if (sel != before) sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
  }

  function onKnob2(dir) {
    if (torch || tab < 0 || popup) return;
    const n = PAGES[tab].length, p = P[PAGES[tab][page]];
    if (n < 2 || p.ownsKnob2) { // single-page tabs (RADIO tunes with it) and REMOTE use it themselves
      if (p.onKnob2) p.onKnob2(dir, pageData);
      return;
    }
    page = (page + n + dir) % n;
    openPage();
    sound(dir > 0 ? "NEXT" : "PREV");
  }

  function onSelect() {
    if (torch || tab < 0) return;
    if (popup) { popup = null; sound("OK"); openPage(); return; }
    const p = P[PAGES[tab][page]];
    if (p.select) p.select(pageData);
  }

  function setTorch(on) {
    torch = on;
    if (on) { stopVideo(); g.setColor(g.theme.fg).fillRect(0, 0, 479, 319); analogWrite(LCD_BL, 1); }
    else { g.clear(); covered = false; backlight(); ui.drawFooter(); openPage(); }
    sound(on ? "L_ON" : "L_OFF");
  }

  // ------------------------------------------------------------------ main loop

  let modePrev = -1, lastError = "";
  const fallback = fallbackMode();
  function tick() {
    // Mode dial: five positions decoded from its voltage, as the stock firmware does
    // (between positions: settings.fallbackMode, as Pip-OS 1.32+; 0 = stay put)
    const m = modeFor(MODE_SELECTOR.analog(), fallback);
    if (m == modePrev && m >= 0) setTab(m);
    modePrev = m;
    if (torch || tab < 0) return;
    frame++;
    const p = P[PAGES[tab][page]];
    if ((pageData && pageData.still) || (p.video && video)) return; // a picture or video is showing
    bC.clear().setFontMonofonto16().setFontAlign(-1, -1).setColor(3); // the same start state every frame
    try {
      P[PAGES[tab][page]].draw(bC, pageData);
      if (popup) drawPopup(bC);
    } catch (e) {
      bC.setColor(3).setFontMonofonto16().setFontAlign(-1, -1).drawString("ERROR: " + e.message, 8, 8);
      if (e.message != lastError) print("ERROR:", e.message);
      lastError = e.message;
    }
    showC();
    if (frame % 150 == 0 && !covered) { ui.drawHeader(); ui.drawFooter(); } // the clock, battery and memory readouts
  }

  // A message from the companion (it calls companionMessage over USB when this app is running)
  function drawPopup(b) {
    b.setColor(0).fillRect(24, 22, 376, 190).setColor(3).drawRect(24, 22, 376, 190).drawRect(27, 25, 373, 187);
    b.setFontMonofonto18().setFontAlign(0, -1).drawString("INCOMING MESSAGE", 200, 32);
    b.setColor(1).drawLine(40, 56, 360, 56).setColor(3);
    popup.lines.forEach((l, i) => b.drawString(l, 200, 64 + i * 21));
    b.setFontMonofonto16().setColor(frame & 8 ? 3 : 2).drawString("PRESS THE WHEEL", 200, 166);
  }
  global.companionMessage = (text) => {
    popup = { lines: bC.setFontMonofonto18().wrapString(String(text), 340).slice(0, 5) };
    stopVideo();
    if (pageData) pageData.still = false;
    if (covered) { covered = false; g.clear(); ui.drawHeader(); ui.drawFooter(); }
    sound("ALERT");
  };

  function boot(done) {
    const lines = app.bootLines;
    let i = 0;
    g.clear().setFontMonofonto18().setFontAlign(-1, -1).setColor(g.theme.fg);
    const t = setInterval(() => {
      if (i < lines.length) { g.drawString(lines[i], 70, 60 + i * 24); sound("UP1"); i++; }
      else { clearInterval(t); g.clear(); if (ui.splash) ui.splash(done); else done(); }
    }, 180);
  }

  // Back to the stock interface. load() restarts the interpreter with the firmware's boot code
  // without a hardware reset, so an app set to open at power-on (.bootPowerOn) doesn't come back.
  function exitToStock() { load(); }

  // ------------------------------------------------------------------ the app's own screens

  // What an app's build(k) gets. The values that change (the selection, the frame count, where
  // the dial and thumbwheel are, the radio) are read through k each time: k.sel, k.frame, ...
  const k = {
    bC, bH, bF, showC, showH, showF, sound, playVideo, stopVideo, notice, MAKE, corners,
    THEMES, cfg, save, applyTheme, backlight, exitToStock, playing, stopRadio, play, SHEET, PAGES,
    VBAT_MEAS, VUSB_PRESENT,
    get sel() { return sel; }, set sel(v) { sel = v; },
    get station() { return station; }, set station(v) { station = v; },
    get frame() { return frame; },
    get tab() { return tab; },
    get page() { return page; },
    get radioOn() { return radioOn; },
    get X() { return X; },
  };
  const ui = app.build(k); // { pages, list, drawHeader, drawFooter }
  Object.assign(P, ui.pages);

  // ------------------------------------------------------------------ start

  clearWatch();
  clearInterval();
  // The stock firmware keeps the time zone in the SD card's settings.json
  try { E.setTimeZone(JSON.parse(require("fs").readFile("settings.json")).timezone || 0); } catch (e) {}
  // The companion extras from the SD card (see extras.js): their pages join the tabs
  try {
    (0, eval)(require("fs").readFile(app.extFile)); // sets global.companionExtras
    X = global.companionExtras({ bC, list: ui.list, notice, corners, sound, sel: () => sel, setSel: (n) => { sel = n; }, frame: () => frame });
  } catch (e) {}
  delete global.companionExtras;
  if (X) { Object.assign(P, X.pages); PAGES[1].push("REMOTE"); PAGES[2].splice(4, 0, "NOTES", "INBOX"); }
  applyTheme();
  backlight();
  // MEAS_ENB powers the mode dial's resistor ladder (and the battery divider): the dial only
  // reads correctly while it's pulled low. The stock firmware does the same; load() resets it.
  pinMode(MEAS_ENB, "opendrain");
  MEAS_ENB.write(0);
  pinMode(KNOB1_B, "input");
  pinMode(KNOB2_A, "input");
  // Encoder direction comes from the other line's level when A rises (as Pip.addWatches)
  setWatch((e) => onKnob1(e.state ^ e.data ? -1 : 1), KNOB1_A, { data: KNOB1_B, edge: 1, repeat: true, debounce: 0 });
  setWatch((e) => onKnob2(e.state ^ e.data ? 1 : -1), KNOB2_B, { data: KNOB2_A, edge: 1, repeat: true, debounce: 0 });
  setWatch(onSelect, KNOB1_BTN, { edge: "rising", repeat: true, debounce: 20 });
  // PLAY: the radio on RADIO (and mute on REMOTE)
  setWatch(() => { const p = tab >= 0 && !torch && !popup && P[PAGES[tab][page]]; if (p && p.play) p.play(pageData); }, BTN_PLAY, { edge: "rising", repeat: true, debounce: 50 });
  setWatch(() => setTorch(!torch), BTN_TORCH, { edge: "rising", repeat: true, debounce: 50 });
  setWatch(() => { stopRadio(); stopVideo(); exitToStock(); }, BTN_POWER, { edge: "rising", repeat: true, debounce: 50 });

  boot(() => {
    ui.drawHeader();
    ui.drawFooter();
    setInterval(tick, 100);
  });
}
