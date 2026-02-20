#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Validation failed at line ${LINENO}" >&2' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

required_files=(
  "index.html"
  "README.md"
  "package.json"
  "playwright.config.js"
  "src/styles.css"
  "src/app.js"
  "src/crypto.js"
  "src/sync.js"
  "scripts/run-playwright-e2e.js"
  "scripts/test-e2e.sh"
  "tests/helpers/browser-module.js"
  "tests/crypto.test.js"
  "tests/sync.test.js"
  "tests/e2e/sync-retry-recovery.spec.js"
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
node --check scripts/run-playwright-e2e.js
node --check playwright.config.js
node --check tests/e2e/sync-retry-recovery.spec.js
node --test tests/crypto.test.js tests/sync.test.js
if [[ "${VALIDATE_SKIP_E2E:-0}" != "1" ]]; then
  ./scripts/test-e2e.sh
fi

grep -Fq 'href="src/styles.css"' index.html
grep -Fq 'src="src/crypto.js"' index.html
grep -Fq 'src="src/sync.js"' index.html
grep -Fq 'src="src/app.js"' index.html
grep -Fq 'id="wipe-local-data-btn"' index.html
grep -Fq 'id="wipe-local-data-status"' index.html

echo "Validation passed."
