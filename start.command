#!/bin/bash
# Garchomple — double-click to play locally on macOS.
# Links your ROM and save from the Desktop into ./local (nothing is copied or modified),
# starts a tiny local web server, and opens the game in your browser.
cd "$(dirname "$0")"
mkdir -p local
# unpack the dex and sprites shipped as one archive (refreshed whenever assets.zip changes)
if [ -f assets.zip ] && { [ ! -f data/dex/.stamp ] || [ assets.zip -nt data/dex/.stamp ]; }; then
  unzip -oq assets.zip && touch data/dex/.stamp && echo "Unpacked dex and sprites"
fi
# files from the first version that are no longer used (pre-built teams)
rm -rf data/teams data/pokedex_gen5.json tools/generate_teams.py 2>/dev/null

# your ROM/save can sit in this folder or next to it (on the Desktop)
ROM=$(ls ./Pokemon_White2.nds ./*hite*2*.nds ./*lack*2*.nds ../Pokemon_White2.nds ../*hite*2*.nds ../*lack*2*.nds 2>/dev/null | grep -vi moon | head -1)
SAV=$(ls ./Pokemon_White2.sav ./*hite*2*.sav ../Pokemon_White2.sav ../*hite*2*.sav ../*lack*2*.sav 2>/dev/null | head -1)

# (re)link the ROM if the link is missing or broken (e.g. after moving the ROM)
if [ -n "$ROM" ] && [ ! -e local/rom.nds ]; then
  ln -sfn "$(cd "$(dirname "$ROM")" && pwd)/$(basename "$ROM")" local/rom.nds && echo "Linked ROM: $ROM"
fi
# The save is copied (not linked) so the original can never be touched by the game.
# (Without one, the save bundled with the site, data/base.sav, is used.)
if [ ! -e local/base.sav ] && [ -n "$SAV" ]; then cp "$SAV" local/base.sav && echo "Copied save: $SAV"; fi

[ -e local/rom.nds ] || echo "No ROM found next to this folder; you can add one in the browser instead."
[ -e local/base.sav ] || echo "Using the postgame save bundled with the site (data/base.sav)."

PORT=8137
# open the browser only once the server answers (opening earlier can show a cached page whose data requests fail)
( for i in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.2; done; open "http://localhost:$PORT" ) &
exec python3 tools/serve.py $PORT
