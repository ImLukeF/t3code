#!/bin/bash
# Moves this branch onto the newest T3 Code Nightly, then rebuilds "T3 Code (Luke)".
# Pass --force to rebuild even when already on the newest Nightly.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="T3 Code (Luke)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

notify() {
  # The app shows its own progress when it runs the update.
  echo "$1" >&2
  [ -z "${T3CODE_LUKE_FROM_APP:-}" ] || return 0
  osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true
}

# One update at a time: the daily job and the app's update button can overlap.
WORK="$HOME/.t3-luke-build"
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

if [ "$LATEST" = "$CURRENT" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

if [ "$LATEST" != "$CURRENT" ]; then
  if ! git rebase "$LATEST"; then
    git rebase --abort
    notify "Nightly ${LATEST#v} clashes with your changes. Ask Claude to fix the luke branch."
    exit 1
  fi
  git push --force-with-lease origin HEAD:luke
fi

# A build of this exact commit is already waiting to install.
if [ "$(cat "$WORK/ready/commit" 2>/dev/null)" = "$(git rev-parse HEAD)" ]; then
  exit 0
fi

if ! "$REPO/luke/build.sh"; then
  notify "Building ${LATEST#v} failed. Ask Claude to check ~/.t3-luke-build/update.log."
  exit 1
fi
