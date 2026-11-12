// The pure data behind two dashboard tools on the "ID, lists & notes" page: the ID card designs
// (public/js/idtemplates.js) and the character sheet (public/js/charsheet.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ID_TEMPLATES, idTemplate, fieldLabel } from '../public/js/idtemplates.js';
import { normaliseSheet, SPECIAL, SHEET_DEFAULT, SHEET_PATH } from '../public/js/charsheet.js';
import { encodeWav, mixDown, clipNames, scanToPresets, CLIP_RATE } from '../public/js/radio-tools.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

test('ID card designs: unique ids, five short labels starting with NAME, and emblems the server will serve', async () => {
  assert.equal(new Set(ID_TEMPLATES.map((t) => t.id)).size, ID_TEMPLATES.length);
  assert.equal(ID_TEMPLATES[0].id, 'dweller', 'the original design stays the default');
  for (const t of ID_TEMPLATES) {
    assert.match(t.id, /^[a-z]+$/);
    assert.ok(t.name && t.title && t.footer, t.id);
    assert.equal(t.labels.length, 5, t.id);
    assert.equal(t.labels[0], 'NAME');
    assert.equal(t.labels[2], 'DOB', `${t.id}: the third field is the date of birth`);
    for (const l of t.labels) assert.match(l, /^[A-Z]{2,6}$/, `${t.id}: "${l}" must fit the 70 px label column`);
    assert.ok(t.footer.length <= 15, `${t.id}: the footer sits under the photo`);
    if (t.emblem) assert.match(t.emblem, /^\/assets\/official\/[^/]+\.(png|jpe?g|svg)$/i, `${t.id}: server/app.js only serves these`);
  }
  // the pictures themselves, when the owner's assets folder is there
  const have = await access(path.join(ROOT, 'assets/official')).then(() => true, () => false);
  if (have) for (const t of ID_TEMPLATES.filter((x) => x.emblem)) assert.ok((await readFile(path.join(ROOT, t.emblem))).length > 0, t.emblem);
  assert.equal(idTemplate('legion').title, 'LEGION OF CAESAR');
  assert.equal(idTemplate('nope').id, 'dweller');
  assert.equal(idTemplate(undefined).id, 'dweller', 'cards saved before designs existed');
  assert.equal(fieldLabel('COHORT'), 'Cohort');
  assert.equal(fieldLabel('DOB'), 'Date of birth');
});

test('character sheet: any input becomes a level of 1..99 and seven attributes of 1..10', () => {
  assert.equal(SHEET_PATH, 'USER/CHAR.json');
  assert.equal(SPECIAL.length, 7);
  assert.deepEqual(normaliseSheet(null), { level: 1, special: [5, 5, 5, 5, 5, 5, 5] });
  assert.deepEqual(normaliseSheet(SHEET_DEFAULT), { level: 1, special: [5, 5, 5, 5, 5, 5, 5] });
  assert.deepEqual(normaliseSheet({ level: '12', special: ['6', 7, 5.4, 4, 8, 6, 5] }), { level: 12, special: [6, 7, 5, 4, 8, 6, 5] });
  assert.deepEqual(normaliseSheet({ level: 500, special: [0, 11, -3, 'x', '', null] }), { level: 99, special: [1, 10, 1, 5, 5, 5, 5] });
  assert.deepEqual(normaliseSheet({ level: 0, special: 'junk' }), { level: 1, special: [5, 5, 5, 5, 5, 5, 5] });
});

test('radio clips: a 16 kHz mono 16 bit WAV, like the Pip-Boy\'s own, named by clip type', () => {
  const wav = encodeWav(Float32Array.from([0, 1, -1, 0.5, 2, -2]));
  const view = new DataView(wav.buffer);
  const tag = (at) => String.fromCharCode(...wav.slice(at, at + 4));
  assert.deepEqual([tag(0), tag(8), tag(12), tag(36)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.equal(wav.length, 44 + 12);
  assert.equal(view.getUint32(4, true), wav.length - 8);
  assert.deepEqual([view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)], [1, 1, CLIP_RATE, 16], 'PCM, mono, 16000 Hz, 16 bit');
  assert.equal(view.getUint32(28, true), 32000);
  assert.equal(view.getUint32(40, true), 12);
  // full scale both ways, and anything louder is clipped rather than wrapped
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((i) => view.getInt16(44 + i * 2, true)), [0, 32767, -32768, 16384, 32767, -32768]);
  assert.deepEqual([...mixDown([Float32Array.from([1, 0]), Float32Array.from([0, 0.5])])], [0.5, 0.25]);
  const one = Float32Array.from([0.25]);
  assert.equal(mixDown([one]), one);

  assert.deepEqual(clipNames(['MX', 'DX', 'MX', 'SFX', 'DX']), ['MX50.wav', 'DX50.wav', 'MX51.wav', 'SFX50.wav', 'DX51.wav']);
  assert.deepEqual(clipNames(['MX', 'nope'], '7'), ['MX07.wav', 'MX08.wav']);
  assert.deepEqual(clipNames(['MX'], 500), ['MX99.wav']);
  assert.deepEqual(clipNames(['MX'], 'x'), ['MX01.wav']);
});

test('FM scan import: new stations only, as presets the records API accepts', () => {
  const scan = { at: 1, stations: [{ frequency: 96.3, level: 50 }, { frequency: 101.7, level: 60 }, { frequency: 140 }, { frequency: 96.3 }, null, { frequency: 'x' }] };
  assert.deepEqual(scanToPresets(scan, ['101.7']), [{ name: 'FM 96.3', frequency: '96.3' }]);
  assert.deepEqual(scanToPresets(scan), [{ name: 'FM 96.3', frequency: '96.3' }, { name: 'FM 101.7', frequency: '101.7' }]);
  assert.deepEqual(scanToPresets(null), []);
  assert.deepEqual(scanToPresets({ stations: 'junk' }), []);
});
