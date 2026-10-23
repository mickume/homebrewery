.PHONY: check lint test worker-check doc

# Quality gate: lint, build and bundle the Worker exactly as a deploy would, then the tests
# (tests/routes/static-content.test.js needs the built assets)
check: lint worker-check test

lint:
	npm run lint:dry

test:
	npm test

# Runs the custom build (vite) and bundles the Worker without uploading anything
worker-check:
	npx wrangler deploy --dry-run --outdir .wrangler/dry-run

# This repository has no Go packages, so there are no generated docs to refresh
doc:
	@echo "No generated docs for this repository."
