#!/bin/bash
# Moves the VPS's T3 Code service to the version of the installed "T3 Code (Luke)".
# Skips (and tries again next run) while any agent run there is queued, running or waiting.
set -euo pipefail

WORK="$HOME/.t3-luke-build"
HOST="ai-vps"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

WANT="$(cat "$WORK/installed-version" 2>/dev/null || true)"
[ -n "$WANT" ] || exit 0

ssh -o ConnectTimeout=15 -o BatchMode=yes "$HOST" bash -s -- "$WANT" <<'REMOTE'
set -euo pipefail
WANT="$1"
CURRENT="$(python3 -c 'import json, sys; print(json.load(open(sys.argv[1]))["activeVersion"])' "$HOME/.t3/runtime/service-state.json")"
[ "$CURRENT" = "$WANT" ] && exit 0
BUSY="$(sqlite3 -readonly "$HOME/.t3/userdata/statev2.sqlite" \
  "select count(*) from orchestration_v2_projection_runs where status in ('queued','preparing','starting','running','waiting')")"
if [ "$BUSY" != "0" ]; then
  echo "$(date '+%F %T') VPS on $CURRENT, $BUSY agent run(s) active; will retry"
  exit 0
fi
echo "$(date '+%F %T') VPS $CURRENT -> $WANT"
"$HOME/.t3/runtime/versions/$CURRENT/t3" update "$WANT" --channel nightly -y
REMOTE
