#!/usr/bin/env bash
# Bundle (with ../shared) and minify pip2000.js into pip2000.min.js so it fits in the Pip-Boy's
# Storage beside the stock firmware. Uses esbuild: npx esbuild, or set ESBUILD to a binary.
set -euo pipefail
cd "$(dirname "$0")"
${ESBUILD:-npx --yes esbuild} pip2000.js --bundle --format=cjs --banner:js="(function(){" --footer:js="})();" --external:fs --external:Storage --minify --target=es2017 --legal-comments=none --log-level=warning --outfile=pip2000.min.js
echo "pip2000.min.js: $(wc -c < pip2000.min.js) bytes"
# The companion extras are Mojave UI's (../mojave/extras.js): the same file under this app's name
${ESBUILD:-npx --yes esbuild} ../mojave/extras.js --bundle --format=cjs --banner:js="(function(){" --footer:js="})();" --external:fs --external:Storage --minify --target=es2017 --legal-comments=none --log-level=warning --outfile=sd/USER/PIP2000.EXT
echo "sd/USER/PIP2000.EXT: $(wc -c < sd/USER/PIP2000.EXT) bytes"
