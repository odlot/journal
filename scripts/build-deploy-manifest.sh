#!/usr/bin/env bash
set -euo pipefail
trap 'echo "Artifact manifest generation failed at line ${LINENO}" >&2' ERR

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

OUTPUT_PATH="${1:-}"

if command -v sha256sum >/dev/null 2>&1; then
  HASH_CMD=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  HASH_CMD=(shasum -a 256)
else
  echo "Neither sha256sum nor shasum is available." >&2
  exit 1
fi

DEPLOY_FILES=()
while IFS= read -r file; do
  if [[ -n "$file" ]]; then
    DEPLOY_FILES+=("$file")
  fi
done < <(
  {
    printf '%s\n' "index.html"
    find src -type f | sort
  } | awk 'NF'
)

if [[ "${#DEPLOY_FILES[@]}" -eq 0 ]]; then
  echo "No deployment files found for manifest generation." >&2
  exit 1
fi

for file in "${DEPLOY_FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Missing deployment file: $file" >&2
    exit 1
  fi
done

write_manifest() {
  printf '%s\n' "# journal deploy artifact manifest"
  printf '%s\n' "# format: sha256 size_bytes path"

  for file in "${DEPLOY_FILES[@]}"; do
    hash="$("${HASH_CMD[@]}" "$file" | awk '{print $1}')"
    size_bytes="$(wc -c < "$file" | tr -d '[:space:]')"
    printf '%s %s %s\n' "$hash" "$size_bytes" "$file"
  done
}

if [[ -n "$OUTPUT_PATH" ]]; then
  write_manifest > "$OUTPUT_PATH"
else
  write_manifest
fi
