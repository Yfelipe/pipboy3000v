# Server API

All JSON unless noted. Writes with a JSON body require `Content-Type: application/json`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/health` | server status |
| GET | `/api/records[?kind=app\|radio\|settings]` | list records |
| POST | `/api/records` | create app / radio preset |
| PATCH | `/api/records/:id` | rename / change payload |
| DELETE | `/api/records/:id` | remove |
| GET / PUT | `/api/settings` | read / upsert the single settings profile |
| GET | `/api/backup` | download a backup (v2) |
| POST | `/api/backup/preview` | validate a backup and summarise it |
| POST | `/api/backup/import` | import (all-or-nothing) |
| GET | `/api/files` | list workspace files |
| PUT | `/api/files/:name[?overwrite=1]` | upload raw bytes |
| GET / DELETE | `/api/files/:name` | download / delete |
| GET / POST / DELETE | `/api/logs` | read / append / clear the activity log |
| GET / POST | `/api/dumps` | list dumps / start a new dump folder |
| PUT / GET | `/api/dumps/:id/files/<path>` | write / read a file inside a dump (segments URL-encoded) |
| DELETE | `/api/dumps/:id` | delete a dump |
| GET | `/api/forecast?lat=&lon=` | weather for the wasteland forecast, from Open-Meteo (kept for 30 minutes) |
| GET | `/api/places?name=` | find a place by name, from Open-Meteo's place search |

The server only answers requests from this computer (see [SECURITY.md](SECURITY.md)). A new
route goes in `route()` in `server/app.js`, validates its input with `shared/validate.js`, is added
to this table, and is tested in `test/api.test.js`.
