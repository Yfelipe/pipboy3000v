/*
 * This file is part of Espruino, a JavaScript interpreter for Microcontrollers
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * ----------------------------------------------------------------------------
 * The Pip-Boy's audio output (libs/pipboy/stm32_i2s.h) for the WebAssembly build.
 *
 * On the device, the Pip library adds 16 bit mono samples to a ring buffer and the I2S
 * peripheral's DMA plays them out to the codec. Here the same ring buffer is drained by the
 * JavaScript host instead (wasmAudioRead), at the sample rate in real time, and played
 * through the browser's Web Audio. As on the device, playback starts once enough is buffered
 * (or the stream has ended), and stops - firing Pip's audioStopped - when the buffer runs dry.
 * ----------------------------------------------------------------------------
 */
#include <string.h>
#include "jsutils.h"
#include "jshardware.h"
#include "stm32_i2s.h"
#include "wasm_host.h"

#define RING_MASK (I2S_RING_BUFFER_SIZE - 1)
#define START_THRESHOLD (3 * I2S_DMA_BUFFER_SIZE / 2) // as the device: 3 DMA buffers' worth (stereo -> mono)

static int16_t ring[I2S_RING_BUFFER_SIZE];
static int ringIn = 0, ringOut = 0;
static STM32_I2S_Status status = STM32_I2S_STOPPED;
static int sampleRate = 16000;
/// The last samples played, laid out as the device's DMA buffer (L,R pairs), for Pip.getAudioWaveform
static int16_t played[I2S_DMA_BUFFER_SIZE];

static int queued() {
  int s = ringIn - ringOut;
  return s < 0 ? s + I2S_RING_BUFFER_SIZE : s;
}

void STM32_I2S_Init() { ringIn = ringOut = 0; status = STM32_I2S_STOPPED; }
void STM32_I2S_Kill() { STM32_I2S_Stop(); }

void STM32_I2S_Prepare(int audioFreq) {
  if (status == STM32_I2S_PLAYING) return; // already going: carry on at the same rate
  sampleRate = audioFreq > 0 ? audioFreq : 16000;
}

int STM32_I2S_GetFreeSamples() { return I2S_RING_BUFFER_SIZE - 1 - queued(); }

void STM32_I2S_AddSamples(int16_t *data, unsigned int count, bool overlap) {
  if (overlap) { // mix into what's waiting to be played, then add the rest
    int idx = ringOut, waiting = queued();
    unsigned int i = 0;
    for (; i < count && (int)i < waiting; i++) {
      int v = ring[idx] + data[i];
      ring[idx] = (int16_t)(v > 32767 ? 32767 : v < -32768 ? -32768 : v);
      idx = (idx + 1) & RING_MASK;
    }
    data += i;
    count -= i;
  }
  while (count-- && STM32_I2S_GetFreeSamples() > 0) {
    ring[ringIn] = *data++;
    ringIn = (ringIn + 1) & RING_MASK;
  }
  if (status == STM32_I2S_STOPPED && queued() >= START_THRESHOLD) STM32_I2S_Start();
}

void STM32_I2S_Start() { if (queued()) status = STM32_I2S_PLAYING; }

void STM32_I2S_Stop() {
  status = STM32_I2S_STOPPED;
  ringIn = ringOut = 0;
}

void STM32_I2S_StreamEnded() {
  if (status == STM32_I2S_STOPPED && queued()) STM32_I2S_Start();
}

uint16_t *STM32_I2S_GetSampleBufferPtr() { return (uint16_t *)played; }
STM32_I2S_Status STM32_I2S_GetStatus() { return status; }

/// For the host: the sample rate of what's playing
WASM_EXPORT int wasmAudioRate() { return sampleRate; }
/// For the host: is audio playing?
WASM_EXPORT int wasmAudioPlaying() { return status == STM32_I2S_PLAYING; }
/// For the host: take up to `max` samples that are due to play into `dst`. Returns how many.
/// When the buffer runs dry playback stops, as the device's DMA interrupt does.
WASM_EXPORT int wasmAudioRead(int16_t *dst, int max) {
  if (status != STM32_I2S_PLAYING) return 0;
  int n = 0;
  while (n < max && ringOut != ringIn) {
    dst[n++] = ring[ringOut];
    ringOut = (ringOut + 1) & RING_MASK;
  }
  // keep the newest samples for the waveform display, duplicated L/R as the device's DMA buffer
  int keep = n < I2S_DMA_BUFFER_SIZE / 2 ? n : I2S_DMA_BUFFER_SIZE / 2;
  if (keep) {
    memmove(played, played + keep * 2, (size_t)(I2S_DMA_BUFFER_SIZE - keep * 2) * sizeof(int16_t));
    for (int i = 0; i < keep; i++) {
      int16_t s = dst[n - keep + i];
      played[I2S_DMA_BUFFER_SIZE - keep * 2 + i * 2] = s;
      played[I2S_DMA_BUFFER_SIZE - keep * 2 + i * 2 + 1] = s;
    }
  }
  if (ringOut == ringIn) STM32_I2S_Stop();
  return n;
}
