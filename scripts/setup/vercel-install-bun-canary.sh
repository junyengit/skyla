#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BUN_HOME="${BUN_INSTALL:-$HOME/.bun}"
BUN_BIN="$BUN_HOME/bin/bun"

BUN_CANARY_VERSION="1.4.0-canary.1"
BUN_MIRROR_RELEASE="toolchain-bun-1.4.0-canary.1-8f1a9540f"
BUN_LINUX_X64_REVISION="1.4.0-canary.1+8f1a9540f"
BUN_LINUX_X64_SHA256="21cd632ff9a5a1277a0586f0581f85419bf909ba496b18328af0a35cbf065711"
BUN_LINUX_ARM64_REVISION="1.4.0-canary.1+a59a9c37b"
BUN_LINUX_ARM64_SHA256="164a8377a61fc0222ef14da67809add5e59f142b10d7d0ff3daeb11ea59489bd"
BUN_DARWIN_X64_REVISION="1.4.0-canary.1+a59a9c37b"
BUN_DARWIN_X64_SHA256="342e2526dfdb35aecd0bda88c4ff31d9bb04a1b59a9fcea117c54f6f34d2ec26"
BUN_DARWIN_ARM64_REVISION="1.4.0-canary.1+a59a9c37b"
BUN_DARWIN_ARM64_SHA256="a69e4b62ab1dfa395d96cec9e3ac787571a77203c75b06a18216777bcf461b4b"

case "$(uname -s)-$(uname -m)" in
  Linux-x86_64)
    BUN_ASSET="bun-linux-x64"
    BUN_REVISION="$BUN_LINUX_X64_REVISION"
    BUN_SHA256="$BUN_LINUX_X64_SHA256"
    ;;
  Linux-aarch64|Linux-arm64)
    BUN_ASSET="bun-linux-aarch64"
    BUN_REVISION="$BUN_LINUX_ARM64_REVISION"
    BUN_SHA256="$BUN_LINUX_ARM64_SHA256"
    ;;
  Darwin-x86_64)
    BUN_ASSET="bun-darwin-x64"
    BUN_REVISION="$BUN_DARWIN_X64_REVISION"
    BUN_SHA256="$BUN_DARWIN_X64_SHA256"
    ;;
  Darwin-arm64)
    BUN_ASSET="bun-darwin-aarch64"
    BUN_REVISION="$BUN_DARWIN_ARM64_REVISION"
    BUN_SHA256="$BUN_DARWIN_ARM64_SHA256"
    ;;
  *)
    echo "Unsupported Bun canary platform: $(uname -s)-$(uname -m)" >&2
    exit 1
    ;;
esac

TEMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TEMP_DIR"' EXIT
ARCHIVE="$TEMP_DIR/$BUN_ASSET.zip"
DOWNLOAD_URL="https://github.com/junyengit/skyla/releases/download/$BUN_MIRROR_RELEASE/$BUN_ASSET.zip"

curl --proto '=https' --tlsv1.2 --fail --location --silent --show-error \
  --retry 3 --retry-all-errors "$DOWNLOAD_URL" --output "$ARCHIVE"

if command -v sha256sum >/dev/null 2>&1; then
  ACTUAL_SHA256="$(sha256sum "$ARCHIVE" | awk '{print $1}')"
else
  ACTUAL_SHA256="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
fi

if [ "$ACTUAL_SHA256" != "$BUN_SHA256" ]; then
  echo "Bun archive checksum mismatch: expected $BUN_SHA256, received $ACTUAL_SHA256" >&2
  exit 1
fi

unzip -q "$ARCHIVE" -d "$TEMP_DIR/extracted"
CANDIDATE="$TEMP_DIR/extracted/$BUN_ASSET/bun"
[ -x "$CANDIDATE" ]

ACTUAL_REVISION="$("$CANDIDATE" --revision)"
if [ "$ACTUAL_REVISION" != "$BUN_REVISION" ]; then
  echo "Bun revision mismatch: expected $BUN_REVISION, received $ACTUAL_REVISION" >&2
  exit 1
fi

mkdir -p "$(dirname "$BUN_BIN")"
install -m 0755 "$CANDIDATE" "$BUN_BIN"

ACTUAL_REVISION="$("$BUN_BIN" --revision)"
if [ "$ACTUAL_REVISION" != "$BUN_REVISION" ]; then
  echo "Installed Bun revision mismatch: expected $BUN_REVISION, received $ACTUAL_REVISION" >&2
  exit 1
fi

printf 'Using Bun %s (%s)\n' "$BUN_CANARY_VERSION" "$ACTUAL_REVISION"

if [ -n "${GITHUB_PATH:-}" ]; then
  printf '%s\n' "$(dirname "$BUN_BIN")" >> "$GITHUB_PATH"
fi

cd "$ROOT_DIR"
"$BUN_BIN" install --frozen-lockfile
