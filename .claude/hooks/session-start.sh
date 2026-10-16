#!/bin/bash
# A cloud session's container ships a Node below package.json's floor, and
# engine-strict makes `npm ci` refuse it, so nothing runs. This fetches the
# floor itself, checked against nodejs.org's own sums, and puts it first on the
# session's PATH. The floor is read from engines.node, its one home.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || exit 0
cd "$CLAUDE_PROJECT_DIR"

want=$(node -p "require('./package.json').engines.node.replace(/^>=/, '')")
have=$(node -p "process.versions.node")

# sort -V puts the lower first, so the floor first means it is already met.
if [ "$(printf '%s\n%s\n' "$want" "$have" | sort -V | head -n1)" != "$want" ]; then
  dir="/opt/node-v$want-linux-x64"
  if [ ! -x "$dir/bin/node" ]; then
    tar="node-v$want-linux-x64.tar.xz"
    tmp=$(mktemp -d)
    curl -fsSL -o "$tmp/$tar" "https://nodejs.org/dist/v$want/$tar"
    (cd "$tmp" && curl -fsSL "https://nodejs.org/dist/v$want/SHASUMS256.txt" | grep " $tar\$" | sha256sum -c -)
    tar -xJf "$tmp/$tar" -C /opt
    rm -rf "$tmp"
  fi
  export PATH="$dir/bin:$PATH"
  echo "export PATH=\"$dir/bin:\$PATH\"" >> "$CLAUDE_ENV_FILE"
fi

npm ci --no-audit --no-fund
