# Pip-Boy 2000

An alternative interface for the Pip-Boy 3000 Mk V, styled after the Pip-Boy 2000 of the first
two Fallout games. It runs on the device and in the emulator, and the stock firmware stays
installed: the power button returns to it.

## The design

It follows the Pip-Boy 2000, not the 3000, so it looks unlike the other apps:

| From the original | Here |
| --- | --- |
| A column of buttons beside the screen (Status, Automaps, Archives) | Five buttons down the left, lit on the section the mode dial points at: STATUS, ITEMS, ARCHIVES, AUTOMAPS, RADIO |
| The date and the time in windows along the top | The same, with the section's pages beneath as bracketed text |
| A plain text screen | Everything is terminal text: a `>` cursor and an underline instead of a highlight bar, dotted leaders to the numbers, meters made of blocks |
| An alarm clock | A seven-segment clock page (the alarm itself stays in the stock interface) |
| No Vault Boy status figure | STATUS prints hit points, radiation and poison, and Vault 13's water countdown |

What it changes: the original has three sections and this device's dial has five, so items and
the radio get buttons of their own; and the shared pages (ID, FEEDS, LISTS, NOTES, INBOX, REMOTE)
use the whole screen without the button column.

The wheels, dial, video, radio, settings and companion extras are the engine it shares with
[Mojave UI](../mojave/README.md) and the other tabbed app (`../shared/engine.js`). The drawing
code is its own.

## What's in it

| Tab | Pages |
| --- | --- |
| STAT | STATUS (hit points, radiation and poison as block meters, your level, and Vault 13's water countdown) · S.P.E.C.I.A.L. · SKILLS (the eighteen skills of the first game, each out of 100) |
| INV | WEAPONS · APPAREL · AID · MISC: items from the first game (10mm pistol, leather jacket, power armor, the water chip). The wheel button equips. · ID · REMOTE |
| DATA | QUESTS (from *Leave Vault 13* to *Destroy the Master*) · UPLINK (the Overseer's message) · FEEDS · LISTS · NOTES · INBOX · CLOCK · SYSTEM |
| MAP | Southern California: Vault 13, Shady Sands, Vault 15, Junktown, the Hub, Necropolis, Lost Hills, the Boneyard, the Glow, Mariposa, the Cathedral |
| RADIO | The FM dial and your presets (real FM), then the wasteland's stations: clips from the SD card's `RADIO` folder |

Level and S.P.E.C.I.A.L. come from the companion's character sheet (`USER/CHAR.json`) when the
SD card has one. ID, FEEDS, LISTS, NOTES, INBOX, REMOTE and the FM radio work as they do in
Mojave UI: see its README.

**Themes**, chosen in DATA › SYSTEM and kept in Storage as `pip2000.json`: CRT green, amber,
Vault 13 blue, and PIP-BOY (the stock interface's own display colour).

## Build and try

```bash
./build.sh                                           # pip2000.min.js and sd/USER/PIP2000.EXT
node ../contact-sheet.mjs pip2000.min.js 3,6,8,1,1   # every page into contact-sheet.png
```

In the emulator: <http://localhost:8077/emulator/?app=pip2000>, or choose PIP-BOY 2000 in the
starter Pip-Boy's menu. On a Pip-Boy: install it from the dashboard's Apps page.
