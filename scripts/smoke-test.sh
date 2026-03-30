#!/usr/bin/env bash
set -euo pipefail

echo "=== Smoke testing dist/ ==="

# version command
version=$(node dist/bin/harnex.js version)
if [ -z "$version" ]; then
  echo "FAIL: version command returned empty"
  exit 1
fi
echo "  version: $version"

# help command
help=$(node dist/bin/harnex.js --help)
if ! echo "$help" | grep -q "harnex"; then
  echo "FAIL: help output missing 'harnex'"
  exit 1
fi
echo "  --help: ok"

# init command
tmpdir=$(mktemp -d)
(cd "$tmpdir" && node "$OLDPWD/dist/bin/harnex.js" init > /dev/null)
if [ ! -f "$tmpdir/harnex.yaml" ] || [ ! -f "$tmpdir/criteria/default.yaml" ]; then
  echo "FAIL: init did not create expected files"
  rm -rf "$tmpdir"
  exit 1
fi
rm -rf "$tmpdir"
echo "  init: ok"

echo "=== All smoke tests passed ==="
