# 02. Use Hono and web-standard APIs on Workers

## Status

Accepted (2026-10-23). Supersedes the runtime and live-update parts of
[ADR 01](01-run-on-cloudflare-workers-with-d1.md).

## Context

ADR 01 kept the upstream Express app and ran it through Workers' Node.js HTTP server
compatibility layer. Porting the routes off MongoDB meant rewriting most of the server code and
its tests anyway, and compatibility with upstream is not a goal of this fork. Several upstream
pieces had no good equivalent on Workers:

- Express middleware (`body-parser`, `cookie-parser`, `cors`, `express-static-gzip`) built around
  Node streams and the filesystem;
- `hash-wasm`, whose runtime WebAssembly compilation Workers forbids;
- `zlib`, `Buffer` and `jwt-simple`, which need the `nodejs_compat` layer;
- live share-page updates kept in process memory, which does not work across isolates;
- configuration from `config/*.json` files and insecure defaults (admin password `password3`).

## Decision

- **Framework:** [Hono](https://hono.dev). It is built on `Request`/`Response`, reads bindings
  from `c.env`, and is tested with `app.request()`, so tests open no ports. The Worker
  exports the Hono app directly.
- **Web-standard APIs only.** Brew text is compressed with `CompressionStream('deflate-raw')`,
  gzip request bodies are decoded with `DecompressionStream`, sessions use `hono/jwt` (WebCrypto
  HMAC), and admin credentials are compared with Hono's constant-time comparison. The Worker
  needs no compatibility flags.
- **Save-integrity hash: SHA-256 via WebCrypto** (`shared/hash.js`) on both client and server,
  replacing md5 from `hash-wasm`.
- **Live updates: a Durable Object per brew** (`BrewUpdates`, keyed by `shareId`). Share pages
  open a WebSocket that the object accepts with the hibernation API; pings are answered by an
  auto-response without waking it. After a save, the Worker calls the object's `broadcast()`
  over RPC inside `waitUntil`.
- **Configuration from bindings:** `vars` in `wrangler.jsonc` (`ENVIRONMENT`) and secrets
  (`JWT_SECRET`, `ADMIN_PASSWORD`). Admin is off without an admin password; nobody is signed in
  without a JWT secret.
- **Separate production and preview databases, migrated by the Worker.** `homebrewery` and
  `homebrewery-preview` are bound by id (`wrangler preview` does not provision databases the
  way `wrangler deploy` does). Branch previews bind their own database
  (`previews.d1_databases`). The Worker applies pending migrations on the first
  request of each isolate, recorded in Wrangler's `d1_migrations` table, so no deploy step is
  needed and previews can never migrate the production database.
- **Static assets are Cloudflare's job:** cache rules in `_headers`, `robots.txt` as an asset,
  compression by the edge.
- **Same-origin only:** no CORS middleware. The client and API share one origin.
- **Local development with `wrangler dev`** (`npm run dev`), rebuilding the client with Vite on
  changes. The Cloudflare Vite plugin would add hot module reload, but it bundles the Worker with
  Vite too, which needs separate handling for the bundled markdown and SQL; that can come later.

## Consequences

- Express and its middleware, `jwt-simple`, `hash-wasm`, `nconf` and `supertest` are gone; the
  Worker bundle is about 200 KiB gzipped (it was 375 KiB with Express).
- The server uses plain `marked` (not `marked-hbfm`) to find a brew's default title, because the
  `marked-hbfm` extensions only publish UMD builds for browser targets.
- Hashes from upstream md5-based clients are not accepted; there are none, as the fork is
  greenfield.
- Durable Objects add a binding and a class migration (`v1`, SQLite-backed, available on the
  free plan).
- Without secrets, a fresh deployment works for anonymous brews and has admin turned off,
  which is safe by default.
