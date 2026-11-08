#!/usr/bin/env bash
# Build the Espruino WebAssembly firmware for every board in espruino/boards/ into dist/.
#
#   ./build.sh                 # all boards
#   ./build.sh PIPBOY_WASM     # one board
#
# Uses the official Espruino source at the commit in espruino/ESPRUINO_COMMIT, applies
# espruino/patches/*.patch, copies the overlay (boards/, make/, targets/wasm/) on top and
# runs the normal Espruino build (`make BOARD=...`). Needs git, make, python3 and a
# WASI SDK (https://github.com/WebAssembly/wasi-sdk); set WASI_SDK_PATH to use your own.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK="${WORK:-$HERE/.build}"
SRC="$WORK/Espruino"
COMMIT="$(cat "$HERE/espruino/ESPRUINO_COMMIT")"
WASI_SDK_VERSION=25
# Release build (no asserts), as the official firmware and upstream's emulator builds.
# Run with RELEASE= to get Espruino's internal assertions while debugging.
export RELEASE="${RELEASE-1}"

mkdir -p "$WORK" "$HERE/dist"

if [[ -z "${WASI_SDK_PATH:-}" ]]; then
  case "$(uname -s)-$(uname -m)" in
    Linux-x86_64) platform=x86_64-linux ;;
    Linux-aarch64) platform=arm64-linux ;;
    Darwin-arm64) platform=arm64-macos ;;
    Darwin-x86_64) platform=x86_64-macos ;;
    *) echo "No prebuilt WASI SDK for $(uname -sm); set WASI_SDK_PATH" >&2; exit 1 ;;
  esac
  WASI_SDK_PATH="$WORK/wasi-sdk-$WASI_SDK_VERSION.0-$platform"
  if [[ ! -x "$WASI_SDK_PATH/bin/clang" ]]; then
    echo "Downloading WASI SDK $WASI_SDK_VERSION ($platform)"
    curl -fL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-$WASI_SDK_VERSION/wasi-sdk-$WASI_SDK_VERSION.0-$platform.tar.gz" \
      | tar xz -C "$WORK"
  fi
fi

if [[ ! -d "$SRC/.git" ]]; then
  git clone https://github.com/espruino/Espruino.git "$SRC"
fi
# Start from a pristine checkout every time so the patches always apply cleanly
git -C "$SRC" fetch --quiet origin "$COMMIT" 2>/dev/null || true
git -C "$SRC" checkout --quiet --force "$COMMIT"
git -C "$SRC" clean --quiet -fdx -e /bin -e /obj
for patch in "$HERE"/espruino/patches/*.patch; do
  git -C "$SRC" apply "$patch"
done
cp -R "$HERE/espruino/boards" "$HERE/espruino/make" "$HERE/espruino/targets" "$SRC/"
# The Makefile numbers builds from the newest RELEASE_ tag in the repo, which may be newer
# than the pinned commit; name the release this commit descends from so that
# process.env.VERSION matches the official firmware (e.g. 2v24.449)
release_tag="$(git -C "$SRC" describe --tags --abbrev=0 --match 'RELEASE_*' 2>/dev/null || true)"

boards=("$@")
if [[ ${#boards[@]} -eq 0 ]]; then
  for f in "$HERE"/espruino/boards/*.py; do boards+=("$(basename "$f" .py)"); done
fi

for board in "${boards[@]}"; do
  echo "== $board"
  # Object files are shared between boards, so each board starts clean
  make -C "$SRC" clean BOARD="$board" WASI_SDK_PATH="$WASI_SDK_PATH" >/dev/null
  log="$WORK/$board.log"
  if ! make -C "$SRC" -j"$(getconf _NPROCESSORS_ONLN)" BOARD="$board" WASI_SDK_PATH="$WASI_SDK_PATH" \
       ${release_tag:+LATEST_RELEASE="$release_tag"} >"$log" 2>&1; then
    grep -E "error" "$log" | grep -v WRAPPERSOURCES >&2 || tail -20 "$log" >&2
    echo "Build of $board failed (full log: $log)" >&2
    exit 1
  fi
  binary="$(cd "$SRC" && python3 scripts/get_board_info.py "$board" 'common.get_board_binary_name(board)')"
  cp "$SRC/bin/$binary" "$HERE/dist/$binary"
  echo "   dist/$binary ($(wc -c < "$HERE/dist/$binary") bytes)"
done
