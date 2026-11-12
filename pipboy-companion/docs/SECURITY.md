# Security notes

- The server binds to `127.0.0.1` and only answers requests whose `Host` is `localhost`,
  `127.0.0.1` or `::1`. That blocks DNS-rebinding attacks from websites you visit.
- Cross-origin writes are refused: the `Origin` header must match, and a browser's
  `Sec-Fetch-Site` must say `same-origin`. Writes with a JSON body must also say
  `Content-Type: application/json`. The writes without one (file uploads with `PUT`, `DELETE`,
  and `POST /api/dumps`, which takes no body) rely on the `Origin` and `Sec-Fetch-Site` checks.
- The server contacts two outside services, both only when you ask: The Wand Company's release
  index (the emulator's Pip-OS list) and Open-Meteo (the wasteland forecast: your rounded
  coordinates or the place name you typed are sent to it). The page itself only talks to this
  server (`connect-src 'self'`).
- There's no authentication, so the server only runs on this computer: `HOST` must be
  `127.0.0.1`, `::1` or `localhost`, and anything else stops it at start-up.
- The CSP allows scripts only from this server and one pinned version of the lucide icon
  library on its CDN, which is used only until `npm run vendor` saves a local copy
  (`public/vendor/`, git-ignored). That keeps third-party code off a page that can reach the
  Pip-Boy over USB. Fonts and icons are optional, and the app works offline.
- Names that end up in code on the Pip-Boy (Storage names in `.bootPowerOn`, paths and text in
  REPL commands) are validated or passed as JSON strings, never pasted in raw.
- An app's SD card extras (`USER/*.EXT`) are code, like the `USER/*.JS` launchers next to
  them: anyone who can write to the SD card can already change what the Pip-Boy runs.
