/*
 * This file is part of Espruino, a JavaScript interpreter for Microcontrollers
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * ----------------------------------------------------------------------------
 * Display for the WebAssembly build.
 *
 * Implements the interface of libs/graphics/lcd_sdl.h (used by Graphics when the board's
 * LCD controller is 'sdl'), but draws into a 16 bit RGB565 framebuffer in WebAssembly
 * memory instead of an SDL window. The host reads the framebuffer directly, using
 * wasmLcdTakeDirty() to find the area that changed since it last looked.
 * ----------------------------------------------------------------------------
 */
#include "platform_config.h"
#include "jsutils.h"
#include "graphics.h"
#include "lcd_sdl.h"
#include "wasm_host.h"

static uint16_t framebuffer[LCD_WIDTH * LCD_HEIGHT];
static int dirtyX1 = LCD_WIDTH, dirtyY1 = LCD_HEIGHT, dirtyX2 = -1, dirtyY2 = -1;

static inline void markDirty(int x1, int y1, int x2, int y2) {
  if (x1 < dirtyX1) dirtyX1 = x1;
  if (y1 < dirtyY1) dirtyY1 = y1;
  if (x2 > dirtyX2) dirtyX2 = x2;
  if (y2 > dirtyY2) dirtyY2 = y2;
}

/// Convert a colour in the Graphics instance's format to RGB565
static inline uint16_t toRGB565(JsGraphics *gfx, unsigned int col) {
  switch (gfx->data.bpp) {
    case 16: return (uint16_t)col;
    case 1: return col ? 0xFFFF : 0;
    case 8: { // 3-3-2 is a reasonable reading for a 'web' 8 bit colour
      unsigned int r = (col >> 5) & 7, g = (col >> 2) & 7, b = col & 3;
      return (uint16_t)(((r * 31 / 7) << 11) | ((g * 63 / 7) << 5) | (b * 31 / 3));
    }
    default: { // 24/32 bit RGB
      unsigned int r = (col >> 16) & 0xFF, g = (col >> 8) & 0xFF, b = col & 0xFF;
      return (uint16_t)(((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
    }
  }
}

static unsigned int lcdGetPixel_WASM(JsGraphics *gfx, int x, int y) {
  (void)gfx;
  if (x < 0 || y < 0 || x >= LCD_WIDTH || y >= LCD_HEIGHT) return 0;
  return framebuffer[y * LCD_WIDTH + x];
}

static void lcdSetPixel_WASM(JsGraphics *gfx, int x, int y, unsigned int col) {
  if (x < 0 || y < 0 || x >= LCD_WIDTH || y >= LCD_HEIGHT) return;
  framebuffer[y * LCD_WIDTH + x] = toRGB565(gfx, col);
  markDirty(x, y, x, y);
}

static void lcdFillRect_WASM(JsGraphics *gfx, int x1, int y1, int x2, int y2, unsigned int col) {
  if (x1 < 0) x1 = 0;
  if (y1 < 0) y1 = 0;
  if (x2 >= LCD_WIDTH) x2 = LCD_WIDTH - 1;
  if (y2 >= LCD_HEIGHT) y2 = LCD_HEIGHT - 1;
  if (x1 > x2 || y1 > y2) return;
  uint16_t c = toRGB565(gfx, col);
  for (int y = y1; y <= y2; y++) {
    uint16_t *row = &framebuffer[y * LCD_WIDTH];
    for (int x = x1; x <= x2; x++) row[x] = c;
  }
  markDirty(x1, y1, x2, y2);
}

void lcdInit_SDL(JsGraphics *gfx) {
  (void)gfx;
  markDirty(0, 0, LCD_WIDTH - 1, LCD_HEIGHT - 1);
}

void lcdIdle_SDL() {
  // nothing to do: the host polls wasmLcdTakeDirty()
}

void lcdSetCallbacks_SDL(JsGraphics *gfx) {
  gfx->setPixel = lcdSetPixel_WASM;
  gfx->getPixel = lcdGetPixel_WASM;
  gfx->fillRect = lcdFillRect_WASM;
}

// ---------------------------------------------------------------------------- host access

WASM_EXPORT uint16_t *wasmLcdBuffer() { return framebuffer; }
WASM_EXPORT int wasmLcdWidth() { return LCD_WIDTH; }
WASM_EXPORT int wasmLcdHeight() { return LCD_HEIGHT; }

/// Copy the changed area (x1,y1,x2,y2 inclusive) into rect[4] and reset it. Returns 0 if nothing changed.
WASM_EXPORT int wasmLcdTakeDirty(int *rect) {
  if (dirtyX2 < 0) return 0;
  rect[0] = dirtyX1; rect[1] = dirtyY1; rect[2] = dirtyX2; rect[3] = dirtyY2;
  dirtyX1 = LCD_WIDTH; dirtyY1 = LCD_HEIGHT; dirtyX2 = -1; dirtyY2 = -1;
  return 1;
}
