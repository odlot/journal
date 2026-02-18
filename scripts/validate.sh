#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "index.html"
  "README.md"
  "src/styles.css"
  "src/app.js"
  "src/crypto.js"
)

for file in "${required_files[@]}"; do
  test -f "$file"
done

node --check src/app.js
node --check src/crypto.js

grep -q 'href="src/styles.css"' index.html
grep -q 'src="src/crypto.js"' index.html
grep -q 'src="src/app.js"' index.html

echo "Validation passed."
