# Capital UI

An alternative interface for the Pip-Boy 3000 Mk V, styled after Fallout 3's Pip-Boy 3000 and
the Capital Wasteland. It runs on the device and in the emulator, and the stock firmware stays
installed: the power button returns to it.

## The design

It follows Fallout 3's Pip-Boy 3000:

| From the original | Here |
| --- | --- |
| The section's name in a box at the top left, the top line running out of it, readouts hanging on the line | The same: STATS, ITEMS, DATA, MAP or RADIO, then level, HP (the battery), AP (free memory) and the time |
| Sub-pages along the bottom line, the current one boxed | The same; the row scrolls when a section has more pages than fit |
| A list's current row in an outlined box | The same, with the row's value at its right edge |
| Vault Boy in the middle of the status screen, CND / RAD / EFF down the left | The same, playing the SD card's `STAT/VB*.avi` animations |
| An item's figures in cells along the bottom | The same, with weight and caps at the bottom left |

What it changes: the original keeps its map and radio inside DATA, and this device's dial has
positions for them, so they are sections of their own; and there are no item pictures, so the
description takes that space.

The wheels, dial, video, radio, settings and companion extras are the engine it shares with
[Mojave UI](../mojave/README.md) and the other tabbed app (`../shared/engine.js`). The drawing
code is its own.

## What's in it

| Tab | Pages |
| --- | --- |
| STAT | STATUS (Vault Boy in the middle from the SD card's `STAT/VB*.avi` animations, changed with the wheel, with rads and karma beside him; a card without those videos gets a drawn figure with limb bars) · S.P.E.C.I.A.L. · SKILLS (the thirteen Fallout 3 skills, each out of 100) |
| INV | WEAPONS · APPAREL · AID · MISC: items from the Capital Wasteland (10mm pistol, Fat Man, Vault 101 jumpsuit, T-45d power armor, the G.E.C.K.). The wheel button equips. · ID: your ID card, full screen · REMOTE: USB media keys |
| DATA | QUESTS (the main quest line, *Escape!* to *Take It Back!*) · UPLINK (the Project Purity control room) · FEEDS · LISTS · NOTES · INBOX · CLOCK · SYSTEM (theme, brightness, sounds, back to the stock UI) |
| MAP | The Capital Wasteland: Megaton, Vault 101, Rivet City, the GNR Building, the Jefferson Memorial, the Citadel, Raven Rock, Paradise Falls, Arefu, Tenpenny Tower, Vault 112 |
| RADIO | The FM dial and your presets (real FM), then the wasteland's stations: clips from the SD card's `RADIO` folder |

ID, FEEDS, LISTS, NOTES, INBOX, REMOTE and the FM radio work as they do in Mojave UI: see its
README. The extras file is Mojave UI's, built again as `sd/USER/CAPITAL.EXT`.

**Themes**, chosen in DATA › SYSTEM and kept in Storage as `capital.json`: green (Fallout 3's
default), amber, blue and white, the four display colours that game offers, plus PIP-BOY, which
uses the stock interface's own display colour.

## Build and try

```bash
./build.sh                                   # capital.min.js and sd/USER/CAPITAL.EXT
node ../contact-sheet.mjs capital.min.js 3,6,8,1,1   # every page into contact-sheet.png
```

In the emulator: <http://localhost:8077/emulator/?app=capital>, or choose CAPITAL UI in the
starter Pip-Boy's menu. On a Pip-Boy: install it from the dashboard's Apps page.

`capital.min.js` is about 24 KB. With Pip-OS 1.33 installed there is room in Storage for one of
the three apps at a time.
