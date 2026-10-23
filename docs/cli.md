# Command line

The Homebrewery has no CLI of its own. Development and deployment commands:

| Command | What it does |
|---|---|
| `make check` | Quality gate: lint, build and bundle the Worker without uploading, then the tests |
| `make doc` | No-op; this repository has no generated docs |
| `npm run build` | Build the client and themes into `build/` |
| `npm run dev:worker` | Build, then run the Worker locally with Wrangler (http://localhost:8787) |
| `npm run deploy` | Build and deploy the Worker to Cloudflare (needs `CLOUDFLARE_API_TOKEN`) |
| `npm start` | Run the Node.js server (needs MongoDB; being replaced by the Worker) |
| `npm test` | Run the Jest suites |
| `npm run lint:dry` | Lint without fixing |
| `npm run phb` | Regenerate `phb.standalone.css` |

Production deploys run from Cloudflare's GitHub integration on pushes to `main`.
