# Command line

The Homebrewery has no CLI of its own. Development and deployment commands:

| Command | What it does |
|---|---|
| `make check` | Quality gate: lint, build and bundle the Worker without uploading, then the tests |
| `make doc` | No-op; this repository has no generated docs |
| `npm run dev` (or `npm start`) | Build, then run the Worker locally with Wrangler at http://localhost:8787, with local D1 and Durable Objects, `ENVIRONMENT=local` and admin password `admin`. Rebuilds the client on changes |
| `npm run build` | Build the client and themes into `build/` |
| `npm run deploy` | Build and deploy the Worker to Cloudflare (needs `CLOUDFLARE_API_TOKEN`) |
| `npm test` | Run the Jest suites |
| `npm run lint:dry` | Lint without fixing |
| `npm run phb` | Regenerate `phb.standalone.css` |
| `npx wrangler d1 migrations list DB --local` | Show applied schema migrations of the local database (`--remote` for production) |
| `npx wrangler d1 execute DB --local --command "SELECT ..."` | Query the local database |
| `npx wrangler secret put ADMIN_PASSWORD` | Set a secret on the deployed Worker |

Production deploys run from Cloudflare's GitHub integration on pushes to `main`; branch pushes
create previews. GitHub Actions runs `make check` on pull requests (`.github/workflows/check.yml`).
