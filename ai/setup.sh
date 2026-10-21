#!/usr/bin/env bash
# Sets up Red's brain for local development: a pinned Foul Play checkout, a
# Python venv, and poke-engine built for Gen 3. Needs python3.11+, git, curl
# and a Rust toolchain. The Dockerfile does the same steps.
set -euo pipefail
cd "$(dirname "$0")"

FOULPLAY_REF=8f541f80f91f960603673796559f796b10ccf0fb
POKE_ENGINE=0.0.48

if [ ! -d foul-play ]; then
  git clone https://github.com/pmariglia/foul-play foul-play
fi
git -C foul-play checkout --quiet "$FOULPLAY_REF"

python3 -m venv venv
venv/bin/pip install --quiet -r requirements.txt
venv/bin/pip install --quiet --no-cache-dir "poke-engine==$POKE_ENGINE" \
  --config-settings="build-args=--features poke-engine/gen3 --no-default-features"

# Foul Play caches set data forever, even an empty failed download.
cache=foul-play/fp/data/pkmn_sets_cache/gen3randombattle.json
mkdir -p "$(dirname "$cache")"
curl -fsS https://pkmn.github.io/randbats/data/full/gen3randombattle.json -o "$cache"
test "$(wc -c < "$cache")" -gt 1000

echo "ok: run with venv/bin/python redbot.py"
