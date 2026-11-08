#!/usr/bin/env bash
# Minify the extensions and the loader into min/ (what the dashboard installs): Storage is shared
# with Pip-OS (about 33 KB left beside it), so every byte counts. The "companion-..." marker
# comment is kept as the first line: the dashboard uses it to recognise the loader.
# Uses esbuild: npx esbuild, or set ESBUILD to a binary.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p min
for f in loader.js remote.js radio.js notes.js inbox.js; do
  mark=$(grep -o -m1 'companion-[a-z]* *[a-z]* *[0-9][0-9]*' "$f" || true)
  { [ -n "$mark" ] && echo "// $mark"; ${ESBUILD:-npx --yes esbuild} "$f" --minify --target=es2017 --legal-comments=none --log-level=warning; } > "min/$f"
  echo "min/$f: $(wc -c < "min/$f") bytes"
done
