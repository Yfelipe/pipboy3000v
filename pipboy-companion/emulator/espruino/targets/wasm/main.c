/*
 * This file is part of Espruino, a JavaScript interpreter for Microcontrollers
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * ----------------------------------------------------------------------------
 * Entry points for the WebAssembly build. There is no main loop: the host calls
 * jsInit() once, then jsIdle() whenever input arrives or the time it returned elapses.
 * Based on targets/emscripten/main.c.
 * ----------------------------------------------------------------------------
 */
#include <stdlib.h>
#include <string.h>
#include "jsutils.h"
#include "jsvar.h"
#include "jsinteractive.h"
#include "jshardware.h"
#include "jswrapper.h"
#include "jsflash.h"
#include "jspin.h"
#include "wasm_host.h"

void *STACK_BASE; ///< used by jsuGetFreeStack on LINUX builds
extern int wasmTimeToSleep;
extern IOEventFlags jshGetEventFlagsForPin(Pin pin); // targets/wasm/jshardware.c

WASM_EXPORT void jsInit() {
  int i;
  STACK_BASE = (void*)&i;
  jshInit();
  jswHWInit();
  jsvInit(JSVAR_CACHE_SIZE);
  jsiInit(true); // true = autoload saved code (.bootcde etc) from Storage
}

/**
 * Run the interpreter until it would sleep. Returns the ms until it must be called again;
 * 0 means it still has work queued. jsiLoop only sleeps after an idle pass, so a few
 * passes are normally needed; the cap keeps a busy program from blocking the host.
 */
WASM_EXPORT int jsIdle() {
  wasmTimeToSleep = -1;
  for (int pass = 0; pass < 16 && wasmTimeToSleep < 0; pass++)
    jsiLoop();
  return wasmTimeToSleep < 0 ? 0 : wasmTimeToSleep;
}

WASM_EXPORT void jsKill() {
  jsiKill();
  jsvKill();
  jshKill();
}

/// Device number of the console, for jshPushIOCharEvent / jshGetDeviceToTransmit
WASM_EXPORT int wasmConsoleDevice() { return EV_USBSERIAL; }

/// The host changed the level of a pin that may be watched (setWatch)
WASM_EXPORT void wasmSendPinWatchEvent(int pin) {
  IOEventFlags ev = jshGetEventFlagsForPin((Pin)pin);
  if (ev != EV_NONE) jshPushIOWatchEvent(ev);
}

/// Pin number for a name like "A9" or "BTN1", or -1
WASM_EXPORT int wasmPinFromName(const char *name) {
  Pin pin = jshGetPinFromString(name);
  return pin == PIN_UNDEFINED ? -1 : (int)pin;
}

/// Memory the host can fill before calling the functions below
WASM_EXPORT void *wasmAlloc(size_t size) { return malloc(size); }
WASM_EXPORT void wasmFree(void *ptr) { free(ptr); }

/**
 * Write (part of) a Storage file, like require("Storage").write(name, data, offset, size).
 * The first chunk of a file must have offset 0 and the file's total size; later chunks
 * are written at their offset. Returns 1 on success.
 */
WASM_EXPORT int wasmStorageWrite(const char *name, const char *data, int length, int offset, int totalSize) {
  JsVar *chunk = jsvNewStringOfLength((unsigned int)length, data);
  if (!chunk) return 0; // out of memory
  bool ok = jsfWriteFile(jsfNameFromString(name), chunk, JSFF_NONE, offset, totalSize);
  jsvUnLock(chunk);
  return ok ? 1 : 0;
}
