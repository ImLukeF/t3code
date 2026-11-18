#!/bin/bash
# Installs a built "T3 Code (Luke)" from ~/.t3-luke-build/ready once the app isn't running.
set -euo pipefail

WORK="$HOME/.t3-luke-build"
APP_NAME="T3 Code (Luke)"
READY="$WORK/ready/$APP_NAME.app"
TARGET="/Applications/$APP_NAME.app"

# Keeps the VPS on the installed version; it waits there while agents run.
"$(dirname "$0")/vps-update.sh" >>"$WORK/vps-update.log" 2>&1 || true

[ -d "$READY" ] || exit 0

notify() {
  osascript -e "display notification \"$1\" with title \"$APP_NAME\"" >/dev/null 2>&1 || true
}

if ps -axo command= | awk -v p="$TARGET/Contents/MacOS/" 'index($0, p) == 1 { found = 1 } END { exit !found }'; then
  if [ ! -f "$WORK/ready/notified" ]; then
    notify "Update $(cat "$WORK/ready/version") is ready. Quit the app to install it."
    touch "$WORK/ready/notified"
  fi
  exit 0
fi

rm -rf "$TARGET.old"
[ -d "$TARGET" ] && mv "$TARGET" "$TARGET.old"
mv "$READY" "$TARGET"
rm -rf "$TARGET.old"
cp "$WORK/ready/commit" "$WORK/installed-commit"
cp "$WORK/ready/version" "$WORK/installed-version"
notify "Updated to $(cat "$WORK/ready/version")."
rm -rf "$WORK/ready"
