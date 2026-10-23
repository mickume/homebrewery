# 01. Run on Cloudflare Workers with D1 instead of Node.js and MongoDB

## Status

Accepted (2026-10-23), implemented. The runtime and live-update decisions are superseded by
[ADR 02](02-use-hono-and-web-standard-apis-on-workers.md); the rest stands.

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
  unchanged. Hono is the fallback if this layer proves insufficient. *(Superseded: ADR 02
  moves to Hono.)*
- **Static assets:** served by Workers Static Assets from `build/` (binding `ASSETS`).
  `html_handling` is `none` so page routes reach the Worker, which injects the page
  props into `index.html`.
- **Database:** Cloudflare D1. Locally, Wrangler/Miniflare keeps D1 as a SQLite file
  under `.wrangler/state`, so no database server is needed. Schema changes are SQL
  migrations. Brew text stays deflate-compressed in a BLOB column; D1's 2 MB row limit
  caps the size of a single brew. Authors move to a join table so author queries are
  indexed. Vault title search matches every word of the query with `LIKE` (case-insensitive)
  rather than FTS5, because `wrangler d1 export` cannot export databases containing virtual tables.
- **Google Drive storage:** removed. All brews live in D1.
- **Live share-page updates:** `/api/stream/:id` answers `204 No Content`, which tells
  the browser's `EventSource` to stop reconnecting. A Durable Object can restore the
  feature later. *(Superseded: ADR 02 restores the feature with a Durable Object.)*
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

1. Tooling baseline: `wrangler.jsonc`, a spike Worker running Express, `make check` (PR #1).
2. Storage layer over D1 with the first migration, tested against `node:sqlite` and a local D1 (PR #2).
3. to 6. Done together with ADR 02: the routes on Hono and D1, Google Drive removed, Worker-safe
   configuration and assets, the full app served from the Worker, documentation. Local
   development uses `wrangler dev` rather than the Cloudflare Vite plugin (see ADR 02).
