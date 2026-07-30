#!/usr/bin/env bash
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROCESS_PATTERN="/Applications/T3 Code"

cd "$REPO"
pnpm run dist:desktop:dmg:arm64

quit_t3() {
  osascript -e 'tell application id "com.t3tools.t3code" to quit' >/dev/null 2>&1 || true
  for _ in $(seq 1 40); do
    pgrep -f "$PROCESS_PATTERN" >/dev/null || return 0
    sleep 0.5
  done

  echo "[reload] graceful quit timed out; terminating"
  pkill -f "$PROCESS_PATTERN" || true
  for _ in $(seq 1 20); do
    pgrep -f "$PROCESS_PATTERN" >/dev/null || return 0
    sleep 0.5
  done

  pkill -9 -f "$PROCESS_PATTERN" || true
  sleep 1
}

quit_t3
if pgrep -f "$PROCESS_PATTERN" >/dev/null; then
  echo "[reload] ERROR: T3 Code is still running"
  exit 1
fi

DMG="$(ls -t "$REPO"/release/T3-Code-*-arm64.dmg | head -1)"
echo "[reload] installing $(basename "$DMG")"
MOUNT_POINT="$(hdiutil attach "$DMG" -nobrowse -readonly | tail -1 | cut -f3-)"
trap 'hdiutil detach "$MOUNT_POINT" -quiet >/dev/null 2>&1 || true' EXIT

APP="$(ls -d "$MOUNT_POINT"/*.app | head -1)"
NAME="$(basename "$APP")"
if [[ "$NAME" != *.app ]]; then
  echo "[reload] ERROR: mounted image did not contain an app bundle"
  exit 1
fi

rm -rf "/Applications/$NAME"
ditto "$APP" "/Applications/$NAME"
hdiutil detach "$MOUNT_POINT" -quiet
trap - EXIT

xattr -dr com.apple.quarantine "/Applications/$NAME" 2>/dev/null || true
open "/Applications/$NAME"
echo "[reload] $NAME installed and opened"
