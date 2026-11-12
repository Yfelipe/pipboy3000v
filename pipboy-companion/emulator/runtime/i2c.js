// Emulated I2C chips. The WebAssembly build passes I2C1..I2C3 transfers to the host
// (targets/wasm: jshI2CWrite / jshI2CRead); a board profile lists the chips on each bus:
//
//   i2c: [{ bus: 1, address: 0x0f, model: 'kxtj3', interrupt: 'C7' }, ...]
//
// A transfer to an address with no chip gets no acknowledgement, and Espruino throws, as on a
// real bus. Models are written from the chips' public datasheets, as far as the firmware needs.

/** A chip with 8 bit registers and an auto-incrementing register pointer (most I2C sensors). */
export class RegisterChip {
  constructor() {
    this.regs = new Uint8Array(256);
    this.pointer = 0;
  }
  /** First byte: the register; the rest are written from there. */
  write(bytes) {
    if (!bytes.length) return;
    this.pointer = bytes[0];
    for (let i = 1; i < bytes.length; i++) this.writeReg(this.pointer++ & 0xff, bytes[i]);
  }
  read(length) {
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) out[i] = this.readReg(this.pointer++ & 0xff);
    return out;
  }
  writeReg(reg, value) { this.regs[reg] = value; }
  readReg(reg) { return this.regs[reg]; }
}

/**
 * Kionix KXTJ3-1057 accelerometer (the FO3's): WHO_AM_I 0x35, 8 bit readings at ±2 g
 * (64 per g, in each axis's high byte), and a tap interrupt on its INT pin (active low here)
 * that reading INT_REL releases.
 */
export class Kxtj3 extends RegisterChip {
  static WHO_AM_I = 0x0f;
  static XOUT_L = 0x06;
  static INT_REL = 0x1a;

  constructor({ setPin = () => {}, interrupt = null } = {}) {
    super();
    this.regs[Kxtj3.WHO_AM_I] = 0x35;
    this.setPin = setPin;
    this.interrupt = interrupt;
    this.g = [0, 0, 1]; // the chip's own x, y, z in g: lying flat
  }
  /** Set the acceleration in g, in the chip's axes. */
  setAcceleration(x, y, z) { this.g = [x, y, z]; }
  /** A tap: the interrupt line goes low until the firmware reads INT_REL. */
  tap() { if (this.interrupt) this.setPin(this.interrupt, 0); }
  readReg(reg) {
    if (reg >= Kxtj3.XOUT_L && reg <= Kxtj3.XOUT_L + 5) {
      const axis = (reg - Kxtj3.XOUT_L) >> 1;
      if ((reg - Kxtj3.XOUT_L) & 1) return Math.max(-128, Math.min(127, Math.round(this.g[axis] * 64))) & 0xff; // high byte
      return 0; // low byte: the 8 bit mode leaves it 0
    }
    if (reg === Kxtj3.INT_REL && this.interrupt) this.setPin(this.interrupt, 1);
    return this.regs[reg];
  }
}

/**
 * RDA5807 FM radio: 16 bit registers, written as [reg, high, low] and read with the register
 * pointer set first (Espruino's readReg). Chip ID 0x58; tuning completes at once (STC), and the
 * channel and a fixed signal strength read back.
 */
export class Rda5807 {
  constructor() {
    this.regs = new Uint16Array(0x40);
    this.regs[0x00] = 0x5804;
    this.pointer = 0;
  }
  write(bytes) {
    if (!bytes.length) return;
    this.pointer = bytes[0] & 0x3f;
    for (let i = 1; i + 1 < bytes.length; i += 2) this.writeReg(this.pointer++ & 0x3f, (bytes[i] << 8) | bytes[i + 1]);
  }
  writeReg(reg, value) {
    this.regs[reg] = value;
    if (reg === 0x03) {
      // tuning: done straight away (STC), on the channel asked for, with a usable signal
      this.regs[0x0a] = 0x4000 | 0x0400 | ((value >> 6) & 0x3ff);
      this.regs[0x0b] = (40 << 9) | 0x0100; // RSSI 40, "is a station"
    }
  }
  read(length) {
    const out = new Uint8Array(length);
    for (let i = 0; i + 1 < length; i += 2) {
      const v = this.regs[this.pointer++ & 0x3f];
      out[i] = v >> 8;
      out[i + 1] = v & 0xff;
    }
    return out;
  }
}

const MODELS = {
  kxtj3: (spec, emu) => new Kxtj3({ setPin: (pin, level) => emu.setPin(pin, level), interrupt: spec.interrupt }),
  rda5807: () => new Rda5807(),
  // a chip that only needs to answer (e.g. an audio codec); `regs` gives starting values
  registers: (spec) => {
    const chip = new RegisterChip();
    for (const [reg, value] of Object.entries(spec.regs ?? {})) chip.regs[reg] = value;
    return chip;
  },
};

/** The chips on a board's I2C buses, built from its profile. */
export class I2CBuses {
  constructor(specs = [], emu) {
    this.chips = new Map(); // "bus:address" -> chip
    for (const spec of specs) {
      const make = MODELS[spec.model];
      if (!make) throw new Error(`Unknown I2C chip model ${spec.model}`);
      this.chips.set(`${spec.bus}:${spec.address}`, make(spec, emu));
    }
  }
  chip(bus, address) { return this.chips.get(`${bus}:${address}`) ?? null; }
  /** The first chip of a model, e.g. find('kxtj3'). */
  find(model) {
    for (const chip of this.chips.values()) if (chip.constructor.name.toLowerCase() === model) return chip;
    return null;
  }
  write(bus, address, bytes) {
    const chip = this.chip(bus, address);
    if (!chip) return false;
    chip.write(bytes);
    return true;
  }
  read(bus, address, length) {
    const chip = this.chip(bus, address);
    return chip ? chip.read(length) : null;
  }
}
