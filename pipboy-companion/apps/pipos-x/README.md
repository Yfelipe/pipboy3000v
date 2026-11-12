# PIP-OS X (concept)

A futuristic concept interface for the Pip-Boy 3000 Mk V. It imagines a next-generation
Pip-Boy built on the systems the games have always had: S.P.E.C.I.A.L., V.A.T.S., Action
Points, radiation, fusion cores, holotapes and radio. They're drawn in a holographic vector
style, with rings, radar sweeps, a spectrum waterfall and rotating wireframes.

It uses the Pip-Boy's own artwork where the device has it. The Vault Boy animations
(`STAT/VB*.avi`) and the animated maps (`MAP/*.avi`) are played straight from the SD card that
came with the device, so nothing is copied into the app. Everything else is drawn with Graphics
primitives.

## Pages

| Tab | Pages |
| --- | --- |
| STAT | VITALS: HP/AP/RAD rings and limb meters around the SD card's Vault Boy animation (the wheel changes it) · S.P.E.C.I.A.L.: heptagon chart with a sweep · V.A.T.S.: target with per-part hit chances; select queues shots and spends AP |
| INV | GEAR · AID: list plus a rotating wireframe of the item (fusion core, helmet, stimpak, Nuka-Cola Quantum…) and its stats · ID: your ID card, full screen · REMOTE: USB media keys |
| DATA | MISSIONS: timeline and progress · SIGNALS: spectrum waterfall, locking onto a signal · FEEDS: the SD card's feed videos and pictures (the wheel flips through them) · LISTS: checklists, the wheel button opens a list and ticks items off · NOTES · INBOX · CLOCK: hour, minute and second rings, uptime · SYSTEM: theme, brightness, sounds, back to the stock UI |
| MAP | WORLD: the SD card's map animations, full screen (the wheel changes them) · RADAR: contacts appear as the sweep passes |
| RADIO | TUNER: dial, station list and spectrum bars. The FM dial and your presets play the real FM radio; the other stations play clips from the SD card's `RADIO` folder. Select or PLAY plays |

ID, FEEDS and LISTS are the screens Pip-OS 1.33 added, read from the same SD card files as the
stock firmware (`USER/IDCARD.img`, `DATA/` and `USER/USERIMG.img`, `USER/customLists.json`), so a card
or list made with the companion dashboard or Pip-Boy Tools shows in both, and ticks made in either
are kept. The code is shared with the Mojave UI in `../shared/pipos133.js`. They work on older
firmware too. The mode dial follows the firmware's `fallbackMode` setting between positions.

**Companion extras** (`extras.js`, built into `sd/USER/PIPOSX.EXT`): the INBOX, NOTES and REMOTE pages,
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

The **themes** are Holo (default), Phosphor green, Amber, Institute white-blue, Legion crimson, NCR khaki and Enclave blue, chosen in DATA › SYSTEM (the PIP-BOY theme uses the stock interface's own display colour).
The header uses slanted tab cells. The footer shows battery, time and date, memory and signal.

## Run it

**In the emulator:**

1. Load your dump, so the SD card with the animations is there.
2. Go to **Load → Apps → PIP-OS X → Install & run**.

From a terminal:

```bash
node emulator/cli.js --board pipboy --dump data/dumps/<id> --app apps/pipos-x/pipos-x.min.js
```

**On the Pip-Boy**: in the dashboard, open **Apps** and press **Install** on PIP-OS X. It copies
the app to Storage, adds its launcher to the card's `USER` folder so it shows in the stock
**INV › APPS** menu, puts the companion extras (`USER/PIPOSX.EXT`) beside it, and offers to restart the Pip-Boy. If Storage is full (with the stock firmware
there's room for one of the two apps at a time), remove the other app first; the dashboard then
offers to free up the space in the same step.

The power button goes back to the stock interface. With "Start at power-on" (companion Apps page) the app opens instead of the stock interface whenever the Pip-Boy powers on; hold the torch button while it starts to get the stock one.

## Develop

Edit `pipos-x.js` (or `../shared/pipos133.js`), then run `./build.sh` to bundle and minify it. To render every page into a PNG for review:

```bash
node apps/contact-sheet.mjs apps/pipos-x/pipos-x.min.js 3,3,6,2,1
```

It uses the SD card from the newest dump in `data/dumps`, so the videos appear.

**Pages with video.** The content area is normally one 400×210 buffer, blitted every frame. A
video page has to leave the video's pixels alone:
- **VITALS** draws into two 96 px side panels around the 204×208 Vault Boy animation.
- **WORLD** draws nothing while its map plays, and the header is cut down to its tab row.
