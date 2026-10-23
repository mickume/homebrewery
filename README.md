# The Homebrewery

The Homebrewery is a tool for making authentic looking [D&D content][dnd-content-url]
using [Markdown][markdown-url]. It is distributed under the terms of the [MIT License](./license).

This repository is a fork of [naturalcrit/homebrewery][upstream-url] that runs entirely on
Cloudflare: a [Worker][workers-url] serves the app, [D1][d1-url] stores the brews and a
[Durable Object][durable-objects-url] pushes live updates to open share pages. There is no
database server to install, locally or in production.

[dnd-content-url]: https://dnd.wizards.com/products/tabletop-games/rpg-products/rpg_playershandbook
[markdown-url]: https://github.com/adam-p/markdown-here/wiki/Markdown-Cheatsheet
[upstream-url]: https://github.com/naturalcrit/homebrewery
[workers-url]: https://developers.cloudflare.com/workers/
[d1-url]: https://developers.cloudflare.com/d1/
[durable-objects-url]: https://developers.cloudflare.com/durable-objects/

## Quick start

Requirements: [Node.js](https://nodejs.org/) 26.4 or newer (the exact version is pinned in
`.node-version`) and git. Linux and macOS are supported.

```sh
git clone https://github.com/mickume/homebrewery.git
cd homebrewery
npm install
npm run dev
```

`npm run dev` builds the client and starts the Worker locally with Wrangler at
[http://localhost:8787](http://localhost:8787). D1 and the Durable Object run locally too; the
database lives in `.wrangler/state` and gets its schema on the first request. The client is
rebuilt when files in `client/`, `shared/` or `themes/` change; reload the page to pick it up.

In local development:

- sign in as any username from the account menu in the navbar (local login),
- the admin pages at `/admin` accept user `admin`, password `admin`.

Run the quality gate (lint, Worker build, tests) with `make check`.

## Deployment

Pushes to `main` deploy through Cloudflare Workers Builds (`npx wrangler deploy`); other branches
get a preview with their own database (`npx wrangler preview`). The first deploy creates the D1
databases `homebrewery` and `homebrewery-preview`. Production runs at
`https://homebrewery.m-2d9.workers.dev`.

Admin access and sign-in need secrets on the Worker; see
[docs/configuration.md](./docs/configuration.md).

## Documentation

- [docs/architecture.md](./docs/architecture.md): how the Worker, D1, the Durable Object and the client fit together
- [docs/configuration.md](./docs/configuration.md): Wrangler configuration, variables and secrets
- [docs/api.md](./docs/api.md): pages and HTTP API
- [docs/cli.md](./docs/cli.md): development and deployment commands
- [docs/adr/](./docs/adr/): architecture decisions

### Standalone PHB stylesheet

If you just want the stylesheet that makes pages look like the Player's Handbook, use
[phb.standalone.css](./phb.standalone.css). Regenerate it with `npm run phb`.

## Changelog

See the [changelog](./changelog.md) (upstream's history up to the fork).

## License

This project is licensed under the [MIT license](./license), which means you
are free to use The Homebrewery in any way that you want, except for claiming
that you made it yourself.

If you wish to sell, or in some way gain profit for, what's created on this site,
it's your responsibility to ensure you have the proper licenses/rights for any
images or resources used.
