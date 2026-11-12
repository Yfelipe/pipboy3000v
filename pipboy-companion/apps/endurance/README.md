# Endurance

An alternative interface for the Pip-Boy 3000 Mk V based on Christopher Nolan's film
*Interstellar* (2014): the flight-deck display of the ship that goes through the wormhole. It
runs on the device and in the emulator, and the stock firmware stays installed: the power button
returns to it.

It is a fan piece, not for sale. Three pictures are used with permission (the owner asked the
studio and Hamilton; both cleared this personal project as long as it is not monetised: see
AGENTS.md). Everything else is drawn in code from lines and circles, and the app works without
the pictures.

| Picture on the SD card | From (`assets/official/interstellar/`) | Where |
| --- | --- | --- |
| `ENDURANC/TITLE.IMG` | The wordmark, cut from the film's poster | A title screen after the boot lines |
| `ENDURANC/GARGANTU.IMG` | The black hole and its disc, a figure in James, von Tunzelmann, Franklin and Thorne, *Gravitational lensing by spinning black holes in astrophysics, and in the movie Interstellar* (2015, arXiv:1502.03808, CC BY-NC-SA) | NAV › GARGANTUA |
| `ENDURANC/MURPH.IMG` | Hamilton's Khaki Field Murph, from Hamilton's product picture | MISSION › CLOCK, the MURPH face |

`./make-images.py` makes the three from those files (raw 2 bit images, the page buffer's own
format). It holds no music or dialogue from the film.

## The design

A spacecraft console, not a Pip-Boy, so it looks unlike the other apps:

| From the film | Here |
| --- | --- |
| White, spare cockpit displays | White on black by default; hairlines, small dim labels, values set to the right, a lot of empty space |
| A ship that spins for gravity | SHIP › RING: a twelve-module wheel that turns, with the spin held at 1.00 G |
| A robot whose humor and honesty are set as percentages | SHIP › ROBOT: four settings on scales. Press to take hold of one, turn the wheel, press to set. They are kept in Storage as `robot.json`, shared with the [TARS](../tars/README.md) app. |
| Three candidate worlds | MISSION › WORLDS: three cards side by side, the wheel moves between them |
| Plan A and Plan B | MISSION › PLANS: both as a checklist; press ticks a step |
| An hour on the water world costs seven years at home | MISSION › TIME SLIP: turn the wheel for hours on the surface, read the years at home |
| The watch | MISSION › CLOCK: two faces, changed with the wheel. DIAL is drawn, with a ticking seconds hand; MURPH is the photograph of the watch (its hands don't move) with the time beside it |
| Earth, Saturn, the wormhole, the black hole | NAV › ROUTE: a chart of the seven stops; the wheel steps along it. NAV › GARGANTUA: the black hole as it was rendered for the film |
| Beacons from the earlier missions | COMMS › SIGNALS: the stations, with marks like a hand on a key running while one plays |

There are no tabs. The header gives the section's number and name (`01 / 05 SHIP`) and two
clocks: the time, and how long the app has been running (`T+`). The footer has a square for each
page of the section. A list is a ruled table with a square marking the current row.

What it changes: the numbers on the ship pages (fuel, rations, the robot's default settings
other than humor and honesty) are made up for the display, and the route chart is a diagram,
not to scale.

The wheels, dial, radio, settings and companion extras are the engine it shares with the other
apps (`../shared/engine.js`). The drawing code is its own.

## What's in it

| Dial | Pages |
| --- | --- |
| STAT → SHIP | RING · CREW · ROBOT |
| INV → CARGO | MANIFEST · ID · REMOTE |
| DATA → MISSION | WORLDS · PLANS · TIME SLIP · FEEDS · LISTS · NOTES · INBOX · CLOCK · SYSTEM |
| MAP → NAV | ROUTE · GARGANTUA |
| RADIO → COMMS | SIGNALS: the FM dial and your presets (real FM), then clips from the SD card's `RADIO` folder |

ID, FEEDS, LISTS, NOTES, INBOX, REMOTE and the FM radio work as they do in Mojave UI: see its
README.

**Colours**, chosen in MISSION › SYSTEM and kept in Storage as `endurance.json`: WHITE, DUST,
ICE, and PIP-BOY (the stock interface's own display colour).

## Build and try

```bash
./build.sh                                             # endurance.min.js and sd/USER/ENDURANC.EXT
./make-images.py                                       # sd/ENDURANC/*.IMG (Pillow, numpy, pdfimages, ffmpeg)
node ../contact-sheet.mjs endurance.min.js 3,3,9,2,1   # every page into contact-sheet.png
```

In the emulator: <http://localhost:8077/emulator/?app=endurance>, or choose ENDURANCE on the
emulator's Run tab. On a Pip-Boy: install it from the dashboard's Apps page.
