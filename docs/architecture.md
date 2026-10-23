# Architecture

The Homebrewery is a React single-page client served by a Cloudflare Worker. The Worker renders no
React: it answers page routes with `index.html` plus a `window.__INITIAL_PROPS__` script holding the
page's data (brew, account, config), and exposes a JSON API for saving and loading brews.
Decisions: [ADR 01](adr/01-run-on-cloudflare-workers-with-d1.md),
[ADR 02](adr/02-use-hono-and-web-standard-apis-on-workers.md).

```
browser ──▶ Workers Static Assets (build/)        files that exist: bundles, themes, fonts, images
        └─▶ Worker (worker/index.js → Hono app)   everything else
              ├─ D1 binding DB                      brews, authors, notifications
              ├─ ASSETS binding                     reads index.html to render pages
              └─ Durable Object BREW_UPDATES        one per shareId; WebSockets of open share pages
```

## Layout

| Path | Contents |
|---|---|
| `worker/` | Worker entry point (`index.js`) and the `BrewUpdates` Durable Object (`brewUpdates.js`) |
| `server/app.js` | Hono app: middleware, routes, error handling |
| `server/*.api.js`, `server/page-routes.js` | Route modules: brews, admin and locks, Vault, live updates, pages |
| `server/middleware/` | Request context (config, stores, account), client version check, content negotiation |
| `server/storage/` | D1 stores (`brewStore.js`, `notificationStore.js`) and the migration runner (`migrate.js`) |
| `server/render.js` | Renders the app shell with page props |
| `server/brewText.js` | Merging metadata and style into the stored brew text |
| `migrations/` | D1 schema migrations, listed in `server/storage/migrations.js` |
| `client/` | React client: `homebrew/` (pages, editor, renderer, navbar), `admin/`, `components/` |
| `shared/` | Code used by client and Worker (markdown helpers, hashing, naturalcrit styles) |
| `themes/` | Brew themes (LESS, snippets, fonts, images); compiled into `build/themes` |
| `vitePlugins/` | Build plugin that compiles themes and copies fonts, assets, `robots.txt` and `_headers` into `build/` |
| `tests/` | Jest tests (markdown, HTML, pages); `tests/support/` holds the test databases and app |

## Build

`npm run build` runs Vite, which bundles the client into `build/` (`build/index.html` →
`build/index/bundle.js`) and, through `generateAssetsPlugin`, compiles the themes, copies fonts,
icons and images, and writes `themes/themes.json`. Wrangler runs this build before `wrangler dev`
and `wrangler deploy` (`build.command`), then bundles `worker/index.js` with esbuild. Markdown pages
and SQL migrations are bundled as text modules. The Worker uses only web-standard APIs, so it runs
without the `nodejs_compat` flag.

## Request flow

1. Workers Static Assets serves any request that matches a file in `build/`, with cache rules from
   `_headers`. `html_handling: none` keeps `/` from resolving to `index.html`.
2. Other requests reach the Hono app. Middleware runs in order: errors-as-`Error` wrapper, config
   (from `env`), content negotiation (406 for image requests), a 25 MB body limit, stores (applies
   pending migrations once per isolate, then creates the D1 stores), account (verifies the
   `nc_session` JWT cookie with `JWT_SECRET`).
3. Route modules handle the request. Page routes call `renderPage`, which fetches `index.html`
   through `ASSETS` (cached per isolate) and injects the props and Open Graph tags.
4. Errors thrown as `hbError({ HBErrorCode, status, ... })` become JSON for `/api/*` paths and the
   client error page otherwise.

## Storage (D1)

Each store is created per request from the D1 binding and takes and returns plain objects with the
camelCase fields the client uses. Brews are addressed by `editId` or `shareId`; the integer
primary key stays inside the store.

| Table | Contents |
|---|---|
| `brews` | One row per brew. `text_bin` holds the text deflate-raw compressed (`CompressionStream`); `tags`, `invited_authors` and `lock` are JSON; dates are ISO 8601 strings |
| `brew_authors` | `(brew_id, position, username)`; position 0 is the owner. Indexed by username |
| `notifications` | Site notifications keyed by `dismiss_key` |
| `d1_migrations` | Applied migrations, in the format `wrangler d1 migrations` uses |

The stored text is one document: a ```` ```metadata ```` YAML block, an optional ```` ```css ````
block, then the markdown (`mergeBrewText`); loading splits it again (`splitTextStyleAndMetadata`).

D1 limits rows to 2 MB, so brews whose compressed text exceeds 1.9 MB are rejected with 413 and
`HBErrorCode` 14. Saves are conditional on the stored `version`, so two concurrent saves of the same
version cannot both succeed.

Migrations: the Worker applies pending migrations itself on the first request of each isolate
(`ensureMigrated`). Each migration runs in one D1 batch together with its `d1_migrations` record,
so it applies completely or not at all, and concurrent isolates cannot apply it twice. Production
uses the `homebrewery` database; preview versions of branches use `homebrewery-preview`.

## Saving a brew

The editor sends the full brew, gzip-compressed (`Content-Encoding: gzip`), with the `version` it
last saved, a SHA-256 `hash` of the last saved text and a diff-match-patch `patches` string. The
Worker rejects the save with 409 if the version or the hash does not match the stored brew, logs
whether the patches reproduce the new text (the full text stays authoritative), merges metadata and
style into the text, writes it with the version guard, and broadcasts the new version.

## Live updates

`/api/stream/:shareId` upgrades to a WebSocket held by the `BrewUpdates` Durable Object for that
brew (`idFromName(shareId)`). The object accepts sockets with the hibernation API and answers
`ping` with `pong` without waking up. After a save, the Worker calls the object's `broadcast()` over
RPC (inside `waitUntil`), and every open share page of the brew reloads it. Share pages reconnect
with backoff when the connection drops.

## Accounts and admin

Accounts are the `nc_session` cookie: an HS256 JWT holding `{ username, issued }`, verified with the
`JWT_SECRET` secret. Without the secret nobody is signed in. In local development `/local/login`
issues such a token for any username. `/admin` and the admin API use HTTP basic auth with
`ADMIN_USER` / `ADMIN_PASSWORD`, compared in constant time; without `ADMIN_PASSWORD` they are off.

## Tests

Jest runs everything with `app.request()`, so no ports are opened except by the local D1 runs:

- route specs (`server/*.spec.js`, `tests/routes/`) use the real app with an in-memory D1-shaped
  database over `node:sqlite` (`tests/support/testApp.js`);
- store specs run against `node:sqlite` and against a real local D1 in workerd through Wrangler's
  `getPlatformProxy` (`tests/support/testDatabases.js`);
- the Durable Object is replaced by a fake that records broadcasts.
