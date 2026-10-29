# Yak

Yak ("Your Activity Keeper"), hosted at https://yak.dynamodal.com.

A local-first, browser-only time tracker with Markdown notes and tasks. No install, no server; optional peer-to-peer sync between your own devices.

## Try it

- Open https://yak.dynamodal.com in Chrome or Edge on a computer (Safari, iPhone and Firefox work with fewer features: [browsers](docs/user/browsers.md)).
- Nothing to install and no account. Your data stays in your browser; turn on folder backups early ([backups](docs/user/backups.md)).
- Pair a second device of your own for sync ([devices](docs/user/devices.md)). A tiny relay only introduces your devices; it never sees your data ([privacy](docs/user/privacy.md)).
- Status: alpha. Report problems from Help › Report a problem, or by email to yak@dynamodal.com.

## Learn more

- Why and what: [docs/goals.md](docs/goals.md)
- How it is built: [docs/architecture.md](docs/architecture.md), [docs/sync.md](docs/sync.md)
- What is next: [docs/roadmap.md](docs/roadmap.md) and the GitHub issues
- User guide (also in the app under Settings › Help): [docs/user/](docs/user/); references: [backups](docs/backups.md), [Toggl import](docs/import.md), [offline](docs/offline.md)

## Licence

Apache-2.0, see [LICENSE](LICENSE). Third-party licences are listed in the app (Help › Open source) and in `dist/THIRD-PARTY-LICENSES.txt` after a build.

## Development

```
npm install
npm run dev        # local dev server
npm test           # unit tests
npm run build      # typecheck + static output in dist/
npm run e2e        # browser suites (docs/testing.md)
```

- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).
- Pages: `/` the app; `/probe` a capability probe (prompting checks run only on a button press).
- Deploy: one Cloudflare Worker serves `dist/` and the `/signal` relay (`wrangler.jsonc`).

## Deploy your own

- Needs a Cloudflare account and `npx wrangler login`.
- In `wrangler.jsonc`, change `name` and the `routes` pattern to a domain in your account.
- In `public/_headers`, change the `wss://` host in `connect-src` to the same domain.
- `npm run build && npx wrangler deploy`.
- The Obsidian plugin's default relay (`DEFAULT_RELAY` in `obsidian/src/main.ts`) is a setting; point it at your host.
