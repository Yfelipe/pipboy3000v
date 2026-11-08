// The companion's extensions, for our own interfaces: FM radio presets, notes, the inbox and
// the USB media remote. They use the same files as the extensions for the stock interface
// (apps/extensions), so both stay in step:
//
//   companion-radio.json (Storage)  [{ name, frequency }] from the Radio presets page
//   NOTES/*.txt                     notes from ID, lists & notes
//   USER/MESSAGES.json              [{ text, at, read }] messages sent from Home
//
// The stock interface's radio driver (rd) isn't there once an app has been loaded, so this
// has its own few lines for the RDA5807, written the way Pip-OS 1.33 drives it.

const fs = require("fs");

// ------------------------------------------------------------------ FM radio
const RDA = 17, RADIO_AUDIO = A4;
let i2c;
const wr = (r, v) => i2c.writeTo(RDA, [r, (v >> 8) & 255, v & 255]);
const rr = (r) => { i2c.writeTo(RDA, r); const a = i2c.readFrom(RDA, 2); return (a[0] << 8) | a[1]; };

function bus() {
  if (i2c) return true;
  try {
    i2c = new I2C();
    i2c.setup({ sda: B7, scl: B6 });
    return true;
  } catch (e) { i2c = null; return false; }
}

/** The FM radio: 76-108 MHz in 100 kHz steps (band 2, as Pip-OS sets it). */
export const fm = {
  freq: 98.8,
  on: false,
  /** Turn it on (tuned to fm.freq) or off. Returns false if the radio didn't answer. */
  enable(on) {
    if (!bus()) return false;
    try {
      if (on) {
        // Pip-OS's rd.init(): reset, enable, band 76-108 MHz, then its volume and RDS settings
        [[2, 3], [2, 0xF00D], [3, 8], [4, 0x3200], [5, 0x88A8], [6, 0x8000], [7, 0x5F1A]].forEach((r) => wr(r[0], r[1]));
        RADIO_AUDIO.mode("analog");
        this.on = true;
        this.tune(this.freq);
        analogWrite(LED4, 0.2, { soft: true }); // the tuning lamp
      } else {
        wr(2, rr(2) & 0xFEFE);
        this.on = false;
        LED4.write(0);
      }
      return true;
    } catch (e) { this.on = false; return false; }
  },
  tune(f) {
    f = E.clip(Math.round(f * 10) / 10, 76, 108);
    this.freq = f;
    if (!this.on) return;
    const c = ((Math.round(f * 10 - 760) & 1023) << 6) | 8; // channel, band 2, 100 kHz spacing
    try { wr(3, c); wr(3, c | 16); } catch (e) {}
  },
  /** Signal strength 0..1 (0 when off). */
  signal() {
    try { return this.on ? E.clip(((rr(11) >> 9) & 127) / 60, 0, 1) : 0; } catch (e) { return 0; }
  },
  vol(v) {
    try {
      if (v === undefined) return rr(5) & 15;
      wr(5, (rr(5) & 0xFFF0) | E.clip(v, 0, 15));
    } catch (e) { return 0; }
  },
};

/** The stations from the Radio presets page: [{ name, f }] (up to 12, in the FM band). */
export function presets() {
  const list = require("Storage").readJSON("companion-radio.json", true);
  if (!Array.isArray(list)) return [];
  return list.map((p) => ({ name: String(p.name || "").toUpperCase(), f: +p.frequency }))
    .filter((s) => s.f >= 87.5 && s.f <= 108).slice(0, 12);
}

// ------------------------------------------------------------------ notes
/** Notes on the SD card: [{ file, title }], sorted. */
export function notes() {
  try {
    return fs.readdirSync("NOTES").filter((n) => n[0] != "." && /\.txt$/i.test(n)).sort()
      .map((n) => ({ file: "NOTES/" + n, title: n.slice(0, -4).replace(/[_-]+/g, " ").toUpperCase() }));
  } catch (e) { return []; }
}

export function readNote(file) {
  try { return String(fs.readFile(file) || "").slice(0, 20000).replace(/\r/g, ""); } catch (e) { return ""; }
}

// ------------------------------------------------------------------ inbox
const INBOX = "USER/MESSAGES.json";

/** Messages, newest first. */
export function messages() {
  try {
    const d = JSON.parse(fs.readFile(INBOX));
    return Array.isArray(d) ? d.reverse() : [];
  } catch (e) { return []; }
}

/** Save the read marks (`list` as messages() returned it). */
export function saveMessages(list) {
  try { fs.writeFile(INBOX, JSON.stringify(list.slice().reverse())); } catch (e) {}
}

export function when(t) {
  const d = new Date(t), two = (n) => ("0" + n).substr(-2);
  return two(d.getDate()) + "." + two(d.getMonth() + 1) + " " + two(d.getHours()) + ":" + two(d.getMinutes());
}

// ------------------------------------------------------------------ media remote
// A USB keyboard (report 1, so EXT TERMINAL keeps working) and consumer keys (report 2), the
// same descriptor as the Media remote extension. The computer reads it when the cable is
// plugged in, so the first time needs a replug.
// (kept as base64: a plain array costs a RAM block per byte)
const DESCRIPTOR = "BQEJBqEBhQEFBxngKecVACUBdQGVCIEClQF1CIEBlQV1AQUIGQEpBZEClQF1A5EBlQZ1CBUAJWgFBxkAKWiBAMAFDAkBoQGFAhUAJpwCGQAqnAJ1EJUBgQDA";
const KEY = { play: 0xCD, next: 0xB5, prev: 0xB6, up: 0xE9, down: 0xEA, mute: 0xE2 };
export const REMOTE_LABEL = { play: "PLAY / PAUSE", next: "NEXT TRACK", prev: "PREVIOUS TRACK", up: "VOLUME UP", down: "VOLUME DOWN", mute: "MUTE" };
export const REMOTE_KEYS = [["WHEEL", "VOLUME"], ["PRESS WHEEL", "PLAY / PAUSE"], ["THUMBWHEEL", "PREV / NEXT"], ["PLAY BUTTON", "MUTE"]];

export const remote = {
  /** Set up the descriptor (for the next plug-in). False if this firmware has no USB HID. */
  start() {
    if (!E.setUSBHID || !E.sendUSBHID) return false;
    const d = atob(DESCRIPTOR), bytes = [];
    for (let i = 0; i < d.length; i++) bytes.push(d.charCodeAt(i));
    E.setUSBHID({ reportDescriptor: bytes });
    return true;
  },
  /** True when the computer has the remote (a key-up report went through). */
  ready: () => !!(E.sendUSBHID && E.sendUSBHID([2, 0, 0])),
  /** Tap a media key; false if the computer doesn't have the remote yet. */
  press(name) {
    if (!E.sendUSBHID || !E.sendUSBHID([2, KEY[name] & 255, KEY[name] >> 8])) return false;
    setTimeout(() => E.sendUSBHID([2, 0, 0]), 30);
    return true;
  },
};
