// Board profiles: which .wasm to load and how the host wires its inputs.
// Pin names and Storage sizes match emulator/espruino/boards/*.py. Use port pin names
// ("A1"), not BTN1/LED1: those are JavaScript variables on the device, not pin names.
//
//   buttons:   momentary inputs. activeLow: the pin idles high and a press pulls it low.
//   encoders:  rotary encoders as two quadrature inputs. Turning +1 changes a before b;
//              keys[0] turns -1 and keys[1] turns +1.
//   selectors: multi-position switches read with analogRead(); each position is a voltage (0..1).
//              enable: {pin, level} if the switch only reads correctly while that output is
//              driven to that level; otherwise it reads 1 (pulled up to the reference).
//   inputs:    fixed electrical levels for other input pins.
//   analog:    fixed analogRead() values (0..1 of the 3.3 V reference).

export const BOARDS = {
  espruino: {
    id: 'espruino',
    name: 'Espruino (generic)',
    wasm: 'espruino_wasm.wasm',
    storageBytes: 256 * 4096,
    buttons: {
      BTN1: { pin: 'D0', label: 'BTN1', key: 'Space' },
      BTN2: { pin: 'D1', label: 'BTN2', key: 'Enter' },
    },
    leds: { LED1: { pin: 'D2', color: '#e33' }, LED2: { pin: 'D3', color: '#3c3' }, LED3: { pin: 'D4', color: '#36f' } },
  },

  pipboy: {
    id: 'pipboy',
    family: 'pipboy',
    name: 'Pip-Boy 3000 Mk V',
    wasm: 'pipboy_wasm.wasm',
    storageBytes: 32 * 4096,
    // All buttons and encoder lines are active-low (NEGATED in boards/PIPBOY.py)
    buttons: {
      BTN10: { pin: 'A0', label: 'Power', key: 'Escape', activeLow: true },
      BTN7: { pin: 'A3', label: 'Select', key: 'Enter', activeLow: true },
      BTN1: { pin: 'A1', label: 'Play', key: 'KeyP', activeLow: true },
      BTN2: { pin: 'E1', label: 'Tune +', key: 'Period', activeLow: true },
      BTN3: { pin: 'E2', label: 'Tune −', key: 'Comma', activeLow: true },
      BTN4: { pin: 'A2', label: 'Torch', key: 'KeyT', activeLow: true },
    },
    encoders: {
      // KNOB1 in the firmware: the wheel beside the screen, scrolls menus (pressing it is BTN7)
      knob1: { a: 'B1', b: 'B0', label: 'Wheel', keys: ['ArrowUp', 'ArrowDown'], activeLow: true },
      // KNOB2: the thumbwheel, moves between submenus
      // The firmware treats B-before-A as "next", so this one is listed B first
      knob2: { a: 'A8', b: 'A10', label: 'Thumbwheel', keys: ['ArrowLeft', 'ArrowRight'], activeLow: true },
    },
    selectors: {
      // MODE_SELECTOR: the five-position dial, decoded by voltage in the firmware's checkMode()
      mode: {
        pin: 'A7',
        label: 'Mode',
        // MEAS_ENB (C4, open-drain): the firmware pulls it low to power the dial's resistor ladder
        enable: { pin: 'C4', level: 0 },
        keys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
        positions: [
          { label: 'STAT', value: 0.0 },
          { label: 'INV', value: 0.2 },
          { label: 'DATA', value: 0.4 },
          { label: 'MAP', value: 0.6 },
          { label: 'RADIO', value: 0.8 },
        ],
      },
    },
    inputs: {
      A9: 1, // VUSB_PRESENT: running on USB power, so the firmware never sleeps for low battery
      A15: 0, // SDCARD_DETECT: card inserted
      B6: 1, // radio I2C SCL and SDA idle high (pull-ups); there is no radio chip on the bus
      B7: 1,
    },
    analog: {
      A6: 0.6, // VBAT_MEAS: 0.6 x 2 x 3.3 V ≈ 4.0 V battery
      A5: 0.76, // VUSB_MEAS: ≈ 5 V
    },
    leds: {
      LED1: { pin: 'E4', color: '#e33', activeLow: true },
      LED2: { pin: 'E5', color: '#3c3', activeLow: true },
      LED3: { pin: 'E6', color: '#36f', activeLow: true },
      LED4: { pin: 'E3', color: '#fb3', activeLow: true },
    },
  },
};

// The Pip-Boy with 512 KB of Storage instead of 128 KB (espruino/boards/PIPBOY_XL_WASM.py), so
// Pip-OS, both of the companion's apps and the extensions fit at once. Emulator only: use
// `pipboy` to check that something fits on a real Pip-Boy.
BOARDS['pipboy-xl'] = {
  ...BOARDS.pipboy,
  id: 'pipboy-xl',
  name: 'Pip-Boy 3000 Mk V · 512 KB Storage',
  wasm: 'pipboy_xl_wasm.wasm',
  storageBytes: 128 * 4096,
};

// PROTOTYPE: the Fallout 3 / New Vegas Pip-Boy 3000 ("FO3", board SAPLING), built to run The Wand
// Company's FO3 firmware (added from its update zip on the emulator's Load tab). The firmware
// names its pins (BTN_STATS, ENC1_A, MODE_SELECTOR ...); which pin each name is on is this
// emulator's choice, made in web/sapling-boot0.js, with the Mk V's pin wherever the two share a
// part. espruino/boards/SAPLING_WASM.py is the build.
BOARDS.fo3 = {
  id: 'fo3',
  family: 'sapling',
  name: 'Pip-Boy 3000 (FO3) · prototype',
  wasm: 'sapling_wasm.wasm',
  storageBytes: 64 * 4096,
  demo: 'web/fo3-controls.js', // boot code the emulator page gives it on a blank Storage: a control test
  boot0: 'web/sapling-boot0.js', // the FO3's pin names and native stand-ins, written as .boot0 with it
  buttons: {
    BTN_POWER: { pin: 'A0', label: 'Power', key: 'Escape', activeLow: true },
    ENC1_PRESS: { pin: 'A3', label: 'Click select', key: 'Enter', activeLow: true },
    // the three illuminated mode select buttons under the screen
    BTN_STATS: { pin: 'A1', label: 'STATS', key: 'KeyS', activeLow: true },
    BTN_ITEMS: { pin: 'E1', label: 'ITEMS', key: 'KeyI', activeLow: true },
    BTN_DATA: { pin: 'E2', label: 'DATA', key: 'KeyD', activeLow: true },
  },
  encoders: {
    // ENC1: the left wheel (primary scroll); ENC2: the top wheel (secondary scroll)
    primary: { a: 'B1', b: 'B0', label: 'Primary scroll', keys: ['ArrowUp', 'ArrowDown'], activeLow: true },
    secondary: { a: 'A10', b: 'A8', label: 'Secondary scroll', keys: ['ArrowLeft', 'ArrowRight'], activeLow: true },
  },
  selectors: {
    // MODE_SELECTOR, the page select knob, as the firmware decodes it: above 0.7 is the first page,
    // then 0.5, 0.3, 0.1 and below for the fifth; over 0.9 means "between positions"
    page: {
      pin: 'A7',
      label: 'Page',
      enable: { pin: 'C4', level: 0 }, // MEAS_ENB
      keys: ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'],
      positions: [
        { label: '1', value: 0.8 },
        { label: '2', value: 0.6 },
        { label: '3', value: 0.4 },
        { label: '4', value: 0.2 },
        { label: '5', value: 0.0 },
      ],
    },
  },
  inputs: { ...BOARDS.pipboy.inputs, B10: 1, B11: 1, C7: 1 }, // the external I2C bus idles high too, and ACCEL_INT
  // emulated I2C chips (runtime/i2c.js), at the addresses the FO3 firmware uses
  i2c: [
    { bus: 1, address: 0x0f, model: 'kxtj3', interrupt: 'C7' }, // accelerometer; ACCEL_INT (active low)
    { bus: 1, address: 0x10, model: 'registers', regs: { 72: 78 } }, // audio codec: answers, makes no sound; radio volume starts at 5 of 10
    { bus: 2, address: 0x11, model: 'rda5807' }, // FM radio
  ],
  motion: true, // the emulator page shows Tap and Shake
  analog: BOARDS.pipboy.analog,
  leds: {
    LED_STATS: { pin: 'E7', color: '#fb3' },
    LED_ITEMS: { pin: 'E8', color: '#fb3' },
    LED_DATA: { pin: 'E9', color: '#fb3' },
    LED_TORCH: { pin: 'E11', color: '#fff' },
    LED_DOWNFIRE: { pin: 'E10', color: '#ffe680' },
    LED_RED: { pin: 'E4', color: '#e33', activeLow: true },
    LED_GREEN: { pin: 'E5', color: '#3c3', activeLow: true },
    LED_BLUE: { pin: 'E6', color: '#36f', activeLow: true },
  },
};
