#!/usr/bin/env bash
set -euo pipefail
trap 'echo "E2E failed at line ${LINENO}" >&2' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required to run Playwright E2E tests." >&2
  exit 1
fi

if [[ ! -f "package.json" ]]; then
  echo "Missing package.json required for Playwright E2E tests." >&2
  exit 1
fi

if [[ ! -d "node_modules/@playwright/test" ]]; then
  npm install --no-fund --no-audit
fi

npm run test:e2e:install
npm run test:e2e
