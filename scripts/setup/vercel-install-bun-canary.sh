#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUN_HOME="${BUN_INSTALL:-$HOME/.bun}"
BUN_BIN="$BUN_HOME/bin/bun"

if [ ! -x "$BUN_BIN" ]; then
  curl -fsSL https://bun.com/install | bash
fi

"$BUN_BIN" upgrade --canary
"$BUN_BIN" --revision

cd "$ROOT_DIR"
"$BUN_BIN" install --frozen-lockfile
