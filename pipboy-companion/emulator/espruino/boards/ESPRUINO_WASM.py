#!/bin/false
# This file is part of Espruino, a JavaScript interpreter for Microcontrollers
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# ----------------------------------------------------------------------------------------
# Generic Espruino compiled to WebAssembly (WASI), for running any Espruino program in a
# browser or Node.js. A 320x240 16 bit display, two buttons, three LEDs, Storage and a
# filesystem. The JavaScript host provides time, pins and input, and reads the console
# and the display (see targets/wasm and emulator/runtime/espruino.js).
# ----------------------------------------------------------------------------------------

import pinutils;
info = {
 'name' : "Espruino WebAssembly emulator",
 'default_console' : "EV_USBSERIAL",
 'variables' : 12000,
 'binary_name' : 'espruino_wasm.wasm',
 'build' : {
   'libraries' : [
     'GRAPHICS',
     'FILESYSTEM',
   ],
   'makefile' : [
     'WASM=1',
     'LINUX=1', # POSIX file access (via WASI) instead of FatFS on an SD card
     'USE_DEBUGGER=0', # single-threaded host: no IRQ-driven debugger
     'DEFINES += -DUSE_CALLFUNCTION_HACK', # call natives with exact signatures (required by WebAssembly)
     'DEFINES += -DUSE_LCD_SDL', # targets/wasm/lcd_wasm.c implements the lcd_sdl.h interface
     'DEFINES += -DESPR_UNICODE_SUPPORT=1',
     'DEFINES += -DUSE_FONT_6X8 -DGRAPHICS_PALETTED_IMAGES -DGRAPHICS_ANTIALIAS -DESPR_PBF_FONTS -DESPR_GRAPHICS_INTERNAL -DESPR_GRAPHICS_SELF_INIT',
   ]
 }
};

chip = {
  'part' : "WASM",
  'family' : "WASM",
  'package' : "",
  'ram' : 0,
  'flash' : 1024,
  'speed' : -1,
  'usart' : 1,
  'spi' : 1,
  'i2c' : 1,
  'adc' : 0,
  'dac' : 0,
  'saved_code' : {
    'address' : 0x08000000,
    'page_size' : 4096,
    'pages' : 256, # 1 MB of Storage
    'flash_available' : 1024
  },
};

devices = {
  'USB' : {}, # the console
  'BTN1' : { 'pin' : 'D0' },
  'BTN2' : { 'pin' : 'D1' },
  'LED1' : { 'pin' : 'D2' },
  'LED2' : { 'pin' : 'D3' },
  'LED3' : { 'pin' : 'D4' },
  'LCD' : { 'width' : 320, 'height' : 240, 'bpp' : 16, 'controller' : 'sdl' },
};

def get_pins():
  return pinutils.generate_pins(0,31) # D0 .. D31
