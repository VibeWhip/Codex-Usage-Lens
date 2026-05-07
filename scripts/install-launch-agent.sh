#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "LaunchAgent install is only supported on macOS." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="${CODEX_USAGE_LENS_LABEL:-com.vibewhip.codex-usage-lens}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
UID_VALUE="$(id -u)"

xml_escape() {
  printf '%s' "$1" \
    | sed -e 's/&/\&amp;/g' \
          -e 's/</\&lt;/g' \
          -e 's/>/\&gt;/g' \
          -e 's/"/\&quot;/g'
}

env_entry() {
  local key="$1"
  local value="${!key:-}"
  if [[ -n "$value" ]]; then
    printf '    <key>%s</key>\n    <string>%s</string>\n' "$key" "$(xml_escape "$value")"
  fi
}

mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/logs"

{
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml_escape "$NODE_BIN")</string>
    <string>$(xml_escape "$ROOT/server.js")</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$ROOT")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml_escape "$ROOT/logs/launchd.out.log")</string>
  <key>StandardErrorPath</key>
  <string>$(xml_escape "$ROOT/logs/launchd.err.log")</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>$(xml_escape "$(dirname "$NODE_BIN"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")</string>
EOF

  env_entry "HOST"
  env_entry "PORT"
  env_entry "CODEX_HOME"
  env_entry "CODEX_USAGE_URL"
  env_entry "HTTPS_PROXY"
  env_entry "https_proxy"
  env_entry "HTTP_PROXY"
  env_entry "http_proxy"
  env_entry "NO_PROXY"
  env_entry "no_proxy"

  cat <<EOF
  </dict>
</dict>
</plist>
EOF
} > "$PLIST"

launchctl bootout "gui/$UID_VALUE" "$PLIST" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID_VALUE" "$PLIST"
launchctl kickstart -k "gui/$UID_VALUE/$LABEL"

echo "Installed $LABEL"
echo "URL: http://127.0.0.1:${PORT:-8787}"
