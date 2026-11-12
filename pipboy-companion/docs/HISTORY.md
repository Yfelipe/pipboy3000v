# Changes from the original single-file dashboard

Fixed:

1. **Records didn't work locally.** They depended on a hosted `/_sdk/data_sdk.js`. They now
   use the local server and survive restarts.
2. **The "Espruino Storage files" panel listed the SD card** (`fs.readdirSync`), so
   *Back up Storage* read the wrong names. It now uses `require("Storage").list()`.
3. **Storage writes over 192 bytes failed.** The first `Storage.write` didn't declare the total
   size, so later chunks overflowed the file. It now does.
4. **Non-ASCII text was corrupted** when writing to Storage. Files are now sent as raw bytes
   (base64) with byte checksums, and verification reads the file once instead of twice.
5. **False low-memory safe mode.** `/\bMEMORY\b/i` matched any output, including a file named
   `MEMORY.TXT`. Only Espruino error lines outside response frames count now.
6. **Frame parsing broke** if a file contained `>> >`. The device now escapes `>` inside frames.
7. **Unbounded log** re-rendered on every entry, which froze the page during large transfers.
   It's now bounded, batched and render-throttled.
8. **A blocked icon CDN stopped the whole app** (`lucide.createIcons()` threw on startup).
9. **Restore** could create duplicate settings profiles, mis-counted the record limit and
   imported duplicate frequencies. Import is now validated up front and atomic on the server.
10. A device "Uncaught" error now fails the transaction straight away instead of waiting out
    the timeout. SD read/write handles are closed without hiding the original error.
11. Cleanup: removed dead code (`inFlight`, `transactionReader`, a never-enabled echo button),
    a leftover debugging note on the dashboard, and the vertical-centering layout bug.

New:

- The workspace keeps real files between sessions. Any file can be copied to the SD card, and
  SD files can be kept in it.
- Storage backups are downloaded and also kept in the workspace. The backup format is v2
  (base64, binary-safe), and v1 backups still restore.
- The activity log is kept between sessions, with an optional per-transaction device trace.
