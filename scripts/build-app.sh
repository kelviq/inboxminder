#!/usr/bin/env bash
# Assemble build/InboxMinder.app from the SwiftPM package in app/.
# Two signing paths:
#   default            — ad-hoc signature ("-"): build-from-source needs no
#                        certificate; locally built apps carry no quarantine.
#   SIGN_IDENTITY set  — Developer ID release signing with the hardened
#                        runtime (required for notarization). Used by the
#                        release workflow; needs the cert in the keychain.
# RELEASE_TAG set      — assert Info.plist versions match the tag (vX.Y.Z)
#                        so a release can never ship mismatched versions.
set -euo pipefail
cd "$(dirname "$0")/.."

SIGN_IDENTITY="${SIGN_IDENTITY:--}"

if [ -n "${RELEASE_TAG:-}" ]; then
  want="${RELEASE_TAG#v}"
  have=$(/usr/libexec/PlistBuddy -c 'Print CFBundleShortVersionString' app/Support/Info.plist)
  if [ "$want" != "$have" ]; then
    echo "version mismatch: tag $RELEASE_TAG vs Info.plist $have" >&2
    exit 1
  fi
fi

swift build -c release --package-path app

APP=build/InboxMinder.app
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp app/.build/release/InboxMinderBar "$APP/Contents/MacOS/InboxMinderBar"
cp app/Support/Info.plist "$APP/Contents/Info.plist"
if [ -f app/Support/AppIcon.icns ]; then
  cp app/Support/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
fi
# Sparkle.framework rides in the bundle (SwiftPM artifact).
SPARKLE_FRAMEWORK=$(find app/.build -type d -name "Sparkle.framework" -path "*release*" | head -1)
if [ -z "$SPARKLE_FRAMEWORK" ]; then
  SPARKLE_FRAMEWORK=$(find app/.build/artifacts -type d -name "Sparkle.framework" | head -1)
fi
if [ -n "$SPARKLE_FRAMEWORK" ]; then
  mkdir -p "$APP/Contents/Frameworks"
  cp -R "$SPARKLE_FRAMEWORK" "$APP/Contents/Frameworks/"
fi

if [ "$SIGN_IDENTITY" = "-" ]; then
  codesign --force --deep -s - "$APP"
else
  # Inside-out signing with the hardened runtime for notarization.
  if [ -d "$APP/Contents/Frameworks/Sparkle.framework" ]; then
    codesign --force --options runtime -s "$SIGN_IDENTITY" \
      "$APP/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Downloader.xpc" 2>/dev/null || true
    codesign --force --options runtime -s "$SIGN_IDENTITY" \
      "$APP/Contents/Frameworks/Sparkle.framework/Versions/B/XPCServices/Installer.xpc" 2>/dev/null || true
    codesign --force --options runtime -s "$SIGN_IDENTITY" \
      "$APP/Contents/Frameworks/Sparkle.framework/Versions/B/Autoupdate" 2>/dev/null || true
    codesign --force --options runtime -s "$SIGN_IDENTITY" \
      "$APP/Contents/Frameworks/Sparkle.framework/Versions/B/Updater.app" 2>/dev/null || true
    codesign --force --options runtime -s "$SIGN_IDENTITY" \
      "$APP/Contents/Frameworks/Sparkle.framework"
  fi
  codesign --force --options runtime -s "$SIGN_IDENTITY" "$APP"
  codesign --verify --strict "$APP"
fi

echo "Built $APP (identity: $SIGN_IDENTITY)"
echo "Install: make install-app   (copies to /Applications)"
