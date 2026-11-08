import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export async function tempDir(t) {
  const dir = await mkdtemp(path.join(tmpdir(), 'pipboy-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

export const quietLogger = { warn() {}, error() {}, log() {} };
