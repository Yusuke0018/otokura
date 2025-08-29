#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

BRANCH="main"
VERSION="$(date +%Y%m%d%H%M%S)"

# Update cache-busting query param in index.html
if [ -f index.html ]; then
  perl -0777 -i -pe "s/(style\.css\?v=)([0-9A-Za-z_-]*)/\${1}$VERSION/g; s/(main\.js\?v=)([0-9A-Za-z_-]*)/\${1}$VERSION/g" index.html
fi

# Ensure branch
git rev-parse --is-inside-work-tree >/dev/null 2>&1
git branch -M "$BRANCH"

# Configure identity if missing
git config user.name >/dev/null 2>&1 || git config user.name "otokura-bot"
git config user.email >/dev/null 2>&1 || git config user.email "otokura-bot@example.invalid"

git add -A
git commit -m "chore(bootstrap): 音蔵 初期雛形 + 強制キャッシュバスト (v$VERSION)"
git push -u origin "$BRANCH"

echo "Pushed with cache-busted assets: v=$VERSION"

