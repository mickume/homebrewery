# Configuration

## Cloudflare Worker

The Worker is configured in `wrangler.jsonc`:

| Key | Value | Purpose |
|---|---|---|
| `name` | `homebrewery` | The Cloudflare Worker this repository deploys to |
| `main` | `worker/index.js` | Worker entry point |
| `compatibility_flags` | `nodejs_compat` | Node.js APIs and the HTTP server layer Express needs |
| `build.command` | `npm run build` | Builds `build/` before `wrangler dev` and `wrangler deploy` |
| `assets.directory` | `./build` | Static client files, served without invoking the Worker |
| `assets.binding` | `ASSETS` | Lets the Worker read `index.html` |
| `assets.html_handling` | `none` | Keeps `/` from resolving to `build/index.html` |
| `rules` | `**/*.md` as Text | Bundles markdown page content into the Worker |
| `previews` | `{}` | Required by `wrangler preview`, which Workers Builds runs for non-`main` branches |

The Worker does not read any variables or secrets yet.

The Node.js version for local work and Cloudflare builds is pinned in `.node-version`.
Cloudflare's build image installs dependencies with its own npm 10.9.2 regardless of
the Node.js version, and `npm ci` there fails if `package-lock.json` was resolved only
by npm 11. After changing dependencies, refresh the lockfile with
`npx npm@10.9.2 install --package-lock-only` and check that `npx npm@10.9.2 ci` succeeds.

## Node.js server (being replaced)

`server/config.js` merges, in order of precedence: command-line arguments, environment
variables (lower-cased), `config/$NODE_ENV.json`, `config/dev.json` and
`config/default.json`.

| Key | Default | Purpose |
|---|---|---|
| `NODE_ENV` | — | `local` or `docker` enables local login, Vite middleware and HTTP |
| `web_port` / `PORT` | `8000` | HTTP port |
| `mongodb_uri` / `mongolab_uri` | `mongodb://127.0.0.1/homebrewery` | MongoDB connection |
| `secret` | `secret` | Signing key for the `nc_session` JWT cookie |
| `publicUrl` | `https://homebrewery.naturalcrit.com` | Base URL for share links and thumbnails |
| `naturalcrit_url` | `local.naturalcrit.com:8010` | Login service |
| `development_style` | `false` | Shows the "Local" background watermark |
| `hb_images`, `hb_fonts` | `null` | Local directories served at `/staticImages`, `/staticFonts` |
| `service_account`, `google_api_key`, `google_client_id`, `google_client_secret` | — | Google Drive storage |
| `ADMIN_USER`, `ADMIN_PASS` | `admin`, `password3` | Basic auth for `/admin` |
