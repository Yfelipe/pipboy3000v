#!/usr/bin/env bash
# Bundle (with ../shared) and minify mojave.js into mojave.min.js so it fits in the Pip-Boy's Storage (about 27 KB free
# with the stock firmware installed). Uses esbuild: npx esbuild, or set ESBUILD to a binary.
set -euo pipefail
cd "$(dirname "$0")"
${ESBUILD:-npx --yes esbuild} mojave.js --bundle --format=cjs --banner:js="(function(){" --footer:js="})();" --external:fs --external:Storage --minify --target=es2017 --legal-comments=none --log-level=warning --outfile=mojave.min.js
echo "mojave.min.js: $(wc -c < mojave.min.js) bytes"
# The companion extras, read from the SD card at start (see extras.js)
${ESBUILD:-npx --yes esbuild} extras.js --bundle --format=cjs --banner:js="(function(){" --footer:js="})();" --external:fs --external:Storage --minify --target=es2017 --legal-comments=none --log-level=warning --outfile=sd/USER/MOJAVE.EXT
echo "sd/USER/MOJAVE.EXT: $(wc -c < sd/USER/MOJAVE.EXT) bytes"
