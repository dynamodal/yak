# CLAUDE.md: Yak

Browser-only, local-first time tracker (Toggl replacement) with Markdown notes and tasks, and optional peer-to-peer sync between your own devices.
Static site on a Cloudflare Worker (`yak.dynamodal.com`); no backend besides the signaling relay.

## Start of every session

1. Read this file and `docs/roadmap.md`.
2. Work comes from a GitHub issue: `gh issue view <n>`. Read the design note it links, if any.
3. Read `docs/architecture.md` for how the code is laid out; read `docs/decisions/<area>.md` only for the area you change.
4. `docs/goals.md` holds the principles, constraints and rejected ideas. Check it before proposing something new.
5. A past chat the owner refers to ("we discussed…"): use the `past-conversations` skill.

Never list all issues; filter: `gh issue list --label <area> --json number,title,labels`.
Issue and PR numbers here and in `docs/` refer to `dynamodal/yak`; numbers and decision ids before the cut-over (2026-10-27) refer to the old private repo (see decision F-201).

## Hard rules

- Every feature works with sync off.
- Yjs for all shared state; never hand-roll merge or sync logic.
- Records keyed by fresh UUIDs; deletes are soft. Toggl API v9 field names.
- Modules talk only through `src/core` (documents, event bus) and `src/app`; never import another feature module.
- No CDN or remote code at runtime; few, well-known dependencies; no user scripts.
- No secrets, tokens or personal data in the repo, issues or PRs.
- Before creating or commenting on an issue or PR, check whether it contains personal or revealing information, directly or indirectly: client, employer or project names, note titles, task or time-entry text, device names, hostnames, emails, screenshots of real data, usage numbers tied to a person. Generalize it (e.g. "a long project name", "3 devices"), or ask the owner to reframe or confirm it is fine to share. Never attach raw screenshots; describe them or redraw with placeholder data.
- Feature-detect every browser capability and degrade gracefully.
- App name behind `APP_NAME`; generic storage names.
- Alpha testers keep their data: a change to stored data ships with a migration, never "reset your devices" (decision F39).

## Workflow

- One issue, one session, one branch (`feat/…`, `fix/…`, `docs/…`, `chore/…`) from up-to-date `main`, one PR. Never commit to `main`.
- Write `Closes #<n>` only when the PR finishes the whole issue. A PR that delivers one slice says `Refs #<n>` and names what is left; the issue stays open.
- The PR description says `Closes #<n>` (or `Refs #<n>`), what changed, how it was tested, and browser-API assumptions. It is the status; do not write status into docs.
- A decision made in an issue, a PR or a chat: add one row at the end of the matching `docs/decisions/*.md` in the same PR. Id: the file's prefix plus the issue number (`F-195`; `F-195b` for a second one), so parallel PRs never pick the same id.
- A change to what is collected or logged (debug log, relay, metrics, reports) updates `docs/user/privacy.md` in the same PR.
- A change testers will notice (and any stored-data migration, F39) adds a new file `docs/user/changes/YYYY-MM-DD-HHMM-<slug>.md` (UTC time of writing) in the same PR, with `## YYYY-MM-DD: title` and short bullets. Never edit another entry: parallel PRs must not touch the same file. A new date or title makes the dot on Settings appear. `docs/user/changes.md` is the archive of older entries.
- Do not edit shared summaries in feature PRs: no check counts, no "current state". Update `docs/roadmap.md` only when a milestone changes.
- Design notes for unbuilt work live in `docs/design/`. When the work ships, move what stays true into `architecture.md` or `decisions/` and delete the note.
- Tests: `npm test`, `npx tsc --noEmit`, and `npm run e2e <suite>` for the suites you touch while working; hosted CI runs the full browser suites on the PR. Never loop tests against public ntfy.sh.
- Hosted CI runs everything, browser suites included, on every non-draft PR (F-6). Only if Actions is unavailable: push, then `scripts/ci-local.sh` posts `local-ci/checks` and `local-ci/e2e` statuses on HEAD; the PR cites them (`docs/testing.md`).
- Remove your worktree when the PR merges.

## Writing

- Short and skimmable: bullets, tables, fragments. One sentence per line in prose.
- Record what matters and why; leave out narrative, history and anything git already holds.
