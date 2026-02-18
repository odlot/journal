#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Validation failed at line ${LINENO}" >&2' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "index.html"
  "README.md"
  "src/styles.css"
  "src/app.js"
  "src/crypto.js"
  "src/sync.js"
)

for file in "${required_files[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing required file: $file" >&2
    exit 1
  fi
done

node --check src/app.js
node --check src/crypto.js
node --check src/sync.js

grep -Fq 'href="src/styles.css"' index.html
grep -Fq 'src="src/crypto.js"' index.html
grep -Fq 'src="src/sync.js"' index.html
grep -Fq 'src="src/app.js"' index.html

echo "Validation passed."
