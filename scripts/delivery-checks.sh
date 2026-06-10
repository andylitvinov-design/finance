#!/usr/bin/env bash
# delivery-checks.sh — run all available local checks before PR/merge
set -euo pipefail

run_if_script_exists() {
  local script_name="$1"
  if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$script_name'] ? 0 : 1)"; then
    echo "== Running npm run $script_name =="
    npm run "$script_name"
  else
    echo "== Skipping $script_name: script not found =="
  fi
}

if [ -f package-lock.json ]; then
  echo "== Checking node_modules =="
  npm ci --prefer-offline 2>/dev/null || npm install
fi

run_if_script_exists build
run_if_script_exists test
run_if_script_exists release-guard

echo ""
echo "== delivery-checks complete =="
