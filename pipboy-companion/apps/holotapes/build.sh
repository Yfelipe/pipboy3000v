#!/usr/bin/env bash
# Minify the holotapes into sd/USER/*.JS (what the dashboard copies to the SD card). The stock
# interface reads the whole file into memory to run it, so smaller is better. The
# "companion-holotape" marker comment is kept as the first line.
# Uses esbuild: npx esbuild, or set ESBUILD to a binary.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p sd/USER
# source file : name in USER/ (8.3, upper case: it is what the APPS menu shows)
for pair in hack.js:HACKING.JS lockpick.js:LOCKPICK.JS caps.js:CAPS.JS fmscan.js:FMSCAN.JS clock.js:CLOCK.JS levelup.js:LEVELUP.JS; do
  f="${pair%%:*}"
  out="sd/USER/${pair##*:}"
  mark=$(grep -o -m1 'companion-holotape *[a-z]* *[0-9][0-9]*' "$f" || true)
  { [ -n "$mark" ] && echo "// $mark"; ${ESBUILD:-npx --yes esbuild} "$f" --minify --target=es2017 --legal-comments=none --log-level=warning; } > "$out"
  echo "$out: $(wc -c < "$out") bytes"
done
