#!/usr/bin/env bash
# Bundle (with ../shared) and minify endurance.js into endurance.min.js so it fits in the Pip-Boy's
# Storage beside the stock firmware. Uses esbuild: npx esbuild, or set ESBUILD to a binary.
set -euo pipefail
cd "$(dirname "$0")"
${ESBUILD:-npx --yes esbuild} endurance.js --bundle --format=cjs --banner:js="(function(){" --footer:js="})();" --external:fs --external:Storage --minify --target=es2017 --legal-comments=none --log-level=warning --outfile=endurance.min.js
echo "endurance.min.js: $(wc -c < endurance.min.js) bytes"
# The companion extras are Mojave UI's (../mojave/extras.js): the same file under this app's name
${ESBUILD:-npx --yes esbuild} ../mojave/extras.js --bundle --format=cjs --banner:js="(function(){" --footer:js="})();" --external:fs --external:Storage --minify --target=es2017 --legal-comments=none --log-level=warning --outfile=sd/USER/ENDURANC.EXT
echo "sd/USER/ENDURANC.EXT: $(wc -c < sd/USER/ENDURANC.EXT) bytes"
