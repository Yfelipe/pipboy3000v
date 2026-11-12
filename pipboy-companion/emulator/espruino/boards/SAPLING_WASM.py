#!/bin/false
# This file is part of Espruino, a JavaScript interpreter for Microcontrollers
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# ----------------------------------------------------------------------------------------
# PROTOTYPE: the Fallout 3 / New Vegas Pip-Boy 3000 ("FO3", board SAPLING) compiled to WebAssembly.
#
# The Wand Company hasn't published this board, so this is a best guess: the Mk V emulator
# (PIPBOY_WASM.py) with the FO3's controls from The Wand Company's diagram mapped onto it.
#   - Same 480x320 16 bit screen (the FO3 has a 320x480 IPS LCD), same Pip library, SD card,
#     radio and Espruino 2v29 (the FO3's release notes: "Espruino updated from 2v28 to 2v29").
#   - Primary scroll + click select, secondary scroll, power and torch: the Mk V's wheel, press,
#     thumbwheel, power and torch pins (BTN8/9, BTN7, BTN5/6, BTN10, BTN4).
#   - The three illuminated mode select buttons (STATS, ITEMS, DATA): BTN1-3, the Mk V's three
#     front buttons, with their lamps on LED5-7.
#   - The page selector: a five-position knob read by voltage on A7, like the Mk V's mode dial.
#   - The backlit rad meter: its needle driven by analogWrite() on B8, its backlight LED8.
#   - 256 KB of Storage and 6000 variables (unknown on the device).
# Pin numbers for the new parts are invented. Replace them when the real board is known.
#
# The rest, as PIPBOY_WASM.py:
#
# Same as boards/PIPBOY.py where it matters to software: STM32F407 pin names (so firmware
# referencing A9, B15, BTN10 etc. runs), the LED/button assignments, 5000 variables and
# 128 KB of Storage, 480x320 16 bit display, and the Pip-Boy library (libs/pipboy) built in
# its LINUX/emulated mode as in boards/PIPBOY_LINUX.py. The SD card is the host filesystem's
# root. Build it from the commit the device's firmware came from (see ESPRUINO_COMMIT).
# ----------------------------------------------------------------------------------------

import pinutils;
info = {
 'name' : "Pip-Boy 3000 (FO3) WebAssembly emulator - prototype",
 'boardname' : "SAPLING", # process.env.BOARD, as The Wand Company's tools name this board
 'default_console' : "EV_USBSERIAL",
 'variables' : 12000, # a guess, with room for the FO3 firmware's screens (loaded from the SD card)
 'io_buffer_size' : 2048, # as boards/PIPBOY.py since 2v29 (Pip-OS 1.33)
 'xoff_thresh' : 3,
 'xon_thresh' : 2,
 'binary_name' : 'sapling_wasm.wasm',
 'build' : {
   'libraries' : [
     'GRAPHICS',
     'FILESYSTEM',
   ],
   'makefile' : [
     'WASM=1',
     'LINUX=1', # POSIX file access (via WASI) instead of FatFS over SDIO
     'USE_DEBUGGER=0',
     'DEFINES += -DUSE_CALLFUNCTION_HACK',
     'DEFINES += -DUSE_LCD_SDL', # targets/wasm/lcd_wasm.c implements the lcd_sdl.h interface
     'DEFINES += -DESPR_UNICODE_SUPPORT=1',
     'DEFINES += -DUSE_FONT_6X8 -DGRAPHICS_PALETTED_IMAGES -DGRAPHICS_ANTIALIAS -DESPR_PBF_FONTS -DESPR_GRAPHICS_INTERNAL -DESPR_GRAPHICS_SELF_INIT -DESPR_GRAPHICS_NO_SPLASH',
     'DEFINES += -DLCD_ORIENTATION_LANDSCAPE',
     'DEFINES += -DESPR_FS_MKFS -DESPR_FS_GETFREE', # fs.getFree/mkfs exist on the device since 2v29
     'DEFINES += -DESPR_OFFICIAL_BOARD',
     # The device has about 4 KB of free stack at the prompt. Storage compaction needs a buffer
     # the size of its 128 KB page on the stack or in JS variables, which the device can't
     # provide once the firmware is installed - so neither can the emulator.
     'DEFINES += -DESPR_STACK_SIZE=32768',
     'INCLUDE += -I$(ROOT)/libs/pipboy',
     'WRAPPERSOURCES += libs/pipboy/avi.c libs/pipboy/stm32_i2s.c',
     'SOURCES += targets/wasm/audio_wasm.c', # the audio output: the host plays what libs/pipboy queues
     'LDFLAGS += -Wl,--export=wasmAudioRead -Wl,--export=wasmAudioRate -Wl,--export=wasmAudioPlaying',
     'WRAPPERSOURCES += libs/pipboy/jswrap_pipboy.c',
     'WRAPPERSOURCES += libs/pipboy/jswrap_font_monofonto_120.c',
     'WRAPPERSOURCES += libs/pipboy/jswrap_font_monofonto_96.c',
     'WRAPPERSOURCES += libs/pipboy/jswrap_font_monofonto_36.c',
     'WRAPPERSOURCES += libs/pipboy/jswrap_font_monofonto_28.c',
     'WRAPPERSOURCES += libs/pipboy/jswrap_font_monofonto_23.c',
     'WRAPPERSOURCES += libs/pipboy/jswrap_font_monofonto_18.c',
     'WRAPPERSOURCES += libs/pipboy/jswrap_font_monofonto_16.c',
   ]
 }
};

chip = {
  'part' : "WASM",
  'family' : "WASM",
  'package' : "LQFP100", # for pinutils.only_from_package, as boards/PIPBOY.py
  'ram' : 0,
  'flash' : 512,
  'speed' : -1,
  'usart' : 6,
  'spi' : 3,
  'i2c' : 3,
  'adc' : 3,
  'dac' : 2,
  'saved_code' : { # a guess: one 256 KB page
    'address' : 0x08000000,
    'page_size' : 262144,
    'pages' : 1,
    'flash_available' : 512
  },
};

devices = {
  'LED1' : { 'pin' : 'E4' }, # red element of RGB LED
  'LED2' : { 'pin' : 'E5' }, # green
  'LED3' : { 'pin' : 'E6' }, # blue
  'LED4' : { 'pin' : 'E3' }, # radio tuning indicator
  'LED5' : { 'pin' : 'E7' }, # STATS button lamp (FO3)
  'LED6' : { 'pin' : 'E8' }, # ITEMS button lamp
  'LED7' : { 'pin' : 'E9' }, # DATA button lamp
  'LED8' : { 'pin' : 'E10' }, # rad meter backlight
  'BTN1' : { 'pin' : 'A1' }, # mode select: STATS (the Mk V's "Play")
  'BTN2' : { 'pin' : 'E1' }, # mode select: ITEMS (the Mk V's "Up")
  'BTN3' : { 'pin' : 'E2' }, # mode select: DATA (the Mk V's "Down")
  'BTN4' : { 'pin' : 'A2' }, # torch
  'BTN5' : { 'pin' : 'A10' }, # secondary scroll A
  'BTN6' : { 'pin' : 'A8' }, # secondary scroll B
  'BTN7' : { 'pin' : 'A3' }, # click select (pressing the primary scroll)
  'BTN8' : { 'pin' : 'B1' }, # primary scroll A
  'BTN9' : { 'pin' : 'B0' }, # primary scroll B
  'BTN10' : { 'pin' : 'A0' }, # power
  # Pins below are as boards/PIPBOY.py: libs/pipboy and the firmware's JS use them
  'BAT' : { 'pin_sense_en' : 'C4', 'pin_voltage' : 'A6', 'pin_charging' : 'C5' },
  'SD' : { 'pin_cd' : 'A15', 'pin_pwr' : 'D3' }, # card detect, card/audio power
  'LCD' : {
            'width' : 480, 'height' : 320, 'bpp' : 16, 'controller' : 'sdl',
            'pin_bl' : 'B15', # backlight
            'pin_tearing' : 'D12',
          },
  'USB' : { 'pin_vsense' : 'A9' }, # the console; A9 high = USB power present
};

def get_pins():
  # As boards/PIPBOY.py, so the same pin names exist and buttons/LEDs are negated the same way
  pins = pinutils.scan_pin_file([], 'stm32f40x.csv', 6, 9, 10)
  pins = pinutils.scan_pin_af_file(pins, 'stm32f405_af.csv', 0, 1)
  pins = pinutils.only_from_package(pinutils.fill_gaps_in_pin_list(pins), chip["package"])
  for name in ["PE4","PE5","PE6","PE3","PA1","PE1","PE2","PA2","PA10","PA8","PA3","PB1","PB0","PA0"]:
    pinutils.findpin(pins, name, True)["functions"]["NEGATED"]=0
  return pins
