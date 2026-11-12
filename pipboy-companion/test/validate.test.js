import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFrequency,
  cleanName,
  normalizePayload,
  validateRecordInput,
  parseBackup,
  validateWorkspaceName,
  sanitizeWorkspaceName,
  validateStorageName,
  validateSdPath,
  sdJoin,
  validateDumpPath,
  encodeStorageFileName,
  validateMedia,
  formatSize,
  byteChecksum,
  BACKUP_FORMAT,
} from '../shared/validate.js';

describe('parseFrequency', () => {
  test('accepts the FM band edges and normalises to one decimal', () => {
    assert.equal(parseFrequency('87.5'), '87.5');
    assert.equal(parseFrequency(108), '108.0');
    assert.equal(parseFrequency(' 101.7 '), '101.7');
    assert.equal(parseFrequency('99'), '99.0');
  });
  test('rejects out-of-band, non-numeric and off-step values', () => {
    assert.throws(() => parseFrequency('87.4'), /between/);
    assert.throws(() => parseFrequency('108.1'), /between/);
    assert.throws(() => parseFrequency(''), /number/);
    assert.throws(() => parseFrequency('1e2'), /number/);
    assert.throws(() => parseFrequency('abc'), /number/);
    assert.throws(() => parseFrequency(NaN), /number/);
    assert.throws(() => parseFrequency('101.75'), /0\.1 MHz/);
  });
});

describe('records', () => {
  test('cleanName trims and enforces limits', () => {
    assert.equal(cleanName('  Holotape  '), 'Holotape');
    assert.throws(() => cleanName('   '), /required/);
    assert.throws(() => cleanName('x'.repeat(101)), /100/);
    assert.throws(() => cleanName('bad\u0000name'), /control/);
    assert.throws(() => cleanName(42), /text/);
  });

  test('normalizePayload accepts objects and legacy JSON strings', () => {
    assert.deepEqual(normalizePayload('app', { version: ' v1 ' }), { version: 'v1' });
    assert.deepEqual(normalizePayload('app', '{"version":"v2"}'), { version: 'v2' });
    assert.deepEqual(normalizePayload('app', {}), { version: '' });
    assert.deepEqual(normalizePayload('radio', { frequency: '101.7' }), { frequency: '101.7' });
    assert.throws(() => normalizePayload('radio', '{bad'), /valid JSON/);
    assert.throws(() => normalizePayload('radio', []), /object/);
  });

  test('settings payload fills defaults and rejects unknown values', () => {
    assert.deepEqual(normalizePayload('settings', { theme: 'Amber' }), {
      brightness: 'Medium', volume: 'Medium', theme: 'Amber', clock: '24-hour',
    });
    assert.throws(() => normalizePayload('settings', { theme: 'Hot Pink' }), /theme/);
  });

  test('validateRecordInput rejects unknown kinds', () => {
    assert.throws(() => validateRecordInput({ kind: 'weapon', name: 'x', payload: {} }), /kind/);
    assert.throws(() => validateRecordInput(null), /object/);
  });

  test('parseBackup validates every record and keeps created_at', () => {
    const rows = parseBackup({
      format: BACKUP_FORMAT,
      records: [
        { kind: 'app', name: 'A', payload: '{"version":"1"}', created_at: '2025-01-01T00:00:00Z' },
        { kind: 'radio', name: 'R', payload: { frequency: 90 } },
      ],
    });
    assert.equal(rows[0].created_at, '2025-01-01T00:00:00.000Z');
    assert.equal(rows[1].payload.frequency, '90.0');
    assert.throws(() => parseBackup({ format: 'other', records: [] }), /Not a Pip-Boy/);
    assert.throws(
      () => parseBackup({ format: BACKUP_FORMAT, records: [{ kind: 'radio', name: 'R', payload: { frequency: 200 } }] }),
      /Record 1: Frequency/,
    );
    assert.throws(() => parseBackup({ format: BACKUP_FORMAT, records: new Array(1000).fill({}) }), /at most 999/);
  });
});

describe('file names', () => {
  test('workspace names block traversal, hidden and reserved names', () => {
    assert.equal(validateWorkspaceName('song (live).mp3'), 'song (live).mp3');
    for (const bad of ['../x', 'a/b', 'a\\b', '.hidden', '', 'trailing.', 'CON', 'nul.txt', 'x'.repeat(101), 'tab\tname']) {
      assert.throws(() => validateWorkspaceName(bad), undefined, bad);
    }
  });

  test('sanitizeWorkspaceName always produces a valid name', () => {
    for (const raw of ['My Song [Live]!.mp3', 'Café — Ü.txt', '../../etc/passwd', '...', 'CON', '日本語.png', 'a'.repeat(150) + '.json', '']) {
      const name = sanitizeWorkspaceName(raw);
      assert.doesNotThrow(() => validateWorkspaceName(name), `${raw} -> ${name}`);
    }
    assert.equal(sanitizeWorkspaceName('Cafe Ü.txt'), 'Cafe U.txt');
    assert.ok(sanitizeWorkspaceName('a'.repeat(150) + '.json').endsWith('.json'));
  });

  test('Storage names follow Espruino limits', () => {
    assert.equal(validateStorageName('companion-radio.json'), 'companion-radio.json');
    assert.equal(validateStorageName('.boot0'), '.boot0');
    for (const bad of ['', '.', '..', 'a'.repeat(29), 'has space', 'ünicode', 'a/b']) {
      assert.throws(() => validateStorageName(bad), undefined, bad);
    }
  });

  test('SD paths must be absolute without traversal; FAT long names with spaces are fine', () => {
    assert.equal(validateSdPath('/MUSIC/track_01.mp3'), '/MUSIC/track_01.mp3');
    assert.equal(validateSdPath('/MUSIC/Live Set (2)/Track 01.wav'), '/MUSIC/Live Set (2)/Track 01.wav');
    assert.equal(validateSdPath('/', { allowRoot: true }), '/');
    for (const bad of ['relative.txt', '/../x', '/a/../b', '/./a', '/', '/a//b', '/a/', '/a:b', '/a*b', '/a\\b', '/a\u0001', `/${'x'.repeat(129)}`]) {
      assert.throws(() => validateSdPath(bad), undefined, bad);
    }
  });

  test('sdJoin, dump paths and Storage name encoding', () => {
    assert.equal(sdJoin('/', 'A'), '/A');
    assert.equal(sdJoin('/MUSIC', 'a b.wav'), '/MUSIC/a b.wav');
    assert.equal(validateDumpPath('sd/MUSIC/a b.wav'), 'sd/MUSIC/a b.wav');
    for (const bad of ['', '/abs', 'a/../b', '..', 'a//b', 'a\\b', 'a:b', 'x'.repeat(401)]) {
      assert.throws(() => validateDumpPath(bad), undefined, bad);
    }
    assert.equal(encodeStorageFileName('app.js'), 'app.js');
    assert.equal(encodeStorageFileName('.boot0'), '%2Eboot0');
    assert.equal(encodeStorageFileName('log\u0001'), 'log%01');
    assert.equal(encodeStorageFileName('a b/ü'), 'a%20b%2F%C3%BC');
    for (const n of ['.boot0', 'log\u0001', 'a b/ü', '..']) {
      const encoded = encodeStorageFileName(n);
      assert.doesNotThrow(() => validateDumpPath(`storage/${encoded}`), n);
      assert.equal(decodeURIComponent(encoded), n, 'reversible');
    }
  });
});

describe('misc', () => {
  test('validateMedia flags extension, size and character problems', () => {
    assert.equal(validateMedia({ name: 'song.MP3', size: 10 }).ok, true);
    assert.equal(validateMedia({ name: 'VAULT.avi', size: 10 }).ok, true); // the Pip-Boy's own video format
    assert.match(validateMedia({ name: 'archive.zip', size: 10 }).message, /Extension/);
    assert.match(validateMedia({ name: 'noext', size: 10 }).message, /Extension/);
    assert.match(validateMedia({ name: 'a.mp3', size: 0 }).message, /empty/);
    assert.match(validateMedia({ name: 'a.mp4', size: 101 * 1024 * 1024 }).message, /100 MB/);
    assert.match(validateMedia({ name: 'a?.txt', size: 1 }).message, /characters/);
  });

  test('formatSize and byteChecksum', () => {
    assert.equal(formatSize(512), '512 B');
    assert.equal(formatSize(2048), '2.0 KB');
    assert.equal(formatSize(5 * 1048576), '5.0 MB');
    assert.equal(byteChecksum([1, 2, 255]), 258);
    assert.equal(byteChecksum(new Uint8Array(0)), 0);
  });
});
