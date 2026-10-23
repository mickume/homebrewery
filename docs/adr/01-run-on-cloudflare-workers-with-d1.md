# 01. Run on Cloudflare Workers with D1 instead of Node.js and MongoDB

## Status

Accepted (2026-10-23). Implementation is in progress; see "Migration steps".

## Context

The upstream Homebrewery is a long-running Node.js Express server backed by MongoDB
(Mongoose), with optional Google Drive storage, authentication delegated to
naturalcrit.com, and server-sent events for live share-page updates. This fork is
deployed to Cloudflare (a Worker named `homebrewery`, built from GitHub) and must
also run locally on Linux and macOS.

The upstream server cannot run on Workers as is:

- there is no Worker entry point or `wrangler` configuration;
- it needs a MongoDB connection;
- it reads `index.html`, page markdown and `config/*.json` from disk at runtime;
- `hash-wasm` compiles WebAssembly at runtime, which Workers forbids;
- the live-update stream keeps subscribers in process memory and starts timers at
  module load, neither of which works across stateless Worker isolates;
- static assets are served from disk with `express-static-gzip`.

The project is greenfield: there is no existing MongoDB data to migrate.

## Decision

- **Runtime:** keep the Express app and run it on Workers through the Node.js HTTP
  server compatibility layer (`httpServerHandler` from `cloudflare:node`, with the
  `nodejs_compat` flag). This keeps route code and the supertest-based tests largely
  unchanged. Hono is the fallback if this layer proves insufficient.
- **Static assets:** served by Workers Static Assets from `build/` (binding `ASSETS`).
  `html_handling` is `none` so page routes reach the Worker, which injects the page
  props into `index.html`.
- **Database:** Cloudflare D1. Locally, Wrangler/Miniflare keeps D1 as a SQLite file
  under `.wrangler/state`, so no database server is needed. Schema changes are SQL
  migrations. Brew text stays deflate-compressed in a BLOB column; D1's 2 MB row limit
  caps the size of a single brew. Authors move to a join table so author queries are
  indexed; Vault title search uses FTS5.
- **Google Drive storage:** removed. All brews live in D1.
- **Live share-page updates:** `/api/stream/:id` answers `204 No Content`, which tells
  the browser's `EventSource` to stop reconnecting. A Durable Object can restore the
  feature later.
- **Authentication:** unchanged for now (the `nc_session` JWT cookie from
  naturalcrit.com, plus `/local/login` in local environments). Real sign-in for this
  deployment is a later functional change.

## Consequences

- MongoDB, Mongoose, Docker Compose and the Google APIs dependency are removed.
- Configuration moves from `config/*.json` files to Worker variables and secrets.
- Until real authentication exists, the deployed site supports anonymous brews only.
- Brews larger than D1's row limit are rejected with an explicit error.
- The Workers free plan (10 ms CPU per request, 3 MB compressed bundle) is acceptable
  during development; saving very large brews may need the paid plan.

## Migration steps

1. Tooling baseline: `wrangler.jsonc`, a spike Worker running Express, `make check`.
2. Storage layer over D1 with the first migration, tested against `node:sqlite`.
3. Replace Mongoose with the storage layer; remove Google Drive.
4. Make the server Workers-safe (config, bundled files, hashing, static assets).
5. Serve the full app from the Worker; local development through the Cloudflare Vite plugin.
6. Final documentation pass.
