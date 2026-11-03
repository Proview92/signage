#!/usr/bin/env bash
# Replaces web/vendor/supabase.js with a local, self-contained bundle.
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
( cd "$tmp" && npm init -y >/dev/null && npm i @supabase/supabase-js@2 esbuild@0.23 >/dev/null \
  && echo "export * from '@supabase/supabase-js';" > entry.js \
  && npx esbuild entry.js --bundle --format=esm --minify --target=es2019 --outfile=out.js )
cp "$tmp/out.js" web/vendor/supabase.js
rm -rf "$tmp"
echo "web/vendor/supabase.js is now a local bundle."
