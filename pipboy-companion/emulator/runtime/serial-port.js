// An emulator presented as a Web Serial port ({ getInfo, open, close, readable, writable }),
// so code written for navigator.serial (the dashboard's SerialSession) can talk to it as it
// would to a Pip-Boy plugged in over USB.
//
//   const port = serialPort(emu);
//   await session.open(port);
//
// The emulator's console output is routed to the port while it is open.

export function serialPort(emu, { usbVendorId = 0x0483, usbProductId = 0xa4f1 } = {}) {
  let controller = null;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const previousOutput = emu.onOutput;

  const port = {
    readable: null,
    writable: null,
    getInfo: () => ({ usbVendorId, usbProductId }),
    async setSignals() {},
    async open() {
      port.readable = new ReadableStream({
        start(c) { controller = c; },
        cancel() { controller = null; },
      });
      port.writable = new WritableStream({
        write(chunk) {
          emu.write(decoder.decode(chunk, { stream: true }));
        },
      });
      emu.onOutput = (text) => {
        try { controller?.enqueue(encoder.encode(text)); } catch {}
      };
    },
    async close() {
      emu.onOutput = previousOutput;
      try { controller?.close(); } catch {}
      controller = null;
      port.readable = null;
      port.writable = null;
    },
  };
  return port;
}
