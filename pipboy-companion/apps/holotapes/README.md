# Holotapes

Small games and tools the stock interface runs straight from the SD card, in **INV › APPS**.
Each is one file in `USER/` (plus its menu name in `APPINFO/`), so it uses no Storage. On the dashboard's Apps page, **Copy to the SD card** adds one and
**Remove** deletes it.

## The catalog

- **Terminal hacking** (`USER/HACKING.JS`): the password puzzle from the terminals of Fallout 3,
  New Vegas and 4. Eight words, four attempts, and a likeness score after each guess. The wheel
  chooses, pressing it guesses, and the thumbwheel or mode dial leaves.
- **Lockpicking** (`USER/LOCKPICK.JS`): the bobby-pin lock from Fallout 3, New Vegas and 4.
  The wheel moves the pin and pressing it turns the lock; the closer the pin is to the sweet
  spot, the further the lock turns before it binds. Four locks, Novice to Master, five pins.
- **Cap Collector** (`USER/CAPS.JS`): a small arcade game in the spirit of the holotape games.
  Slide the crate under the falling bottle caps with the wheel; a mini nuke in the crate costs
  one of three lives, and it speeds up as the caps add up.
- **FM scan** (`USER/FMSCAN.JS`): sweeps 87.5 to 108 MHz with the Pip-Boy's own radio (about
  10 seconds), draws the signal strength across the dial and lists up to eight stations that
  stand out. Pressing the wheel tunes to the chosen one. The list is also saved on the SD card
  as `USER/FMSCAN.json`. It needs the stock interface, which owns the radio; the emulator's
  starter menu gives it a pretend radio with three stations.
- **Stand clock** (`USER/CLOCK.JS`, images in `CLOCK/`): big time and date under a Vault-Tec,
  RobCo or Nuka-Cola logo; the wheel changes the face. While USB power is connected it keeps
  the Pip-Boy awake. The logos are 2 bit images, 240 pixels wide, made from the official
  artwork in `assets/official/` (`fallout-vault-tec.png`, `RobCo_logo.png`,
  `fallout-nuka-cola.jpg`); a face whose image is missing shows its name instead.
- **Level up** (`USER/LEVELUP.JS`, files in `LEVELUP/`): experience points for real tasks.
  Every item ticked off in DATA › LISTS (on the Pip-Boy, in either app, or on the ID, lists &
  notes page) is worth 10 XP, counted once. Level 2 takes 50 XP, level 3 takes 150, level 4
  takes 300. Reaching a level shows LEVEL UP! and plays the level-up sound. XP is kept in
  `USER/XP.json`, and unticking an item doesn't take it away. Vault Boy
  (`fallout-vault-boy.png`) and the sound (`fallout-level-up.ogg`, as a 16 kHz mono WAV) are
  made from `assets/official/`.

## Trying and building

**Try in emulator** on a card opens the holotape on the emulator's starter Pip-Boy, and the
starter's own menu lists them after the apps. `node apps/holotapes/contact-sheet.mjs` (run from
`pipboy-companion/`) renders screenshots of each one into `apps/holotapes/contact-sheet.png`.

Sources are in `apps/holotapes/`; `npm run apps:build` minifies them into `apps/holotapes/sd/`.

How a holotape is built (one file, run with `eval`, no imports, drawing into the firmware's page
buffer) is in the project rules, [AGENTS.md](../../../AGENTS.md). Tests: `test/holotapes.test.js`.
