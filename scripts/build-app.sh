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
# BUNDLE_RUNTIME=1     — stage node + the CLI into Contents/Resources/runtime
#                        (plan 053: the self-sufficient DMG). Release builds
#                        set this; dev builds skip it and the app falls back
#                        to plist/npm discovery exactly as before.
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
cp app/Support/MenuIcon*.png "$APP/Contents/Resources/" 2>/dev/null || true
# Sparkle.framework rides in the bundle (SwiftPM artifact).
SPARKLE_FRAMEWORK=$(find app/.build -type d -name "Sparkle.framework" -path "*release*" | head -1)
if [ -z "$SPARKLE_FRAMEWORK" ]; then
  SPARKLE_FRAMEWORK=$(find app/.build/artifacts -type d -name "Sparkle.framework" | head -1)
fi
if [ -n "$SPARKLE_FRAMEWORK" ]; then
  mkdir -p "$APP/Contents/Frameworks"
  cp -R "$SPARKLE_FRAMEWORK" "$APP/Contents/Frameworks/"
  # SwiftPM executables carry only @loader_path as rpath; the framework
  # lives in Contents/Frameworks — point dyld there (before signing).
  install_name_tool -add_rpath "@loader_path/../Frameworks"     "$APP/Contents/MacOS/InboxMinderBar"
fi

if [ "${BUNDLE_RUNTIME:-}" = "1" ]; then
  bash scripts/bundle-runtime.sh
  cp -R build/runtime "$APP/Contents/Resources/runtime"
fi

sign_runtime() {
  # Every Mach-O inside the bundled runtime must carry its own signature:
  # the notary service rejects any unsigned nested binary, and --deep
  # never descends into Resources. That is the node binary plus each
  # native module (.node) the CLI ships.
  local identity="$1" opts="$2" rt="$APP/Contents/Resources/runtime"
  [ -d "$rt" ] || return 0
  while IFS= read -r item; do
    echo "signing runtime: $item"
    if [ "$(basename "$item")" = "node" ]; then
      # V8 JITs; hardened runtime needs allow-jit or node dies at start.
      # shellcheck disable=SC2086
      codesign --force $opts \
        --entitlements scripts/node-entitlements.plist \
        -s "$identity" "$item"
    else
      # shellcheck disable=SC2086
      codesign --force $opts -s "$identity" "$item"
    fi
  done < <(find "$rt" -type f \( -name node -o -name '*.node' \) \
      -exec sh -c 'file -b "$1" | grep -q Mach-O' _ {} \; -print)
}

if [ "$SIGN_IDENTITY" = "-" ]; then
  sign_runtime "-" ""
  codesign --force --deep -s - "$APP"
else
  # Inside-out signing with the hardened runtime for notarization.
  # Nested items are FOUND, not hardcoded (Sparkle's layout moves between
  # releases), and failures are loud — a silently unsigned nested binary
  # is exactly what the notary service rejects.
  FW="$APP/Contents/Frameworks/Sparkle.framework"
  if [ -d "$FW" ]; then
    while IFS= read -r item; do
      echo "signing nested: $item"
      codesign --force --options runtime -s "$SIGN_IDENTITY" "$item"
    done < <(find "$FW" -name "*.xpc" -o -name "*.app" -o -name "Autoupdate" -type f)
    codesign --force --options runtime -s "$SIGN_IDENTITY" "$FW"
  fi
  sign_runtime "$SIGN_IDENTITY" "--options runtime"
  codesign --force --options runtime -s "$SIGN_IDENTITY" "$APP"
  codesign --verify --strict "$APP"
fi

echo "Built $APP (identity: $SIGN_IDENTITY)"
echo "Install: make install-app   (copies to /Applications)"
