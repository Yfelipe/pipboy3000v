# Using the dashboard

The sidebar has three groups: **Pip-Boy** (needs the device), **Companion** (works offline) and
**Help & tools**. The top bar always shows the connection, with Connect / Disconnect (and Wake
when the Pip-Boy is asleep). Any button that needs the Pip-Boy connects first if necessary.

Each device task runs as one job: a panel lists its steps with progress, it can be cancelled
between steps, and a failure is explained in plain words (with the technical detail one click
away). Deleting, overwriting, erasing and restoring always ask first.

- **Apps**: the catalog in `apps/index.json` (the apps themselves: [apps/README.md](../apps/README.md)). **Install** copies the app to Storage, adds its
  launcher to `USER/` on the SD card so it shows in **INV › APPS**, frees up space first if
  needed, and offers to restart. **Remove** deletes both. **Try in emulator** opens
  `/emulator/?app=<id>`. You can also install your own `.js` file the same way. All six apps also
  have the extensions' features (FM radio presets, INV › REMOTE, DATA › NOTES and INBOX, message
  pop-ups) in a small extras file that goes on the SD card with them and runs from RAM, so it
  costs no Storage: with Pip-OS 1.33 only about 33 KB of Storage is left for everything else.
  **Open at power-on** (on any installed app) writes a small `.bootPowerOn` so the app opens
  instead of the stock interface whenever the Pip-Boy powers on or restarts. `.bootPowerOn` only
  runs on a real start, not on `load()`, so the apps' power button and *Return to stock UI*
  (both `load()`) reach the stock interface. Holding the torch button while it starts skips the
  app. A `.bootPowerOn` the dashboard didn't write is left alone.
- **Files**: Storage and SD card tabs. Every row has its own Download / Delete; uploads start as
  soon as you pick the files.
- **ID, lists & notes** (Pip-OS 1.33): make the INV › ID card (our own card layout, with your
  photo, in six designs: vault dweller, Vault-Tec employee, NCR trooper, Caesar's Legion, Enclave
  officer and Brotherhood of Steel; each faction design names its fields to suit and carries its
  emblem from `assets/official/`), edit the DATA › LISTS checklists (loading first keeps what was ticked on the Pip-Boy;
  sending asks before replacing lists that changed there), and turn any picture into the
  DATA › FEEDS user image. Files go to `USER/` on the SD card in the firmware's formats
  (raw 2 bit greyscale `IDCARD.img` 400×300 and `USERIMG.img` 400×248, `customLists.json`).
  **Character sheet** sets your level and S.P.E.C.I.A.L. (1 to 10 each) and sends them as
  `USER/CHAR.json`; Mojave UI, Capital UI and PIP-OS X show them on their STAT pages the next
  time they start, in place of their built-in values.
  **Notes** loads the `NOTES` folder, edits, renames (the title is the file name) and deletes
  notes for the Notes extension.
- **Pip-Boy settings**: the firmware's own `settings.json`: who it's assigned to, screen
  timeout, 12/24-hour clock, time zone, what the mode dial does between positions
  (`fallbackMode`, Pip-OS 1.32), the clock calibration (1.33), and setting the clock to the
  computer's time. Saved live through the firmware's `saveSettings()` when the stock interface runs.
- **Extensions** (on the Apps page): add screens to the stock Pip-OS instead of replacing it:
  a media remote, radio presets, notes and an inbox. See
  [apps/extensions/README.md](../apps/extensions/README.md).
- **Holotapes** (on the Apps page): small games and tools the stock interface runs straight from
  the SD card, in **INV › APPS**. **Copy to the SD card** adds one and **Remove** deletes it.
  See [apps/holotapes/README.md](../apps/holotapes/README.md).
- **Radio presets**: besides adding stations by hand, **Import FM scan** adds the stations the
  FM scan holotape found (it reads `USER/FMSCAN.json` from the SD card and skips any already
  saved). **Radio clips** turns your own audio files into clips for the Pip-Boy's radio: the
  browser converts them to 16 kHz mono WAV and names them as the stock radio picks them from
  the SD card's `RADIO` folder (`MX` music, `DX` voice, `SFX` effects, numbered from 50 so the
  clips that came with the Pip-Boy are left alone). Download them as a .zip for a card reader,
  or copy them over USB (about 3 KB a second, with an 8 MB limit per file).
- **Wasteland forecast** (ID, lists & notes): real weather for where you are, told the way a
  vault terminal would (rain is acid rain, a thunderstorm is a rad storm), and sent to the
  Pip-Boy as the note `NOTES/FORECAST.txt`, so it shows in DATA › NOTES in the Notes extension
  and in all six apps. **Use my location** asks the browser where you are; you can type a
  place name instead, or the coordinates, and either overrides the detected place. The place is
  remembered in this browser. The weather comes from [Open-Meteo](https://open-meteo.com) (free,
  no account): the companion's server asks it only when you press **Get the forecast**, with
  the coordinates rounded to about a kilometre, and nothing is fetched in the background.
- **Messages** (Home): pop up over whatever the stock interface shows, and are kept in
  `USER/MESSAGES.json` for the Inbox. The Pip-Boy's fonts are ASCII, so accents and smart quotes
  are folded first.
- **Display colour** (Pip-Boy settings): presets or any colour for the stock interface, with a
  scanline preview. The palettes are computed on the device exactly as DATA › MAINTENANCE ›
  Display color does, and Mojave UI and PIP-OS X follow them with their PIP-BOY theme.
- **Clock sync**: each time the Pip-Boy connects, its clock is set to the computer's if it's more
  than 3 seconds out (can be turned off on the Pip-Boy settings page).
- **SD card space** on Files › SD card (Espruino 2v29's `fs.getFree`).
- **Dashboard theme** (the palette button in the top bar): Fallout themes (Pip-Boy 3000 Mk V
  green, Fallout 4, Fallout: New Vegas, The Glow, Vault-Tec, Nuka-Cola, Nuka-Cola Quantum,
  Institute, Brotherhood of Steel, Enclave, Caesar's Legion, New California Republic, Lucky 38,
  Classic (Fallout 1 & 2), Appalachia (Fallout 76), RobCo terminal, Sierra Madre), your own colour (every shade is mixed from it), or your
  Pip-Boy's screen colour once the Pip-Boy settings page has read it, and scanlines on or off.
  Kept in this browser; the emulator page follows it. Themes are CSS (`public/css/themes.css`):
  a theme sets a few base colours and the rest are mixed from them with `color-mix()`.
- **Backup & restore**: back up now, restore from the list or a file, free up space, complete
  copies, and the companion data export/import. See [BACKUPS.md](BACKUPS.md).
- **Diagnostics**: port choice, connection test, console recovery, raw serial output and the
  live status JSON for automation.
