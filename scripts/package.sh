#!/bin/sh
# Builds dist/fb-member-collector-v<version>.zip to share with the team.
# Teammates unzip it and load the folder in chrome://extensions (Load unpacked).
set -e
cd "$(dirname "$0")/.."

if grep -q "SHEET_WEB_APP_URL: ''" config.js; then
  echo "Warning: SHEET_WEB_APP_URL in config.js is empty; Push to Sheet will not work." >&2
fi

VERSION=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
NAME="fb-member-collector-v$VERSION"
OUT="dist/$NAME"
rm -rf "$OUT" "$OUT.zip"
mkdir -p "$OUT/icons"
cp manifest.json config.js content.js popup.html popup.css popup.js "$OUT/"
cp icons/*.png "$OUT/icons/"
(cd dist && zip -qr "$NAME.zip" "$NAME")
rm -rf "$OUT"
echo "Built dist/$NAME.zip"
