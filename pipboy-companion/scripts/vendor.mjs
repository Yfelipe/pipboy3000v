// Save the icon library (lucide, pinned) to public/vendor/ so the dashboard doesn't load it from
// a CDN. public/vendor/ is git-ignored. Run: npm run vendor
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = [['https://cdn.jsdelivr.net/npm/lucide@0.577.0/dist/umd/lucide.min.js', 'public/vendor/lucide.min.js']];

for (const [url, rel] of FILES) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  if (!body.toString('latin1', 0, 4000).includes('lucide')) throw new Error(`${url} doesn't look like lucide`);
  await mkdir(path.dirname(path.join(ROOT, rel)), { recursive: true });
  await writeFile(path.join(ROOT, rel), body);
  console.log(`${rel}: ${body.length} bytes`);
}
