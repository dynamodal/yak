#!/usr/bin/env bash
# Run the CI checks locally and post the result as commit statuses on HEAD (decision F38b).
#   scripts/ci-local.sh             checks + browser suites; posts local-ci/checks and local-ci/e2e
#   scripts/ci-local.sh --no-e2e    checks only; posts local-ci/checks
#   scripts/ci-local.sh --dry-run   run everything, post nothing
# Needs a clean working tree and a HEAD that is pushed, and `gh` logged in with repo access.
# The status is only as trustworthy as this machine.
set -uo pipefail
cd "$(dirname "$0")/.."

# Low priority, so the run does not take over the machine; npm, vitest and the browsers inherit it.
# YAK_TEST_NICE=0 turns it off. Without nice/ionice the script runs as it is.
if [[ -z "${YAK_NICED:-}" && "${YAK_TEST_NICE:-}" != 0 ]]; then
  lower=()
  command -v nice >/dev/null && lower+=(nice -n 10)
  command -v ionice >/dev/null && lower+=(ionice -c 3)
  if [[ ${#lower[@]} -gt 0 ]]; then exec env YAK_NICED=1 "${lower[@]}" "$0" "$@"; fi
fi

e2e=1 dry=0
for arg in "$@"; do
  case "$arg" in
    --no-e2e) e2e=0 ;;
    --dry-run) dry=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean; the status would describe a commit you did not test. Commit or stash first." >&2
  exit 1
fi
sha=$(git rev-parse HEAD)
repo=""
if [[ $dry -eq 0 ]]; then
  repo=$(gh repo view --json nameWithOwner -q .nameWithOwner) || exit 1
  if ! gh api "repos/${repo}/commits/${sha}" --silent 2>/dev/null; then
    echo "Commit ${sha:0:7} is not on GitHub; push the branch first." >&2
    exit 1
  fi
fi

post() { # context state description
  if [[ $dry -eq 1 ]]; then echo "[dry-run] $1 $2: $3"; return 0; fi
  gh api "repos/${repo}/statuses/${sha}" --silent -f context="$1" -f state="$2" -f description="$3" \
    || echo "Could not post status $1" >&2
}

run() { echo; echo "==> $*"; "$@"; }

post local-ci/checks pending "running"

build_flag=; [[ $e2e -eq 1 ]] && build_flag=1
start=$SECONDS
if run npm ci && run npm run typecheck && run npm run typecheck:worker && run npm test && run env YAK_TEST_BUILD="$build_flag" npm run build:ci && run npm run check:bundle && run npm run check:prod-bundle; then
  post local-ci/checks success "passed in $((SECONDS - start))s"
else
  post local-ci/checks failure "failed after $((SECONDS - start))s"
  exit 1
fi

if [[ $e2e -eq 1 ]]; then
  post local-ci/e2e pending "running"
  start=$SECONDS
  if run npm run e2e -- --no-build; then
    post local-ci/e2e success "passed in $((SECONDS - start))s"
  else
    post local-ci/e2e failure "failed after $((SECONDS - start))s"
    exit 1
  fi
fi
echo; echo "All local CI steps passed for ${sha:0:7}."
