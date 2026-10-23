# HTTP API

The Worker serves HTML pages and a JSON API. Files in `build/` (bundles, themes, fonts, images,
`robots.txt`) are served by Workers Static Assets before any of these routes.

Brew write routes require the `Homebrewery-Version` header to equal the server version (`412`
otherwise). The signed-in account comes from the `nc_session` cookie (see
[architecture](architecture.md#accounts-and-admin)). Errors are JSON on `/api/*` paths (`HBErrorCode`,
`name`, `message`, `status` and details) and the error page elsewhere. Unknown `/api/*` routes
answer 404; unknown pages redirect to `/`. Requests whose `Accept` header asks only for images
answer 406.

## Pages

All page routes return `index.html` with `window.__INITIAL_PROPS__` injected.

| Route | Page |
|---|---|
| `GET /` | Home page |
| `GET /legacy`, `/migrate`, `/changelog`, `/faq` | Static content pages |
| `GET /new`, `GET /new/:shareId` | New brew, optionally cloned from a shared brew |
| `GET /edit/:editId` | Editor (owner, authors and invited authors; anyone for brews without authors) |
| `GET /share/:shareId` | Read-only brew; counts a view unless an author looks |
| `GET /user/:username` | A user's brews (unpublished ones and edit links only for the user) |
| `GET /account` | Account details (`401` when signed out) |
| `GET /vault` | Brew search |
| `GET /admin` | Admin tools (basic auth) |

## Brews

| Route | Purpose |
|---|---|
| `POST /api` | Create a brew from a JSON brew; returns it with `editId` and `shareId` |
| `PUT /api/update/:editId` | Save. Body: the brew (may be gzip-compressed with `Content-Encoding: gzip`) with `version`, `hash` (SHA-256 hex of the last saved text) and `patches`. `409` on a version or hash mismatch; `413` (`HBErrorCode` 14) when too large. Returns the brew without its text |
| `DELETE /api/:editId` | Remove the signed-in user from the authors; deletes the brew when no authors remain. `204` |
| `GET /api/fetch/:shareId` | `{ brew }` for the share page (with `editId` only for authors) |
| `GET /api/theme/:renderer/:id` | Theme bundle: `{ styles, snippets, name, author }` of a theme and its parents |
| `GET /metadata/:shareId` | Public brew metadata |
| `GET /css/:shareId` | Brew style as `text/css` (`404` without style) |
| `GET /source/:shareId` | Brew text as escaped HTML |
| `GET /download/:shareId` | Brew text as a `.txt` attachment |
| `GET /api/stream/:shareId` | WebSocket upgrade for live updates: messages `{"event":"brewUpdated","shareId","version","time"}`; send `ping` to get `pong`. `426` without an upgrade header |
| `PUT /api/user/rename` | `{ username, newUsername }`: rename the signed-in user (`newUsername`) on all their brews |
| `GET /api/vault` | Search published brews: `title` (every word must appear), `author`, `legacy`, `v3`, `page`, `count` (10–100), `sort` (`title`, `createdAt`, `updatedAt`, `views`, `lastViewed`, `pageCount`), `dir`. Returns `{ brews, page }`; email-address authors appear as `hidden` |
| `GET /api/vault/total` | `{ totalBrews }` for the same filters |
| `PUT /api/lock/review/request/:shareId` | Request review of a locked brew |
| `POST /local/login` | Local development only: `{ username }` → session token |

## Admin

HTTP basic auth with `ADMIN_USER` / `ADMIN_PASSWORD`; `401` without valid credentials or when no
admin password is configured.

| Route | Purpose |
|---|---|
| `GET`/`POST /admin/cleanupJunk` | List / delete (at most 300) brews untouched for 30 days with under 140 compressed bytes |
| `GET`/`POST /admin/cleanupLost` | List / delete (at most 500) authorless brews untouched for 2 years |
| `GET /admin/lookup/:id` | Find a brew by edit or share id |
| `PUT /admin/clean/script/:id` | Strip `<script` / `</script` from a brew's text, title and description |
| `GET /admin/user/list/:user` | A user's brews, including unpublished |
| `GET /admin/stats` | `{ totalBrews, totalPublishedBrews }` |
| `GET /api/lock/count`, `GET /api/locks`, `GET /api/lock/reviews` | Locked brews and review requests |
| `POST /api/lock/:shareId` | Lock a brew (body: `code`, `shareMessage`, `editMessage`, optional `overwrite`) |
| `PUT /api/unlock/:shareId` | Unlock a brew |
| `PUT /api/lock/review/remove/:shareId` | Clear a review request |
| `POST /admin/notification/add`, `DELETE /admin/notification/delete/:dismissKey` | Manage site notifications |
| `GET /admin/notification/all` | Site notifications (public; the navbar shows them) |
