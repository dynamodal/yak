# Contributing to Yak

Thanks for helping. Yak is a small project; the aim is a few well-understood parts, not many features.

## Before you start

- Open an issue first for anything bigger than a typo or small fix, and wait for a yes.
- Only collaborators can open pull requests; if you are not one, start with an issue.
- Read [docs/goals.md](docs/goals.md): principles, constraints and rejected ideas.
- Read [docs/architecture.md](docs/architecture.md) for the code layout.

## Rules that decide most reviews

- Every feature works with sync off.
- Shared state lives in Yjs; no hand-written merge or sync logic.
- Records get fresh UUIDs; deletes are soft.
- Feature modules talk only through `src/core` and `src/app`, never to each other.
- No remote code at runtime, few well-known dependencies, no user scripts.
- Feature-detect browser capabilities and degrade gracefully.
- No secrets, tokens or personal data in code, issues or pull requests.
- A change to stored data ships with a migration.

## Workflow

- One issue, one branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`), one pull request.
- Run `npm test`, `npx tsc --noEmit`, and the browser suites you touch (`npm run e2e <suite>`, see [docs/testing.md](docs/testing.md)).
- The PR says what changed, how you tested it, and any browser-API assumptions.
- A design decision gets one row in the matching `docs/decisions/*.md`.
- A change users will notice gets a line in `docs/user/changes.md`.
- Docs are short: bullets and tables, what and why, no history.

## Security

Report vulnerabilities by email to yak@dynamodal.com, not in a public issue.
