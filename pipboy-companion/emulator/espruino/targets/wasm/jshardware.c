/*
 * This file is part of Espruino, a JavaScript interpreter for Microcontrollers
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * ----------------------------------------------------------------------------
 * Hardware layer for the WebAssembly build. Time and pins come from the
 * JavaScript host (wasm_host.h); flash is a buffer in our own memory.
 * I2C goes to the host, whose emulated chips answer (runtime/i2c.js). Other peripherals
 * without an emulation (SPI, USART) are accepted and do nothing, as on targets/emscripten.
 * ----------------------------------------------------------------------------
 */
#include <stdlib.h>
#include <string.h>
#include <math.h>

#include "platform_config.h"
#include "jshardware.h"
#include "jsutils.h"
#include "jsparse.h"
#include "jsinteractive.h"
#include "jstimer.h"
#include "wasm_host.h"


int wasmTimeToSleep = -1; ///< set by jshSleep, returned by jsIdle
static Pin eventFlagsToPin[ESPR_EXTI_COUNT];

// ---------------------------------------------------------------------------- lifecycle

void jshInit() {
  for (int i = 0; i < ESPR_EXTI_COUNT; i++)
    eventFlagsToPin[i] = PIN_UNDEFINED;
  jshInitDevices();
}

void jshReset() {
  jshResetDevices();
}

void jshKill() {
}

// The utility timer (require("timer") tasks, soft PWM, digitalPulse sequences): run from the main
// loop when it's due, as the timer interrupt would on the device. The FO3 firmware fades its LEDs
// with a require("timer") EXEC task, so they'd never move without this.
static bool utilTimerOn = false;
static JsSysTime utilTimerDue = 0;

static void runUtilTimer() {
  for (int i = 0; i < 64 && utilTimerOn && jshGetSystemTime() >= utilTimerDue; i++) {
    utilTimerOn = false; // the handler reschedules it if more tasks are waiting
    jstUtilTimerInterruptHandler();
  }
}

void jshIdle() {
  runUtilTimer();
}

void jshBusyIdle() {
  wasmHostBusyIdle();
}

/// Enter sleep: we can't block, so tell the host how long until we need to run again
bool jshSleep(JsSysTime timeUntilWake) {
  JsVarFloat ms = jshGetMillisecondsFromTime(timeUntilWake);
  if (ms > 0x7FFFFFFF) ms = 0x7FFFFFFF;
  if (ms < 0) ms = 0;
  if (utilTimerOn) { // wake up for the next utility timer task
    JsVarFloat due = jshGetMillisecondsFromTime(utilTimerDue - jshGetSystemTime());
    if (due < ms) ms = due < 0 ? 0 : due;
  }
  wasmTimeToSleep = (int)ms;
  return false;
}

void jshReboot() {
  wasmHostReboot(); // throws in the host, unwinding out of the module, which is then restarted
}

int jshGetSerialNumber(unsigned char *data, int maxChars) {
  const char serial[] = "WASM-EMULATOR";
  int n = (int)sizeof(serial) - 1;
  if (n > maxChars) n = maxChars;
  memcpy(data, serial, (size_t)n);
  return n;
}

// ---------------------------------------------------------------------------- interrupts (single-threaded)

void jshInterruptOff() {}
void jshInterruptOn() {}
bool jshIsInInterrupt() { return false; }
void jshDelayMicroseconds(int microsec) { (void)microsec; }

// ---------------------------------------------------------------------------- time

JsSysTime jshGetTimeFromMilliseconds(JsVarFloat ms) {
  return (JsSysTime)(ms * 1000);
}

JsVarFloat jshGetMillisecondsFromTime(JsSysTime time) {
  return ((JsVarFloat)time) / 1000;
}

JsSysTime jshGetSystemTime() {
  return jshGetTimeFromMilliseconds(wasmHostNow());
}

void jshSetSystemTime(JsSysTime time) {
  (void)time; // the host clock is authoritative
}

// ---------------------------------------------------------------------------- pins

static JshPinState pinStates[JSH_PIN_COUNT];

void jshPinSetState(Pin pin, JshPinState state) {
  if (pin < JSH_PIN_COUNT) pinStates[pin] = state;
}

JshPinState jshPinGetState(Pin pin) {
  return pin < JSH_PIN_COUNT ? pinStates[pin] : JSHPINSTATE_UNDEFINED;
}

void jshPinSetValue(Pin pin, bool value) {
  if (pinInfo[pin].port & JSH_PIN_NEGATED) value = !value;
  wasmHostPinSet(pin, value);
}

bool jshPinGetValue(Pin pin) {
  bool value = wasmHostPinGet(pin) != 0;
  if (pinInfo[pin].port & JSH_PIN_NEGATED) value = !value;
  return value;
}

JsVarFloat jshPinAnalog(Pin pin) {
  return wasmHostPinAnalog(pin);
}

int jshPinAnalogFast(Pin pin) {
  return (int)(wasmHostPinAnalog(pin) * 65535);
}

JshPinFunction jshPinAnalogOutput(Pin pin, JsVarFloat value, JsVarFloat freq, JshAnalogOutputFlags flags) {
  (void)freq; (void)flags;
  wasmHostPinAnalogOut(pin, value); // the duty, for the host to show (e.g. a meter's needle)
  jshPinSetValue(pin, value > 0); // and as a level: any duty above 0 shows as on (e.g. dimmed LEDs)
  return JSH_NOTHING;
}

JshPinFunction jshGetCurrentPinFunction(Pin pin) { (void)pin; return JSH_NOTHING; }
void jshSetOutputValue(JshPinFunction func, int value) { (void)func; (void)value; }

bool jshCanWatch(Pin pin) { (void)pin; return true; }

IOEventFlags jshGetEventFlagsForPin(Pin pin) {
  for (int i = 0; i < ESPR_EXTI_COUNT; i++)
    if (eventFlagsToPin[i] == pin)
      return EV_EXTI0 + i;
  return EV_NONE;
}

IOEventFlags jshPinWatch(Pin pin, bool shouldWatch, JshPinWatchFlags flags) {
  (void)flags;
  if (shouldWatch) {
    IOEventFlags existing = jshGetEventFlagsForPin(pin);
    if (existing != EV_NONE) return existing;
    for (int i = 0; i < ESPR_EXTI_COUNT; i++)
      if (eventFlagsToPin[i] == PIN_UNDEFINED) {
        eventFlagsToPin[i] = pin;
        return EV_EXTI0 + i;
      }
  } else {
    for (int i = 0; i < ESPR_EXTI_COUNT; i++)
      if (eventFlagsToPin[i] == pin)
        eventFlagsToPin[i] = PIN_UNDEFINED;
  }
  return EV_NONE;
}

bool jshGetWatchedPinState(IOEventFlags device) {
  return jshPinGetValue(eventFlagsToPin[device - EV_EXTI0]);
}

bool jshIsEventForPin(IOEventFlags eventFlags, Pin pin) {
  return IOEVENTFLAGS_GETTYPE(eventFlags) == jshGetEventFlagsForPin(pin);
}

// ---------------------------------------------------------------------------- devices without an emulation

bool jshIsDeviceInitialised(IOEventFlags device) { (void)device; return true; }
bool jshIsUSBSERIALConnected() { return true; }

void jshUSARTSetup(IOEventFlags device, JshUSARTInfo *inf) { (void)device; (void)inf; }
void jshUSARTKick(IOEventFlags device) { (void)device; }

void jshSPISetup(IOEventFlags device, JshSPIInfo *inf) { (void)device; (void)inf; }
int jshSPISend(IOEventFlags device, int data) { (void)device; (void)data; return -1; }
void jshSPISend16(IOEventFlags device, int data) { (void)device; (void)data; }
void jshSPISet16(IOEventFlags device, bool is16) { (void)device; (void)is16; }
void jshSPISetReceive(IOEventFlags device, bool isReceive) { (void)device; (void)isReceive; }
void jshSPIWait(IOEventFlags device) { (void)device; }

void jshI2CSetup(IOEventFlags device, JshI2CInfo *inf) { (void)device; (void)inf; }
void jshI2CWrite(IOEventFlags device, unsigned char address, int nBytes, const unsigned char *data, bool sendStop) {
  (void)sendStop;
  int bus = (int)(device - EV_I2C1) + 1;
  if (!wasmHostI2CWrite(bus, address, data, nBytes))
    jsExceptionHere(JSET_ERROR, "I2C%d: no device at address %d", bus, address);
}
void jshI2CRead(IOEventFlags device, unsigned char address, int nBytes, unsigned char *data, bool sendStop) {
  (void)sendStop;
  int bus = (int)(device - EV_I2C1) + 1;
  if (!wasmHostI2CRead(bus, address, data, nBytes)) {
    memset(data, 0, (size_t)nBytes);
    jsExceptionHere(JSET_ERROR, "I2C%d: no device at address %d", bus, address);
  }
}

void jshUtilTimerDisable() { utilTimerOn = false; }
void jshUtilTimerReschedule(JsSysTime period) { utilTimerDue = jshGetSystemTime() + period; utilTimerOn = true; }
void jshUtilTimerStart(JsSysTime period) { jshUtilTimerReschedule(period); }

void jshEnableWatchDog(JsVarFloat timeout) { (void)timeout; }
void jshKickWatchDog() {}

JsVarFloat jshReadTemperature() { return NAN; }
JsVarFloat jshReadVRef() { return 3.3; } // analogRead() is relative to a 3.3 V supply
unsigned int jshGetRandomNumber() { return (unsigned int)rand(); }
unsigned int jshSetSystemClock(JsVar *options) { (void)options; return 0; }

// ---------------------------------------------------------------------------- flash (Storage)

/**
 * Storage lives in our own memory so it can be memory-mapped, as on the real chips:
 * require("Storage").read() and boot code (.bootcde) then run straight from flash
 * instead of being copied into JsVars. The host saves and restores this buffer
 * (wasmFlashBuffer) to keep Storage across reboots.
 */
static uint8_t flashMemory[FLASH_SAVED_CODE_LENGTH];

WASM_EXPORT uint8_t *wasmFlashBuffer() { return flashMemory; }
WASM_EXPORT int wasmFlashSize() { return FLASH_SAVED_CODE_LENGTH; }

static bool flashRange(uint32_t addr, uint32_t len) {
  return addr >= FLASH_START && addr + len <= FLASH_START + FLASH_SAVED_CODE_LENGTH;
}

bool jshFlashGetPage(uint32_t addr, uint32_t *startAddr, uint32_t *pageSize) {
  if (!flashRange(addr, 1)) return false;
  *startAddr = addr - ((addr - FLASH_START) % FLASH_PAGE_SIZE);
  *pageSize = FLASH_PAGE_SIZE;
  return true;
}

JsVar *jshFlashGetFree() {
  return jsvNewEmptyArray(); // no free flash outside Storage
}

void jshFlashErasePage(uint32_t addr) {
  uint32_t startAddr, pageSize;
  if (jshFlashGetPage(addr, &startAddr, &pageSize))
    memset(&flashMemory[startAddr - FLASH_START], 0xFF, pageSize);
}

void jshFlashRead(void *buf, uint32_t addr, uint32_t len) {
  if (flashRange(addr, len)) memcpy(buf, &flashMemory[addr - FLASH_START], len);
  else memset(buf, 0xFF, len);
}

void jshFlashWrite(void *buf, uint32_t addr, uint32_t len) {
  if (!flashRange(addr, len)) return;
  uint8_t *dst = &flashMemory[addr - FLASH_START];
  const uint8_t *src = (const uint8_t*)buf;
  for (uint32_t i = 0; i < len; i++) dst[i] &= src[i]; // NOR flash: writing can only clear bits
}

// ---------------------------------------------------------------------------- device memory map

/*
 * Programs written for a real chip use its addresses directly: peek/poke on peripheral
 * registers, or E.memoryArea() on spare RAM such as the STM32F4's CCM RAM at 0x10000000
 * (the Pip-Boy firmware keeps Graphics buffers there). Espruino routes all of these through
 * jshFlashGetMemMapAddress, so this is where they are given somewhere to live:
 *   - Storage addresses map to flashMemory;
 *   - addresses inside our own linear memory (E.getAddressOf results) are used as they are;
 *   - anything else is backed by zero-filled 256KB segments allocated on first use, so
 *     registers read back what was written to them and spare RAM behaves like RAM.
 * A single E.memoryArea() must not cross a 256KB boundary. (The FO3 firmware's screen buffer
 * runs from 0x10008000 to 0x10011600, past the first 64KB.)
 */
#define DEVICE_SEGMENT_BITS 18
#define DEVICE_SEGMENT_MAX 32
static struct { uint32_t base; uint8_t *data; } deviceSegments[DEVICE_SEGMENT_MAX];
static uint8_t deviceOverflow[1 << DEVICE_SEGMENT_BITS]; ///< used once all segments are taken

static uint8_t *deviceSegment(uint32_t base) {
  for (int i = 0; i < DEVICE_SEGMENT_MAX; i++) {
    if (deviceSegments[i].data && deviceSegments[i].base == base) return deviceSegments[i].data;
    if (!deviceSegments[i].data) {
      uint8_t *data = calloc(1, 1 << DEVICE_SEGMENT_BITS);
      if (!data) break;
      deviceSegments[i].base = base;
      deviceSegments[i].data = data;
      return data;
    }
  }
  return deviceOverflow;
}

size_t jshFlashGetMemMapAddress(size_t addr) {
  if (flashRange((uint32_t)addr, 1)) return (size_t)&flashMemory[addr - FLASH_START];
  if (addr < __builtin_wasm_memory_size(0) * 65536) return addr;
  uint32_t offset = (uint32_t)addr & ((1 << DEVICE_SEGMENT_BITS) - 1);
  return (size_t)&deviceSegment((uint32_t)addr - offset)[offset];
}
