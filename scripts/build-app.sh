#!/usr/bin/env bash
# Assemble build/InboxMinder.app from the SwiftPM package in app/.
# Build-from-source only: locally built apps carry no quarantine attribute,
# so the ad-hoc signature below is sufficient — no Developer ID, no
# notarization needed for your own build.
set -euo pipefail
cd "$(dirname "$0")/.."

swift build -c release --package-path app

APP=build/InboxMinder.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp app/.build/release/InboxMinderBar "$APP/Contents/MacOS/InboxMinderBar"
cp app/Support/Info.plist "$APP/Contents/Info.plist"
codesign --force -s - "$APP"

echo "Built $APP"
echo "Install: make install-app   (copies to /Applications)"
