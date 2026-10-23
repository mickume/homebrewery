# Steering Directives

## Library Reuse

1. Before implementing any functionality, check whether it already exists in the codebase.
2. **Use Standard library** -- prefer standard libraries over third-party alternatives.

## Target Platforms

The software MUST run locally on Linux or macOS systems.
The production deployment is to Cloudflare.

## Quality Gate

While implementing anything — a spec, a fix, a refactor — the **only** quality
gate you run is `make check`.

## Documentation Freshness

After implementing anything, you **must** update all affected documentation
before the session is considered complete. Outdated docs are treated as
regressions.

Before updating the documentation, run `make doc` first, to refresh the generated Go docs (see below).

**When to update:** Every time a spec implementation adds, changes, or removes
any of the items listed below, update the corresponding document in the same
session — not as a follow-up task.

| What changed | Update |
|---|---|
| REST endpoints or the public Go API added/changed/removed | `docs/api.md` |
| CLI commands, subcommands, or flags added/changed/removed | `docs/cli.md` |
| Config keys or env vars added/changed | `docs/configuration.md` |
| Architecture, package layout, or data flow changed | `docs/architecture.md` and/or relevant ADR |
| Setup, quickstart, or project overview changed | `README.md` |

*Important:* Do NOT write tests for testing the presence or the content of the docs or PRDs.

**Instructions:**

1. Review the spec you just implemented and identify every user-facing or
   developer-facing surface that changed (API routes, request/response
   schemas, CLI parameters, environment variables, architectural decisions).
2. Open each affected doc and update it to reflect the new state. Do not
   leave placeholder text like "TODO" or "TBD" — write the actual content.
3. If a doc file listed above does not exist yet, create it with the correct
   content rather than skipping the update. A repository without a REST API or
   CLI keeps the file anyway and says in one line that it has none.
4. Run `make check` after doc updates to ensure nothing is broken.

## Generated Docs

`make doc` writes `go doc -all` output for every publicly accessible package of
the repository (no `internal/` packages, no `examples/`) to `docs/generated/`,
one text file per package. The files are committed to git.

Their purpose is orientation: **when you start working on this repository, use
`docs/generated/` to find your way around.** It is the cheapest way to see which
packages exist, what each one is for and which types, functions and constants
it exports, before reading any source. Prefer it to scanning directories or
grepping for declarations.

- Never edit these files by hand; they are overwritten by `make doc`.
- Treat them as possibly stale: the code is authoritative. If a file disagrees
  with the source, regenerate it.
- Run `make doc` and commit the result whenever a change adds, removes or
  alters an exported identifier or a package doc comment.

## Repository Specifics

This repo is a fork of https://github.com/naturalcrit/homebrewery. Compatibility with
the upstream project is not a requirement.
