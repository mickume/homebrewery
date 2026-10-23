# HTTP API

The Express app serves both HTML pages and a JSON API. While the move to Cloudflare
Workers is in progress ([ADR 01](adr/01-run-on-cloudflare-workers-with-d1.md)), the
Worker serves only the routes marked **Worker**; it answers every other route with
`503 {"message": "This route has not been migrated to Cloudflare Workers yet."}`.
The Node.js server serves all routes below except `/api/health`.

Brew write routes require the `Homebrewery-Version` header to equal the server version
(`412` otherwise). Accounts come from the `nc_session` JWT cookie.

## Pages

All page routes return `index.html` with `window.__INITIAL_PROPS__` injected.

| Route | Page |
|---|---|
| `GET /` | Home page (**Worker**) |
| `GET /legacy`, `/migrate`, `/changelog`, `/faq` | Static content pages |
| `GET /new`, `GET /new/:shareId` | New brew, optionally cloned from a shared brew |
| `GET /edit/:editId` | Editor (authors and invited authors only) |
| `GET /share/:shareId` | Read-only brew; increments the view count for non-authors |
| `GET /user/:username` | A user's brews (unpublished ones only for the owner) |
| `GET /account` | Account details (`401` when signed out) |
| `GET /vault` | Brew search |
| `GET /admin` | Admin tools (basic auth) |

## Brews

| Route | Purpose |
|---|---|
| `POST /api` | Create a brew; returns the saved brew including `editId` and `shareId` |
| `PUT /api/update/:editId` (alias `PUT /api/:editId`) | Save patches; `409` on version or hash mismatch |
| `GET /api/remove/:editId` (alias `DELETE /api/:editId`) | Remove the caller as author; deletes the brew when no authors remain |
| `GET /api/fetch/:shareId` | Brew JSON for the share page |
| `GET /api/theme/:renderer/:id` | Theme bundle: styles and snippets of a theme and its parents |
| `GET /metadata/:shareId` | Public brew metadata |
| `GET /css/:shareId` | Brew style as `text/css` |
| `GET /source/:shareId` | Brew text as escaped HTML |
| `GET /download/:shareId` | Brew text as a `.txt` attachment |
| `GET /api/stream/:shareId` | Server-sent events announcing brew updates |
| `PUT /api/user/rename` | Rename the signed-in user on all their brews |
| `GET /api/vault`, `GET /api/vault/total` | Search published brews (`title`, `author`, `legacy`, `v3`, `page`, `count`, `sort`, `dir`) |
| `PUT /api/lock/review/request/:shareId` | Request review of a locked brew |
| `POST /local/login` | Local environments only: returns a session token for `username` |
| `GET /api/health` | `{"status": "ok", "version": "..."}` (**Worker**) |

## Admin

Basic auth with `ADMIN_USER` / `ADMIN_PASS`.

| Route | Purpose |
|---|---|
| `GET`/`POST /admin/cleanupJunk` | List / delete tiny brews untouched for 30 days |
| `GET`/`POST /admin/cleanupLost` | List / delete authorless brews untouched for 2 years |
| `GET /admin/lookup/:id` | Find a brew by edit or share id |
| `GET /admin/finduncompressed`, `PUT /admin/compress/:id` | Find / compress brews with uncompressed text |
| `PUT /admin/clean/script/:shareId` | Strip `<script` from a brew |
| `GET /admin/user/list/:user` | List a user's brews |
| `GET /admin/stats` | Total and published brew counts |
| `GET /api/lock/count`, `GET /api/locks`, `GET /api/lock/reviews` | Locked brews and review requests |
| `POST /api/lock/:shareId`, `PUT /api/unlock/:shareId` | Lock / unlock a brew |
| `PUT /api/lock/review/remove/:shareId` | Clear a review request |
| `GET /admin/notification/all`, `POST /admin/notification/add`, `DELETE /admin/notification/delete/:key` | Site notifications |
