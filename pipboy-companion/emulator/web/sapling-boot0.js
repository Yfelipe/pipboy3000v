// FO3 prototype (board SAPLING): what the real FO3's native firmware provides that the emulator
// build (the Mk V's) doesn't. The emulator puts this in Storage as .boot0, which Espruino runs
// before the boot code, when it loads FO3 firmware (and for its control test).
//
//  - The FO3's named pins. Its firmware uses these names; the pin each one is on is this
//    emulator's choice (see espruino/boards/SAPLING_WASM.py and runtime/boards.js), with the
//    Mk V's pin wherever the two Pip-Boys have the same part.
//  - Pip functions its firmware calls that the public Espruino source doesn't have.
(function () {
  var PINS = {
    BTN_POWER: A0, BTN_STATS: A1, BTN_ITEMS: E1, BTN_DATA: E2,
    ENC1_A: B1, ENC1_B: B0, ENC1_PRESS: A3, // the left wheel (primary scroll) and its click
    ENC2_A: A10, ENC2_B: A8, // the top wheel (secondary scroll)
    MODE_SELECTOR: A7, MEAS_ENB: C4, // the page select knob, powered while MEAS_ENB is low
    LED_RED: E4, LED_GREEN: E5, LED_BLUE: E6,
    LED_STATS: E7, LED_ITEMS: E8, LED_DATA: E9, LED_DOWNFIRE: E10, LED_TORCH: E11, LED_DEBUG: E12,
    LCD_BL: B15, VUSB_PRESENT: A9, VUSB_MEAS: A5, VBAT_MEAS: A6, SD_DETECT: A15,
    RADIO_AUDIO: A4, SPEAKER_ENB: D4, HP_DETECT: D5,
    CHARGE_STAT: C5, CHARGE_STANDBY: C6, CHARGE_CURRENT: C1, ACCEL_INT: C7,
    INT_SCL: B6, INT_SDA: B7, EXT_SCL: B10, EXT_SDA: B11,
  };
  for (var n in PINS) global[n] = PINS[n];

  // The firmware's version, from the SD card's VERSION file (the device's native code sets it)
  if (typeof VERSION == "undefined") {
    try { global.VERSION = String(require("fs").readFile("VERSION") || "").trim(); } catch (e) { global.VERSION = "?"; }
  }

  // Fonts the FO3 has that this build doesn't: the nearest size stands in. g.setFont("Name")
  // finds these too.
  var G = Graphics.prototype;
  if (!G.setFontMonofonto14) G.setFontMonofonto14 = function () { return this.setFontMonofonto16(); };
  if (!G.setFontFixedsys16) G.setFontFixedsys16 = function () { return this.setFontMonofonto16(); };

  // The FO3's built-in UI sounds have their own names (TAB, SCROLL, SELECT, HIGHLIGHT, MODE).
  // This build has the Mk V's set; a name it doesn't know plays a moment of silence.
  var builtin = Pip.audioBuiltin, silence = new Uint8Array(64);
  Pip.audioBuiltin = function (name) { return builtin.call(Pip, name) || silence; };

  // Machine code (the firmware's sleep routine uses some) can't run under WebAssembly: it's
  // skipped, and the rest of going to sleep still happens
  E.nativeCall = function () { return function () { return 0; }; };

  // The STM32's clocks (shown on STATS > Status > ENG). The emulator has no clock tree to report,
  // so this is what an STM32F4 running at full speed off its 32 kHz crystal would say.
  if (!E.getClock || !E.getClock()) E.getClock = function () {
    return { sysclk: 168e6, hclk: 168e6, pclk1: 42e6, pclk2: 84e6, RTCCLKSource: "LSE", RTCCalibrated: false };
  };
  // ...and its temperature sensor: a warm-ish chip, wandering a little
  if (!isFinite(E.getTemperature())) E.getTemperature = function () { return 31 + Math.random(); };

  // Turns the audio codec's master clock on and off (needed for the radio on the device)
  if (!Pip.enableMCLK) Pip.enableMCLK = function () {};

  // { sampleRate, sampleSize (bits), channels, streamLength (bytes of audio) } of a WAV file
  if (!Pip.audioFileInfo) Pip.audioFileInfo = function (path) {
    var f = E.openFile(path, "r"), h = f.read(512) || "";
    f.close();
    var u16 = function (o) { return h.charCodeAt(o) | (h.charCodeAt(o + 1) << 8); };
    var u32 = function (o) { return (u16(o) + u16(o + 2) * 65536) >>> 0; };
    var info = { sampleRate: 16000, sampleSize: 16, channels: 1, streamLength: 0 };
    for (var o = 12; o + 8 <= h.length;) {
      var id = h.substr(o, 4), len = u32(o + 4);
      if (id == "fmt ") { info.channels = u16(o + 10); info.sampleRate = u32(o + 12); info.sampleSize = u16(o + 22); }
      if (id == "data") { info.streamLength = len; break; }
      o += 8 + len + (len & 1);
    }
    return info;
  };

  // Shows a 2 bit 480x320 Graphics buffer on the screen. The device's version also runs the
  // screen's glitch and scanline animations (options.anim, options.filter) and can update only
  // rows y1..y2; here the whole buffer is drawn each time.
  if (!Pip.blitScreen) Pip.blitScreen = function (b) { Pip.blitImage(b, 0, 0); };
})();
