import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {
  buildCommand,
  extractFrames,
  detectDeviceError,
  cleanText,
  escapeControl,
  frameMatches,
  validateValue,
  bytesToBase64,
  base64ToBytes,
  expr,
  previewExpression,
  FRAME_OPEN,
  FRAME_CLOSE,
} from '../public/js/serial/protocol.js';

/** Evaluate a command the way the device would and capture what it prints. */
function runOnDevice(command, globals = {}) {
  let out = '';
  const ctx = vm.createContext({ print: (s) => (out += s + '\r\n'), JSON, String, ...globals });
  vm.runInContext(command.replace(/^\x10/, ''), ctx);
  return out;
}

describe('buildCommand', () => {
  test('disables echo, ends with newline and wraps the result in a frame', () => {
    const cmd = buildCommand('1+1', { requestId: 'abc', kind: 'value' });
    assert.ok(cmd.startsWith('\x10print('));
    assert.ok(cmd.endsWith(')\n'));
    const printed = runOnDevice(cmd);
    const { frames } = extractFrames(printed);
    assert.deepEqual(frames[0].json, { requestId: 'abc', kind: 'value', value: 2 });
  });

  test('escapes ">" on the device so payloads cannot close the frame early', () => {
    const cmd = buildCommand('"x >> > y"', { requestId: 'r1', kind: 'value' });
    const printed = runOnDevice(cmd);
    assert.equal(printed.indexOf(FRAME_CLOSE), printed.lastIndexOf(FRAME_CLOSE));
    assert.ok(!printed.slice(FRAME_OPEN.length, printed.indexOf(FRAME_CLOSE)).includes('>'));
    assert.equal(extractFrames(printed).frames[0].json.value, 'x >> > y');
  });

  test('reports device exceptions in the frame', () => {
    const printed = runOnDevice(buildCommand('missing.thing', { requestId: 'r2', kind: 'value' }));
    const json = extractFrames(printed).frames[0].json;
    assert.equal(json.requestId, 'r2');
    assert.match(json.error, /missing/);
  });

  test('cannot be broken out of via the request id or kind', () => {
    const cmd = buildCommand('1', { requestId: '"),evil("', kind: 'value' });
    const printed = runOnDevice(cmd);
    assert.equal(extractFrames(printed).frames[0].json.requestId, '"),evil("');
  });
});

describe('extractFrames', () => {
  test('handles frames split across reads and keeps partial input', () => {
    const full = `junk>${FRAME_OPEN}{"requestId":"a","kind":"value","value":1}${FRAME_CLOSE}\r\n>`;
    let buffer = '';
    const seen = [];
    for (const ch of full) {
      const r = extractFrames(buffer + ch);
      buffer = r.rest;
      seen.push(...r.frames);
    }
    assert.equal(seen.length, 1);
    assert.equal(seen[0].json.value, 1);
  });

  test('returns multiple frames and the text outside them', () => {
    const text = `a${FRAME_OPEN}1${FRAME_CLOSE}b${FRAME_OPEN}"two"${FRAME_CLOSE}c`;
    const r = extractFrames(text);
    assert.deepEqual(r.frames.map((f) => f.json), [1, 'two']);
    assert.equal(r.outside, 'abc');
    assert.equal(r.rest, '');
  });

  test('accepts flexible whitespace around the markers (like the original dashboard)', () => {
    for (const text of [
      '<  << {"v":1}  >>  >',
      '<<<{"v":1}>>>',
      '< <<\r\n{"v":1}\r\n>> >',
      '<\t<< {"v":1} >>\t>',
    ]) {
      const r = extractFrames(text);
      assert.deepEqual(r.frames.map((f) => f.json), [{ v: 1 }], JSON.stringify(text));
    }
  });

  test('resyncs past an orphaned half frame to the complete frame after it', () => {
    const text = '< << {"requestId":"old","kind":"board","value":"PI\r\n< << {"requestId":"new","kind":"board","value":"PIPBOY"} >> >\r\n';
    const r = extractFrames(text);
    assert.equal(r.frames.length, 1);
    assert.equal(r.frames[0].json.requestId, 'new');
    assert.match(r.outside, /"old"/);
  });

  test('marks invalid JSON frames without throwing', () => {
    const r = extractFrames(`${FRAME_OPEN}{nope${FRAME_CLOSE}`);
    assert.equal(r.frames[0].json, undefined);
    assert.equal(r.frames[0].raw, '{nope');
  });

  test('holds back a partial opener at the end of the buffer', () => {
    const r = extractFrames('hello < <');
    assert.equal(r.outside, 'hello ');
    assert.equal(r.rest, '< <');
    // …and completes the frame once the rest arrives.
    const done = extractFrames(r.rest + '< 7 >> >');
    assert.equal(done.frames[0].json, 7);
  });
});

describe('detectDeviceError', () => {
  test('recognises Espruino memory errors', () => {
    assert.equal(detectDeviceError('New interpreter error: LOW_MEMORY,MEMORY\r\n>').type, 'memory');
    assert.equal(detectDeviceError('>ERROR: Out of Memory!\r\n').type, 'memory');
    assert.equal(detectDeviceError('Execution Interrupted\r\n').type, 'memory');
  });

  test('recognises uncaught errors separately', () => {
    const e = detectDeviceError('>Uncaught SyntaxError: Got EOF expected \')\'\r\n');
    assert.equal(e.type, 'uncaught');
    assert.match(e.message, /^Uncaught SyntaxError/);
  });

  test('ignores ordinary text that merely contains the word memory', () => {
    assert.equal(detectDeviceError('memory card ok\r\n>'), null);
    assert.equal(detectDeviceError('MEMORY.TXT\r\n'), null);
    assert.equal(detectDeviceError('\r\n>'), null);
  });
});

describe('helpers', () => {
  test('cleanText strips ANSI and control characters but keeps newlines', () => {
    assert.equal(cleanText('\x1b[32mok\x1b[0m\x07\r\n'), 'ok\r\n');
  });

  test('cleanText applies Espruino "\\b \\b" erasing instead of leaving stray spaces', () => {
    // Espruino erases a 3-char input line before printing; the old code left "   " behind.
    assert.equal(cleanText('>abc\x08 \x08\x08 \x08\x08 \x08< << 1 >> >'), '>< << 1 >> >');
    assert.equal(cleanText('\x08\x08x'), 'x', 'backspace at start is harmless');
    assert.equal(cleanText('line\n\x08next'), 'line\nnext', 'never erases across a newline');
  });

  test('escapeControl makes control characters visible', () => {
    assert.equal(escapeControl('a\r\n\x1b[J\x08'), 'a\\r\\n\\x1b[J\\x08');
  });

  test('frameMatches and validateValue', () => {
    const job = { requestId: 'x', kind: 'sd' };
    assert.equal(frameMatches({ requestId: 'x', kind: 'sd', value: [] }, job), true);
    assert.equal(frameMatches({ requestId: 'y', kind: 'sd' }, job), false);
    assert.equal(frameMatches([1], job), false);
    assert.equal(validateValue('sd', []), true);
    assert.equal(validateValue('sd', 'PIPBOY'), false);
    assert.equal(validateValue('board', null), true);
    assert.equal(validateValue('board', 3), false);
  });

  test('base64 round-trips every byte value and large buffers', () => {
    const all = new Uint8Array(256).map((_, i) => i);
    assert.deepEqual([...base64ToBytes(bytesToBase64(all))], [...all]);
    const big = new Uint8Array(100_000).map((_, i) => i & 0xff);
    assert.equal(base64ToBytes(bytesToBase64(big)).length, 100_000);
  });

  test('the first Storage write declares the total file size', () => {
    assert.match(expr.storageWriteChunk('a.js', 'QQ==', 0, 500), /,0,500\)$/);
    assert.match(expr.storageWriteChunk('a.js', 'QQ==', 192, 500), /,192\)$/);
  });

  test('previews redact file contents', () => {
    assert.equal(previewExpression(expr.storageWriteChunk('a', 'c2VjcmV0', 0, 6)), '[file contents redacted]');
    assert.equal(previewExpression('process.env.BOARD'), 'process.env.BOARD');
  });
});
