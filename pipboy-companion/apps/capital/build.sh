#!/usr/bin/env bash
# Bundle (with ../shared) and minify capital.js into capital.min.js so it fits in the Pip-Boy's
# Storage beside the stock firmware. Uses esbuild: npx esbuild, or set ESBUILD to a binary.
set -euo pipefail
cd "$(dirname "$0")"
${ESBUILD:-npx --yes esbuild} capital.js --bundle --format=cjs --banner:js="(function(){" --footer:js="})();" --external:fs --external:Storage --minify --target=es2017 --legal-comments=none --log-level=warning --outfile=capital.min.js
echo "capital.min.js: $(wc -c < capital.min.js) bytes"
# The companion extras are Mojave UI's (../mojave/extras.js): the same file under this app's name
${ESBUILD:-npx --yes esbuild} ../mojave/extras.js --bundle --format=cjs --banner:js="(function(){" --footer:js="})();" --external:fs --external:Storage --minify --target=es2017 --legal-comments=none --log-level=warning --outfile=sd/USER/CAPITAL.EXT
echo "sd/USER/CAPITAL.EXT: $(wc -c < sd/USER/CAPITAL.EXT) bytes"
