// The emulated board's sound, through the browser's Web Audio. The emulator hands over 16 bit
// mono samples as they become due (runtime/espruino.js onAudio); each block is scheduled right
// after the last, a little ahead of time, so the sound plays continuously.
//
// Browsers only start sound after the person has clicked or pressed a key on the page, so the
// AudioContext is resumed on the first such event.

const LEAD = 0.08; // seconds of sound queued ahead, to ride out timer jitter

export class AudioOut {
  constructor() {
    this.ctx = null;
    this.nextTime = 0;
    this.enabled = true;
    this.volume = 1;
    const unlock = () => this.ctx?.state === 'suspended' && this.ctx.resume();
    for (const type of ['pointerdown', 'keydown']) addEventListener(type, unlock, { capture: true });
  }

  #context() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.gain.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  setVolume(v) {
    this.volume = v;
    if (this.gain) this.gain.gain.value = v;
  }

  /** Queue samples (Int16Array) at `rate` Hz. */
  push(samples, rate) {
    if (!this.enabled || !samples.length) return;
    const ctx = this.#context();
    if (!ctx || ctx.state !== 'running') return; // not allowed yet (no click), or no Web Audio
    const buffer = ctx.createBuffer(1, samples.length, rate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) data[i] = samples[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.gain);
    const now = ctx.currentTime;
    if (this.nextTime < now + 0.01) this.nextTime = now + LEAD; // first block, or we fell behind
    src.start(this.nextTime);
    this.nextTime += buffer.duration;
  }
}
