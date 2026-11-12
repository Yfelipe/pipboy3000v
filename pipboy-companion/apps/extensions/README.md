# Extensions

Extensions add screens to the stock Pip-OS instead of replacing it. Each is a Storage file
`ext.<id>.js`, run by a small loader the dashboard installs as `.boot0`
(`apps/extensions/loader.js`): Espruino runs `.boot0` before Pip-OS, and the loader runs the
extensions from the `init` event once Pip-OS has loaded (Pip-OS clears timers when it starts).
Holding the torch button while the Pip-Boy starts skips them. A Pip-OS update erases Storage,
extensions included.

## The catalog

- **Media remote** (INV › REMOTE): the Pip-Boy becomes USB media keys for the computer it's
  plugged into. Wheel: volume; wheel press: play/pause; thumbwheel: previous/next track;
  PLAY: mute. It's a USB keyboard + consumer-control device next to the serial port, so the
  dashboard keeps working, and the stock EXT TERMINAL shares its keyboard part. The computer
  only sees it after the USB cable is unplugged and plugged back in, and the screen says so.
- **Radio presets** (RADIO): the stations saved on the Radio presets page
  (`companion-radio.json` in Storage) appear in the radio menu and tune with one press.
- **Notes** (DATA › NOTES): reads `NOTES/*.txt` on the SD card, with a scrolling viewer.
  Write and edit them on **ID, lists & notes**.
- **Inbox** (STAT › INBOX): the messages sent from Home.

## Building

The dashboard installs minified copies (`apps/extensions/min/`, made by `npm run apps:build`
with the apps). Loader 2 also scrolls the tab header when extensions add more entries than
fit. When an older loader is on the Pip-Boy the Apps page offers to update it.
