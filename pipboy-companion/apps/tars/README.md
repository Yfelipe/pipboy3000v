# TARS

An alternative interface for the Pip-Boy 3000 Mk V based on the robot in Christopher Nolan's film
*Interstellar* (2014). [Endurance](../endurance/README.md) is the ship's console; here the
Pip-Boy is the robot, and it talks to you. It runs on the device and in the emulator, and the
stock firmware stays installed: the power button returns to it.

It is a fan piece, not for sale, made under the owner's permission from the studio for this
unmonetised project (see AGENTS.md). It uses no artwork from the film: the layout is a nod to
the robot's build, not a picture of it. Every line the robot says is written for this app; none
is from the film.

## The design

| From the film | Here |
| --- | --- |
| A robot built from four hinged slabs | Every screen is four tall panels with pinned joints between them. The one you are adjusting swings down out of line. |
| A small text display on its front | The start-up console: its self test typed out with a block cursor, the settings read back, the cue light tested |
| Humor and honesty set as percentages | SETTINGS: HUMOR, HONESTY, TRUST and DISCRETION, one slab each. Press to take hold of one, turn the wheel, press to let go. |
| A cue light so you know when it's joking | A square at the top right of the header, lit while the line it is saying is a joke |
| It talks | The footer is always one line from the robot about the screen. The same screen gets a blunt line, a joke or an evasive one depending on the settings. |
| The docking | DOCK: a game. Match the ring's spin with the thumbwheel (seen from your ship, the ring stops when you match it), line the port up with the wheel, press to dock. A miss adds a second. Your best time is kept. |

The settings are shared with Endurance's SHIP › ROBOT page (Storage file `robot.json`), so a
change in one shows in the other.

How it picks a line: a joke is chosen with a chance that grows with HUMOR (and lights the cue
light); otherwise it is the blunt line, or, when HONESTY is under 60%, the evasive one.

## What's in it

| Dial | Section | Pages |
| --- | --- | --- |
| STAT | STATUS | The four segments as gauges: battery, free memory, free flash, temperature |
| INV | KIT | ID · REMOTE |
| DATA | SETTINGS | SETTINGS · ASK (nine questions; the answer depends on the settings) · FEEDS · LISTS · NOTES · INBOX · SYSTEM (colour, brightness, sounds, reset the settings, best docking time) |
| MAP | DOCK | The docking game |
| RADIO | COMMS | The FM dial and your presets (real FM), and five messages sent in Morse code by flashing the whole screen, the dots and dashes written beneath |

ID, FEEDS, LISTS, NOTES, INBOX, REMOTE and the FM radio work as they do in Mojave UI: see its
README. **Colours**, in SYSTEM and kept in Storage as `tars.json` with the best docking time:
WHITE, GREEN, AMBER, and PIP-BOY (the stock interface's own colour).

The wheels, dial, radio, settings and companion extras are the engine it shares with the other
apps (`../shared/engine.js`). The drawing code is its own.

## Build and try

```bash
./build.sh                                        # tars.min.js and sd/USER/TARS.EXT
node ../contact-sheet.mjs tars.min.js 1,2,7,1,1   # every page into contact-sheet.png
```

In the emulator: <http://localhost:8077/emulator/?app=tars>, or choose TARS on the emulator's
Run tab. On a Pip-Boy: install it from the dashboard's Apps page.
