// Read a .zip in the browser or Node (no libraries): stored and deflated entries, which is what
// the Pip-OS release zips use. Deflate goes through DecompressionStream('deflate-raw').
//
//   const files = await unzip(bytes);   // Map("FW.JS" | "UI/OK.wav" ... -> Uint8Array)

const MAX_FILES = 5000;
const MAX_BYTES = 256 * 1024 * 1024; // all files together, unpacked

async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Map of path -> bytes for every file in the zip (folders and dotfiles left out). */
export async function unzip(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // End of central directory: the last 22+ bytes (a comment may follow it)
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('That isn’t a zip file.');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  if (count > MAX_FILES) throw new Error(`That zip has ${count} files; the most is ${MAX_FILES}.`);
  const files = new Map();
  const names = new TextDecoder();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('That zip is damaged (central directory).');
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true);
    const packed = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true), extraLen = v.getUint16(p + 30, true), commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = names.decode(bytes.subarray(p + 46, p + 46 + nameLen)).replace(/\\/g, '/');
    p += 46 + nameLen + extraLen + commentLen;
    // folders, dotfiles (__MACOSX/, .DS_Store) and anything that tries to climb out
    if (name.endsWith('/') || name.split('/').some((s) => !s || s.startsWith('.') || s === '__MACOSX')) continue;
    if (flags & 1) throw new Error(`${name} is encrypted.`);
    total += size;
    if (total > MAX_BYTES) throw new Error('That zip unpacks to more than 256 MB.');
    if (v.getUint32(local, true) !== 0x04034b50) throw new Error(`That zip is damaged (${name}).`);
    const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
    const data = bytes.subarray(start, start + packed);
    let out;
    if (method === 0) out = data.slice();
    else if (method === 8) out = await inflateRaw(data);
    else throw new Error(`${name} uses a compression this can't read (method ${method}).`);
    if (out.length !== size) throw new Error(`${name} didn't unpack to its listed size.`);
    files.set(name, out);
  }
  return files;
}
