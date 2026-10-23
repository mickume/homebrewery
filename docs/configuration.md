# Configuration

All configuration lives in `wrangler.jsonc` (bindings and variables) and in Worker secrets.
`server/config.js` reads them from the Worker's `env`.

## Variables and secrets

| Name | Kind | Default | Purpose |
|---|---|---|---|
| `ENVIRONMENT` | var | `production` | `production`, `preview` (set for branch previews) or `local` (set by `npm run dev`). `local` enables `/local/login` and a fallback JWT secret; `preview` shows a "Preview" watermark |
| `JWT_SECRET` | secret | — | Signing key of the `nc_session` cookie. Without it nobody is signed in (locally a fixed development key is used) |
| `ADMIN_USER` | var or secret | `admin` | Basic-auth user for `/admin` |
| `ADMIN_PASSWORD` | secret | — | Basic-auth password for `/admin`. Without it the admin pages and admin API answer 401. `npm run dev` sets `admin` |

Set secrets on the deployed Worker with Wrangler, for example:

```sh
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put JWT_SECRET
```

Local development takes its values from the `--var` flags in the `dev` script; a `.dev.vars` file
(git-ignored) can override them.

## wrangler.jsonc

| Key | Value | Purpose |
|---|---|---|
| `name` | `homebrewery` | The Cloudflare Worker this repository deploys to |
| `main` | `worker/index.js` | Worker entry point |
| `compatibility_date` | `2026-10-01` | No compatibility flags: the Worker uses only web-standard APIs |
| `build.command`, `build.watch_dir` | `npm run build`; client sources | Builds `build/` before `wrangler dev` and `wrangler deploy`; `wrangler dev` rebuilds on changes |
| `assets` | `./build`, binding `ASSETS`, `html_handling: none` | Static client files served without invoking the Worker; `/` still reaches the Worker |
| `rules` | `**/*.md`, `**/*.sql` as Text | Bundles page markdown and migrations into the Worker |
| `vars` | `ENVIRONMENT: production` | See above |
| `d1_databases` | `DB` → `homebrewery` (`63abfe96-…`) | Production database |
| `durable_objects`, `migrations` | `BREW_UPDATES` → `BrewUpdates` (SQLite-backed, tag `v1`) | Live share-page updates |
| `previews` | `ENVIRONMENT: preview`, `DB` → `homebrewery-preview` (`ac9066b1-…`), `BREW_UPDATES` | Branch previews (`wrangler preview`) use their own database. `wrangler preview` requires an explicit `database_id` |
| `workers_dev`, `preview_urls` | `true` | Production at `homebrewery.m-2d9.workers.dev`; previews at `<branch>-homebrewery.m-2d9.workers.dev` |
| `observability` | enabled | Workers Logs |

`_headers` (copied into `build/`) sets `Cache-Control` for static assets: 30 days for fonts, images
and icons, 12 hours for scripts and theme CSS.

## Node.js, npm and the lockfile

The Node.js version for local work, CI and Cloudflare builds is pinned in `.node-version`.
Cloudflare's build image installs dependencies with its own npm 10.9.2 regardless of the Node.js
version, and `npm ci` there fails if `package-lock.json` was resolved only by npm 11. After
changing dependencies, refresh the lockfile with `npx npm@10.9.2 install --package-lock-only` and
check that `npx npm@10.9.2 ci` succeeds.

## Workers Builds

The Cloudflare project builds from GitHub: build command `npm run build`, deploy command
`npx wrangler deploy` on `main`, `npx wrangler preview` on other branches. Schema migrations need
no deploy step; the Worker applies them on its first request.
