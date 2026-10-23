# Architecture

The Homebrewery is a React single-page client served by an Express server. The server
renders no React; it answers page routes with `index.html` plus a
`window.__INITIAL_PROPS__` script holding the page's data (brew, account, config), and
exposes a JSON API for saving and loading brews.

The project is moving from a Node.js server with MongoDB to Cloudflare Workers with D1
([ADR 01](adr/01-run-on-cloudflare-workers-with-d1.md)). Both entry points exist while
the migration is in progress.

## Layout

| Path | Contents |
|---|---|
| `client/` | React client: `homebrew/` (pages, editor, renderer, navbar), `admin/`, `components/` |
| `shared/` | Code used by client and server (markdown helpers, naturalcrit styles) |
| `themes/` | Brew themes (LESS, snippets, fonts, images); compiled into `build/themes` |
| `server/` | Express app (`app.js`), routes, Mongoose models, middleware |
| `server.js` | Node.js entry point: Vite dev middleware, MongoDB connection, `app.listen` |
| `worker/index.js` | Cloudflare Worker entry point (transitional, see below) |
| `vitePlugins/` | Build plugin that compiles themes and copies fonts and assets into `build/` |
| `wrangler.jsonc` | Worker configuration: entry point, compatibility flags, assets, build command |
| `tests/` | Jest tests for markdown rendering, HTML helpers and routes |

## Build

`npm run build` runs Vite, which bundles the client into `build/` (entry `build/index.html`
→ `build/index/bundle.js`) and, through `generateAssetsPlugin`, compiles the themes and
copies fonts, icons and images into `build/`. It also writes `themes/themes.json`.

## Cloudflare Worker

`worker/index.js` runs an Express app on workerd via `httpServerHandler` from
`cloudflare:node`. Requests that match a file in `build/` are served by Workers Static
Assets without invoking the Worker; everything else reaches Express. The Worker reads
`index.html` through the `ASSETS` binding and injects the page props. Markdown page
content is bundled into the Worker as text modules.

Currently the Worker serves the home page and `/api/health`; every other route answers
`503` until the server code is ported off MongoDB and the filesystem.

## Node.js server (being replaced)

`server.js` connects to MongoDB, mounts Vite's dev middleware in local environments,
and starts `server/app.js` on port 8000. Brews are stored in MongoDB with their text
deflate-compressed; Google Drive storage is optional. Live share-page updates use
server-sent events from an in-memory subscriber list.
