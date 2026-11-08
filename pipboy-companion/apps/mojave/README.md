# Mojave UI

An alternative interface for the Pip-Boy 3000 Mk V, styled after the New Vegas era of the
Fallout TV series' second season (December 2025 – February 2026). It runs on the device and in
the emulator, and the stock firmware stays installed: the power button returns to it.

## What's in it

| Tab | Pages |
| --- | --- |
| STAT | STATUS (limb condition, radiation gauge, the season's control-chip implant) · S.P.E.C.I.A.L. · FACTIONS (reputation with the NCR, Caesar's Legion, the Strip, the Brotherhood, the Enclave, the Great Khans and Freeside) |
| INV | WEAPONS · APPAREL · AID · MISC: items from the season (crowbar, cold fusion diode, control chip, water chip, Liberty Prime plans, Overseer's Pip-Boy). The wheel button equips. · ID: your ID card, full screen · REMOTE: USB media keys |
| DATA | QUESTS (one per episode, *The Innovator* to *The Strip*) · UPLINK (a Lucky 38 terminal) · FEEDS (the SD card's feed videos and pictures) · LISTS (checklists to tick off) · NOTES · INBOX · CLOCK · SYSTEM (theme, brightness, sounds, back to the stock UI) |
| MAP | The Mojave: the Strip, Freeside, Camp McCarran, Hoover Dam, Fortification Hill, Goodsprings, Primm, Novac, Red Rock Canyon, Black Mountain, Area 51 |
| RADIO | The FM dial and your presets (real FM), then the Mojave's stations: clips from the SD card's `RADIO` folder. Select or PLAY plays |

ID, FEEDS and LISTS are Pip-OS 1.33's screens, from the same SD card files as the stock firmware
(shared with PIP-OS X in `../shared/pipos133.js`). The mode dial follows the firmware's
`fallbackMode` setting when it reads between positions. DATA's page names scroll to keep the current one in view.

**Companion extras** (`extras.js`, built into `sd/USER/MOJAVE.EXT`): the INBOX, NOTES and REMOTE pages,
the FM radio and your presets. They're read from the SD card when the app starts and run from
RAM (about 11 KB of it), so they cost no Storage, which the app shares with Pip-OS. Without the
file the app runs as before, minus those pages.

- **RADIO** starts with the **FM dial** (the real FM radio: the thumbwheel tunes in 0.1 MHz steps
  while it plays) and the stations from the companion's Radio presets page
  (`companion-radio.json`), then the clip stations.
- **INV › REMOTE**: media keys for the computer the Pip-Boy is plugged into, over USB. The wheel
  is volume, pressing it is play/pause, the thumbwheel skips tracks (so the mode dial leaves the
  page) and PLAY mutes. Unplug and replug the cable the first time.
- **DATA › NOTES**: `NOTES/*.txt` from the companion's ID, lists & notes page.
- **DATA › INBOX**: messages from the companion's Home page. A message sent while the app runs
  pops up over it (the dashboard calls the app's `companionMessage`).

The styling:

- **Amber phosphor** by default, the New Vegas colour.
- **Themes**, chosen in DATA › SYSTEM (the PIP-BOY theme uses the stock interface's own display colour) and kept in Storage as `mojave.json`:
  - Overseer gold, matching Hank's Pip-Boy and the Overseer's Edition.
  - Classic green.
  - Enclave blue.
- **A New Vegas-style footer:** HP shows the battery and AP shows free memory, with the date and time between them.
- **The stock firmware's scanline sweep and palette.** Pages are drawn into 2-bit buffers and shown with `Pip.blitImage`.

Everything is drawn with Graphics primitives. There are no images, and no logos or characters from the show; FEEDS and ID only show the files already on your SD card.

## Run it

**In the emulator:**

1. Open the emulator.
2. Load your dump.
3. Go to **Load → Apps → Mojave UI → Install & run**.

From a terminal:

```bash
node emulator/cli.js --board pipboy --dump data/dumps/<id> --app apps/mojave/mojave.min.js
```

**On the Pip-Boy**: in the dashboard, open **Apps** and press **Install** on Mojave UI. It copies
the app to Storage, adds its launcher (`USER/MOJAVE.JS`, one line: `load("mojave.min.js")`) to the
SD card so it shows in the stock **INV › APPS** menu, puts the companion extras (`USER/MOJAVE.EXT`) beside it, and offers to restart the Pip-Boy. If Storage
is full (with the stock firmware there's room for one of the two apps at a time), remove the other
app first; the dashboard then offers to free up the space in the same step.

You can also type `load("mojave.min.js")` at the console.

## Controls

These are the same as the stock interface:

- **Mode dial:** changes the tab.
- **Thumbwheel:** changes the page.
- **Wheel:** scrolls.
- **Wheel press:** selects.
- **PLAY:** turns the radio on and off.
- **Torch:** turns the flashlight on and off.
- **Power:** goes back to the stock interface.

## Develop

Edit `mojave.js`, then run `./build.sh` to minify it into `mojave.min.js` (with esbuild, via npx).
In the emulator, open either file under **Program → Open .js**, then **Save to Storage & load()**.

To review the layout, `node apps/contact-sheet.mjs apps/mojave/mojave.min.js 3,5,6,1,1` renders every page in the emulator,
with the first and last list item selected, into `contact-sheet.png`. `npm test` runs the app
through every page and fails if a page throws.

The main constraints:

- **5000 JS variables.** That's why the drawing buffers live in the STM32's CCM RAM (`E.memoryArea`), as the stock firmware's do.
- **Data is built per page.** Each page's data is created when the page opens, so the app runs with about 3,600 variables free.
- **Storage.** The app runs from flash with `load()`, so its source never has to fit in RAM, but it does have to fit in the free Storage.
