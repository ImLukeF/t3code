#!/bin/bash
# Moves this branch onto the newest T3 Code Nightly, then rebuilds "T3 Code (Luke)".
# Runs hourly; pass --force to rebuild even when this commit is already built.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="T3 Code (Luke)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

WORK="$HOME/.t3-luke-build"

notify() {
  # This runs hourly, so a problem that hasn't changed is only reported once.
  echo "$1" >&2
  [ "$(cat "$WORK/last-notice" 2>/dev/null)" != "$1" ] || return 0
  echo "$1" > "$WORK/last-notice"
  osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true
}

# One update at a time, in case a run is still going when the next starts.
LOCK="$WORK/update.lock"
mkdir -p "$WORK"
# shlock takes the lock atomically and clears one left by a process that has gone.
until shlock -f "$LOCK" -p $$; do sleep 5; done
trap 'rm -f "$LOCK"' EXIT

cd "$REPO"
if [ -n "$(git status --porcelain)" ]; then
  notify "Update skipped: the t3code checkout has uncommitted changes."
  exit 1
fi

LATEST="$(git ls-remote --tags --refs --sort=-v:refname upstream 'v*-nightly.*' | awk 'NR == 1 { sub(/.*refs\/tags\//, ""); print }')"
[ -n "$LATEST" ] || { notify "Update failed: couldn't read T3 Code's Nightly releases."; exit 1; }
git fetch upstream --no-tags "refs/tags/$LATEST:refs/tags/$LATEST"
CURRENT="$(git describe --tags --match 'v*-nightly.*' --abbrev=0)"

# Don't retry a failure every hour; a fix to the luke branch or a newer Nightly retries it.
FAILED="$(cat "$WORK/failed" 2>/dev/null || true)"

if [ "$LATEST" != "$CURRENT" ]; then
  KEY="rebase $LATEST $(git rev-parse HEAD)"
  [ "$FAILED" != "$KEY" ] || exit 0
  if ! git rebase "$LATEST"; then
    git rebase --abort
    echo "$KEY" > "$WORK/failed"
    notify "Nightly ${LATEST#v} clashes with your changes. Ask Claude to fix the luke branch."
    exit 1
  fi
  git push --force-with-lease origin HEAD:luke
fi

HEAD="$(git rev-parse HEAD)"
# This commit is already installed, or built and waiting to install.
if [ "${1:-}" != "--force" ]; then
  [ "$(cat "$WORK/installed-commit" 2>/dev/null)" != "$HEAD" ] || exit 0
  [ "$(cat "$WORK/ready/commit" 2>/dev/null)" != "$HEAD" ] || exit 0
  [ "$FAILED" != "build $HEAD" ] || exit 0
fi

if ! "$REPO/luke/build.sh"; then
  echo "build $HEAD" > "$WORK/failed"
  notify "Building ${LATEST#v} failed. Ask Claude to check ~/.t3-luke-build/update.log."
  exit 1
fi
rm -f "$WORK/failed" "$WORK/last-notice"
