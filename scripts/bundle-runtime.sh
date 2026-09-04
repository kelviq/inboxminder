#!/usr/bin/env bash
# Stage the self-contained runtime that ships inside InboxMinder.app
# (plan 053): the official arm64 node binary plus the CLI with its
# production dependencies, slimmed. Output:
#
#   build/runtime/bin/node          pinned official binary, SHA-verified
#   build/runtime/cli/dist/cli.js   tsup output (entry the plist records)
#   build/runtime/cli/node_modules  prod deps, flat (hoisted), no symlinks
#
# Called by build-app.sh when BUNDLE_RUNTIME=1; safe to run standalone.
# Deterministic inputs: pnpm-lock.yaml for the deps, NODE_VERSION below
# for the binary. Bump NODE_VERSION deliberately, with a release.
set -euo pipefail
cd "$(dirname "$0")/.."

NODE_VERSION="22.23.1"
NODE_DIST="node-v${NODE_VERSION}-darwin-arm64"
CACHE_DIR="build/cache"
STAGE="build/runtime"
CLI_STAGE="$STAGE/cli"

rm -rf "$STAGE"
mkdir -p "$STAGE/bin" "$CLI_STAGE" "$CACHE_DIR"

# --- 1. CLI: build, then install prod deps from the frozen lockfile ---
pnpm build >/dev/null

cp package.json pnpm-lock.yaml "$CLI_STAGE/"
# The staging dir is its OWN pnpm workspace (install stops here instead of
# discovering the repo root) with a hoisted node_modules: real files, no
# symlink store — the layout codesign and a .app bundle want.
cp pnpm-workspace.yaml "$CLI_STAGE/"
printf '\nnodeLinker: hoisted\n' >> "$CLI_STAGE/pnpm-workspace.yaml"
(cd "$CLI_STAGE" && pnpm install --prod --frozen-lockfile >/dev/null)
cp -R dist "$CLI_STAGE/dist"

# --- 2. Slim ---
# Type declarations, source maps, and docs are dead weight at runtime.
find "$CLI_STAGE/node_modules" \
  \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' \
     -o -name '*.map' -o -name '*.md' \) -type f -delete
# googleapis ships ~330 API clients; we use exactly one. Its generated
# index statically requires every module (subpaths included), so unused
# API dirs are replaced by same-named stub files rather than deleted.
# The stub satisfies the index's VERSIONS/AUTH_PLUGINS reads; the smoke
# check below fails the build if an upstream layout change breaks this.
python3 - "$CLI_STAGE/node_modules/googleapis/build/src/apis" <<'EOF'
import os, shutil, sys
apis = sys.argv[1]
stub = "exports.VERSIONS = {}; exports.AUTH_PLUGINS = {};\n"
for entry in os.listdir(apis):
    path = os.path.join(apis, entry)
    if entry == "gmail" or not os.path.isdir(path):
        continue
    names = [f for f in os.listdir(path) if f.endswith(".js")]
    shutil.rmtree(path)
    os.mkdir(path)
    for n in names:
        with open(os.path.join(path, n), "w") as f:
            f.write(stub)
EOF
# Non-macOS prebuilt binaries (better-sqlite3 ships every platform).
find "$CLI_STAGE/node_modules" -type f -name '*.node' \
  ! -path '*darwin*' -path '*prebuilds*' -delete
# Housekeeping the installer left behind (not needed to run).
rm -rf "$CLI_STAGE/node_modules/.pnpm" "$CLI_STAGE/node_modules/.bin" \
       "$CLI_STAGE/pnpm-lock.yaml" "$CLI_STAGE/pnpm-workspace.yaml" \
       "$CLI_STAGE/.npmrc" "$CLI_STAGE/node_modules/.modules.yaml"

# --- 3. node binary: download once, verify, cache ---
if [ ! -f "$CACHE_DIR/$NODE_DIST/bin/node" ]; then
  echo "downloading node v$NODE_VERSION (arm64)..."
  curl -fsSL -o "$CACHE_DIR/$NODE_DIST.tar.gz" \
    "https://nodejs.org/dist/v${NODE_VERSION}/${NODE_DIST}.tar.gz"
  curl -fsSL -o "$CACHE_DIR/SHASUMS256-$NODE_VERSION.txt" \
    "https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt"
  (cd "$CACHE_DIR" \
    && grep " ${NODE_DIST}.tar.gz\$" "SHASUMS256-$NODE_VERSION.txt" \
       | shasum -a 256 -c - \
    && tar -xzf "$NODE_DIST.tar.gz" "$NODE_DIST/bin/node" "$NODE_DIST/LICENSE")
fi
cp "$CACHE_DIR/$NODE_DIST/bin/node" "$STAGE/bin/node"
cp "$CACHE_DIR/$NODE_DIST/LICENSE" "$STAGE/NODE_LICENSE"
chmod 755 "$STAGE/bin/node"

# --- 4. Smoke: the staged runtime must run the staged CLI ---
# Sandboxed dirs so this can never touch a live install; --version also
# exercises module resolution through the hoisted tree.
got=$(INBOXMINDER_DATA_DIR="$(mktemp -d)" INBOXMINDER_CONFIG_DIR="$(mktemp -d)" \
  "$STAGE/bin/node" "$CLI_STAGE/dist/cli.js" --version)
want=$(node -p "require('./package.json').version")
if [ "$got" != "$want" ]; then
  echo "bundle smoke failed: staged CLI reports '$got', package.json says '$want'" >&2
  exit 1
fi
# The gmail client must still construct after the API stubbing.
"$STAGE/bin/node" -e "
  const {google} = require(process.cwd() + '/$CLI_STAGE/node_modules/googleapis');
  const g = google.gmail({version: 'v1'});
  if (typeof g.users.messages.get !== 'function') throw new Error('gmail client broken');
"

echo "runtime staged: $STAGE ($(du -sh "$STAGE" | cut -f1), node v$NODE_VERSION, cli v$want)"
