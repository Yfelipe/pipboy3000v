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
