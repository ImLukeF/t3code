#!/bin/bash
# Moves this branch onto the newest T3 Code Nightly, then rebuilds "T3 Code (Luke)".
# Pass --force to rebuild even when already on the newest Nightly.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="T3 Code (Luke)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

notify() {
  osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true
}

cd "$REPO"
if [ -n "$(git status --porcelain)" ]; then
  notify "Update skipped: the t3code checkout has uncommitted changes."
  exit 1
fi

LATEST="$(git ls-remote --tags --refs --sort=-v:refname upstream 'v*-nightly.*' | head -1 | sed 's#.*refs/tags/##')"
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

if ! "$REPO/luke/build.sh"; then
  notify "Building ${LATEST#v} failed. Ask Claude to check ~/.t3-luke-build/update.log."
  exit 1
fi
