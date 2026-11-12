# Your data, backups and Pip-Boy Storage

## Where your data lives

Everything is plain files in `data/` (git-ignored). Copy the folder to back it up.

```
data/
├── records.json      apps, FM presets, settings profile (atomic writes)
├── activity.jsonl    activity log, newest 5,000 entries
├── workspace/        SD-card staging files, kept between sessions
└── dumps/<id>/       full device dumps (see below)
```

## Full device dumps (for emulation and local dev)

**Backup & restore → Complete copy** saves a byte-exact snapshot of the Pip-Boy:

```
data/dumps/pipboy-2026-11-08-01-30-00-ab12/
├── device.json       process.env, version, memory, flags, Storage stats, and
│                     globalShapes: every global with its methods / prototype methods
├── storage/          every Storage file, including system files; names that aren't
│                     filesystem-safe are %-encoded (".boot0" -> "%2Eboot0", "log\x01" -> "log%01")
├── sd/               the SD card tree, with files up to the size limit
└── manifest.json     written last: index of everything, sizes, checksums, skipped
                      large SD files, and errors. No manifest means the dump is incomplete.
```

Serial runs at about 3 KB/s, so large SD media is listed in the manifest (`skipped`) rather than
downloaded. Copy those files from the card with a card reader into `sd/` at the same paths.

To run a dump, open the **Emulator** (`/emulator/`, see [emulator/README.md](../emulator/README.md)):
it boots the device's own firmware from the dump in a WebAssembly build of Espruino.

Long dumps can be interrupted. `manifest.json` is always written, with `complete: false` and an
`aborted` reason if the dump stopped. **Resume** in the dump list continues from there and skips
files that are already saved. If a transfer times out, the app checks the Pip-Boy is still
answering: it retries the file once if so, and stops (rather than timing out file after file) if not.
Files that operating systems put on the card (`.DS_Store`, `._*`, `System Volume Information`, …)
are skipped and listed under `sd.osJunkSkipped`.

If `records.json` is ever unreadable, it's renamed to `records.json.corrupt-<timestamp>` and
a fresh one is started. Nothing is silently thrown away.

## Pip-Boy Storage space

The Pip-Boy keeps Storage in a single 128 KB flash page, and the stock firmware's `.bootcde`
fills about 103 KB of it. Deleting a file only marks its space as unused: Espruino can only
compact Storage with a buffer the size of the page, which the Pip-Boy doesn't have while the
firmware is installed. So after deleting or replacing an app, writes fail with
`Unable to find or create file` even though the file list looks smaller.

**Free up space** (Home, Files › Storage, or Backup & restore) gets that space back:

1. It backs up every file with checksums, downloads the backup and keeps a copy in the workspace
   (listed on the Backup page for one-click restore).
2. It stops the firmware with `reset()`, because the firmware runs straight from Storage.
3. It erases Storage and writes every file back, checking each one.
4. It restarts the Pip-Boy and reconnects.

Installing an app does this by itself when there isn't room (after asking). **Restore** works the
same way: it backs up what's in Storage first, then erases and writes the backup's files. If that
backup can't be made (a damaged Storage may be why you're restoring), it asks before going on
without one. It also warns when the backup has no `.bootcde`, because the Pip-Boy would have no
stock interface afterwards. Storage is only erased on a device that reports it's a Pip-Boy.
`test/storage-rebuild.test.js` runs this against the firmware build in the emulator,
which reproduces the device's single-page Storage.
