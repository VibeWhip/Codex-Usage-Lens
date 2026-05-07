#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "LaunchAgent uninstall is only supported on macOS." >&2
  exit 1
fi

LABEL="${CODEX_USAGE_LENS_LABEL:-com.vibewhip.codex-usage-lens}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
UID_VALUE="$(id -u)"

launchctl bootout "gui/$UID_VALUE" "$PLIST" >/dev/null 2>&1 || true
rm -f "$PLIST"

echo "Uninstalled $LABEL"
