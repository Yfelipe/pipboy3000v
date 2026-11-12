// The pure parts of two Radio presets tools: turning audio into the Pip-Boy's radio clips, and
// reading the FM scan holotape's results. No DOM and no Web Audio here, so tests can run it.
import { parseFrequency } from '../../shared/validate.js';

/** The Pip-Boy plays WAV files like its own: 16 kHz, mono, 16 bit. */
export const CLIP_RATE = 16000;
/**
 * The stock radio chooses a clip by the start of its name in the SD card's RADIO folder
 * (CLIP_TYPE in Pip-OS): MX for music, DX for voice, SFX for sound effects.
 */
export const CLIP_TYPES = Object.freeze([
  { id: 'MX', name: 'Music' },
  { id: 'DX', name: 'Voice (DJ)' },
  { id: 'SFX', name: 'Sound effect' },
]);

/** Average the channels of decoded audio into one. channels: Float32Array[] of equal length. */
export function mixDown(channels) {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i] / channels.length;
  return out;
}

/** Samples in -1..1 as a 16 bit mono WAV file. */
export function encodeWav(samples, rate = CLIP_RATE) {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); // PCM header size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // bytes a second
  view.setUint16(32, 2, true); // bytes a sample
  view.setUint16(34, 16, true); // bits a sample
  text(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
  }
  return bytes;
}

/**
 * File names for clips of the given types (['MX', 'DX', 'MX']), numbered from `start` within
 * each type: MX50.wav, DX50.wav, MX51.wav. Start high to leave the Pip-Boy's own clips alone.
 */
export function clipNames(types, start = 50) {
  const first = Math.min(99, Math.max(1, Math.round(Number(start)) || 1));
  const next = {};
  return types.map((t) => {
    const type = CLIP_TYPES.some((c) => c.id === t) ? t : 'MX';
    const n = next[type] ?? first;
    next[type] = n + 1;
    return `${type}${String(n).padStart(2, '0')}.wav`;
  });
}

/**
 * Stations from the FM scan holotape's USER/FMSCAN.json ({ stations: [{ frequency }] }) that
 * aren't saved yet. existing: the saved presets' frequencies ("101.7"). Returns
 * [{ name: "FM 101.7", frequency: "101.7" }]; anything that isn't an FM frequency is left out.
 */
export function scanToPresets(data, existing = []) {
  const have = new Set(existing.map(String));
  const out = [];
  for (const s of Array.isArray(data?.stations) ? data.stations : []) {
    let frequency;
    try {
      frequency = parseFrequency(Number(s?.frequency));
    } catch {
      continue;
    }
    if (have.has(frequency)) continue;
    have.add(frequency);
    out.push({ name: `FM ${frequency}`, frequency });
  }
  return out;
}
