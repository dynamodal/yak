# Testing

Prove as much as possible without a person; real devices check only what a laptop cannot simulate.

## Layers

| Layer | Command | Covers |
| --- | --- | --- |
| Unit and fuzz | `npm test` | Merges (randomized, 2–3 devices, offline edits, deletes), crypto, transports against mocks, reconnect logic, data model, backups, history |
| Types | `npx tsc --noEmit`; `npm run typecheck:worker` | App and Worker |
| Browser suites | `npm run e2e [suite…]` | Isolated profiles as devices, pairing via mock relay or ntfy, every page, offline, real CSP |
| Real devices | Checklist below | Sleep, Wi-Fi change, a restricted network, the real relay |

CI (F-6 in `docs/decisions/app.md`):
- Every non-draft PR and every push to `main`: types, unit tests, build and the browser suites (job `Checks`). Docs-only changes run it too, so the required check always reports. Also by hand (Actions → CI → Run workflow).
- Hosted CI is the record; run suites locally while working.
- Only if Actions is unavailable (F38b):
  - Push the branch, commit everything, then run `scripts/ci-local.sh` from the checkout (needs `gh` logged in with repo access; about 7 minutes with the browser suites).
  - It runs the CI steps plus `npm run e2e` and posts `local-ci/checks` and `local-ci/e2e` commit statuses on HEAD; they show on the PR's Checks list.
  - `--no-e2e` skips the browser suites; `--dry-run` posts nothing.
  - To check someone else's PR, run it in a worktree of the PR head (it refuses a dirty tree or an unpushed commit).
  - The status is only as trustworthy as the machine; a new push needs a new run.

## Browser suites

- `scripts/e2e/<suite>.mjs`; the header comment of each says what it covers.
- `npm run e2e` builds when `dist/` is stale or not a test build (`-- --no-build` skips), serves it with the real `_headers` and a mock relay, runs up to `min(CPUs, 3)` suites at a time (`--jobs <n>` or `E2E_JOBS`; `--jobs 1` for one by one).
- Each suite gets a server on a port the server picks itself (port 0) and a reserved port for the mock ntfy; a start-up `EADDRINUSE` is retried. The `offline` suite rewrites `sw.js`, so it runs on its own copy of `dist/` (`DIST_DIR`).
- A failed suite is run once more. Passing on the retry is reported as **flaky** (`FLAK`, a warning and a row in the job summary); a second failure fails the job. A flake is a bug to fix, not a pass to ignore.
- Every attempt's full output is in `e2e-logs/<suite>.log` (`E2E_LOG_DIR` puts it elsewhere, so parallel copies of one suite keep their own logs; 8–16 copies at once is how load-only flakes are reproduced); CI uploads it as the `e2e-logs` artifact when the job fails.
- Shared helpers: `scripts/e2e/lib.mjs` (launch, page factory that fails on page errors and CSP violations, `check`, `until`).
- `ux-shots` is a dev tool, not a suite: it is left out of the full `npm run e2e` and runs only when named. It screenshots Welcome, every Settings page, the passphrase fields and the share panel at 1280 and 375 px, in the states fresh, one device, two synced devices, keys required and shared. Output goes to `UX_SHOTS_DIR` (default `<tmp>/yak-ux-shots`), never into the repo. The first-run banners are not shown in test pages.
- `?test` in the URL exposes test hooks (`window.__app`, `__backup`, `__history`, `__reports`) only in a test build (`YAK_TEST_BUILD=1`, which `npm run e2e` sets and marks with `dist/.test-build`); a production build ignores `?test`. They name spaces `personal` and `work` (`src/core/test-ids.ts`).
- Chromium: `npx playwright-core install chromium` once, or set `CHROME_PATH`.
- Never run suites against public ntfy.sh; use `scripts/mock-ntfy.mjs`.
- While working, run only the suites you touch; run them all once before the PR.
- Worker: `npx --yes wrangler@4.151.0 dev --port 8787 --ip 127.0.0.1` runs the real relay locally; `node scripts/check-worker.mjs` does that and checks the Origin rule, the room and address limits, the request budget, the kill switch and `/signal/status` (needs `npm run build` first; takes about 2 minutes).

## Performance

A year of use: two spaces with about 2,500 time entries in all, 3,200 notes and tasks, 40 tags, 20 projects (`src/perf/year-data.ts`, fixed seed, no personal data; 4.8 MB of Yjs state).
Numbers from a laptop (Chromium, 2026-10-20); the budgets are about 4× that, so a slower CI runner passes and an accidental O(n²) does not. The unit test takes the best of 7 runs, so a busy machine (parallel tests, a browser suite) does not trip it.

| What | Measured | Budget | Checked by |
| --- | --- | --- | --- |
| First load with the year in IndexedDB (app up, data in memory) | 0.37 s | 3 s | `scripts/perf.mjs` |
| Apply all documents to an empty device (sync catch-up, restore) | 70 ms | 1.5 s | `npm test` (`src/perf`) |
| Timer, Week, Organize: page settles | < 60 ms | 1.5 s | `scripts/perf.mjs` |
| Reports for this year: settle / aggregate | 50 ms / 46 ms | 2.5 s / 300 ms | both |
| Notes page, first open (builds the note index) | 0.3 s | 2.5 s | `scripts/perf.mjs` |
| Notes search, one query | 15 ms | 150 ms | `npm test` |
| Universal search: open the dialog / rank one keystroke / typed-to-results | 0.2 s / 20 ms / 85 ms | 1.5 s / 100 ms / 400 ms | both |
| Typing in a note among 3,200 | 12 ms median, 23 ms worst | 200 ms | `scripts/perf.mjs` |
| Backup snapshot of both spaces (3,244 files) | 0.4 s | 4 s | `npm test` |
| Browser storage for the year (documents + history) | 6 MB, 2 history segments per document | none | `scripts/perf.mjs` |

- `scripts/ci-local.sh` re-runs itself under `nice -n 10` and `ionice -c 3` (when installed) and `npm run e2e` sets its own nice to 10, so test runs do not take over the laptop; `YAK_TEST_NICE=0` turns both off. Lower priority makes timing tests more sensitive to load.
- Unit tests must hold on a busy machine: vitest runs at most 4 workers with a 30 s test timeout (`vite.config.ts`); wait on a deadline or an event, never a poll count; perf budgets use the best of several runs and stretch by load average per CPU when above 1.
- `npm test` runs `src/perf/year.test.ts` and fails when a data-level budget is exceeded. `PERF_REPORT=1 npx vitest run src/perf --silent=false` prints the table; `PERF_SCALE=4` seeds four years to check that cost grows linearly (it did: every number about 3–4× at 4×).
- The browser numbers are not in CI (they need a test build and take a minute): `PERF_FIXTURE=/tmp/year npx vitest run src/perf`, then `YAK_TEST_BUILD=1 npm run build`, then `node scripts/perf.mjs /tmp/year --budget`.
- The slowest thing is the first parse of the notes (front matter, links, tags): about 0.1 ms a note, once per page load, cached per note after that.

## Writing a suite

- New file in `scripts/e2e/`, a header comment saying what it checks, `check(condition, 'what it means')` for each assertion.
- Wait with `until(...)`, never fixed sleeps, except where a test needs time to pass.
- One context per simulated device.

## Real-device checklist

On the deployed build, both laptops on one network, Devices page open on each.

| # | Do | Expect |
| --- | --- | --- |
| 1 | Pair: show the code on one, join on the other | Both "Syncing" within seconds |
| 2 | Add an entry and edit a note on each | Both appear on the other within seconds |
| 3 | Reload one | Syncing again without input |
| 4 | Close a lid for a minute, edit on the other, open it | Reconnects within 30 s of waking, with the edit |
| 5 | Switch Wi-Fi and back, editing on both | Reconnects; edits merged |
| 6 | Close the page on one for a minute, reopen | The other shows "Waiting", then "Syncing" |
| 7 | "Copy report" on both | The log shows each drop's cause and the path used |

Write down anything a network or browser policy blocked, with the step.
