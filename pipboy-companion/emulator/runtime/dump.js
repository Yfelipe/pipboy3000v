// Load a device dump made by the companion dashboard (data/dumps/<id>/manifest.json) into
// an emulator: Storage files go into flash, SD card files into the MemFS.
//
//   const fs = new MemFS();
//   const sd = await loadDumpSd(manifest, readFile, fs);  // before booting: the firmware reads the SD at boot
//   const emu = await Espruino.start({ board, wasm, fs });
//   await loadDumpStorage(manifest, readFile, emu);       // writes Storage, then reboots into it
//
// `readFile(relativePath)` returns the bytes of a file inside the dump folder (Uint8Array),
// e.g. from fetch() in a browser or fs.readFile() in Node.

/**
 * Copy the dump's SD card into `fs`. Returns { files, skipped }, where `skipped` lists the
 * paths the dump left out (too large to copy over USB serial); add those from the card itself.
 */
export async function loadDumpSd(manifest, readFile, fs, { onProgress = () => {} } = {}) {
  const entries = manifest.sd?.entries ?? [];
  const files = entries.filter((e) => !e.dir && e.file);
  for (const e of entries) if (e.dir) fs.mkdirp(e.path);
  let done = 0;
  for (const e of files) {
    fs.writeFile(e.path, await readFile(e.file));
    onProgress(++done, files.length, e.path);
  }
  return { files: files.length, skipped: entries.filter((e) => e.skipped).map((e) => e.path) };
}

/** Write the dump's Storage files into the emulator's flash and reboot so the boot code runs. */
export async function loadDumpStorage(manifest, readFile, emu) {
  for (const f of manifest.storage ?? []) {
    emu.storageWrite(f.name, await readFile(f.file));
  }
  emu.reboot();
}
