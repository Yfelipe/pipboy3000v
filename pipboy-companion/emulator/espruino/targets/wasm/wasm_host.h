/*
 * This file is part of Espruino, a JavaScript interpreter for Microcontrollers
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * ----------------------------------------------------------------------------
 * Functions the JavaScript host provides to the WebAssembly build
 * (imported from the "espruino" module). See emulator/runtime/espruino.js.
 * ----------------------------------------------------------------------------
 */
#ifndef WASM_HOST_H
#define WASM_HOST_H

#include <stdint.h>

#define WASM_IMPORT(NAME) __attribute__((import_module("espruino"), import_name(NAME)))
#define WASM_EXPORT __attribute__((used, visibility("default")))

/// Milliseconds since the epoch (with sub-millisecond precision if available)
WASM_IMPORT("now") double wasmHostNow(void);
/// Set / read the electrical level of a pin (negation is handled in jshardware.c)
WASM_IMPORT("pinSet") void wasmHostPinSet(int pin, int value);
WASM_IMPORT("pinGet") int wasmHostPinGet(int pin);
/// Analog reading of a pin, 0..1
WASM_IMPORT("pinAnalog") double wasmHostPinAnalog(int pin);
/// Called while Espruino waits for something to finish, e.g. for room in the full output buffer: the host drains output
WASM_IMPORT("busyIdle") void wasmHostBusyIdle(void);
/// Hardware reboot (E.reboot()). Never returns: the host abandons this instance and starts a new one.
WASM_IMPORT("reboot") __attribute__((noreturn)) void wasmHostReboot(void);

#endif // WASM_HOST_H
