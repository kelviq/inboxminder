#!/usr/bin/env bash
# Package build/InboxMinder.app into build/InboxMinder-<version>.dmg with a
# /Applications symlink. No third-party tooling — hdiutil only.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' build/InboxMinder.app/Contents/Info.plist)
STAGE=build/dmg-stage
DMG="build/InboxMinder-${VERSION}.dmg"
rm -rf "$STAGE" "$DMG"
mkdir -p "$STAGE"
cp -R build/InboxMinder.app "$STAGE/InboxMinder.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname "InboxMinder" -srcfolder "$STAGE" -ov -format UDZO "$DMG" > /dev/null
rm -rf "$STAGE"
echo "$DMG"
