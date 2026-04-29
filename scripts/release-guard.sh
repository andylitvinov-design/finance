#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "index.html" || ! -f "config.js" || ! -f "vercel.json" ]]; then
  echo "release-guard: run from the active incoming-ledger repository root." >&2
  exit 1
fi

origin_url="$(git remote get-url origin 2>/dev/null || true)"
if [[ "$origin_url" != "https://github.com/andylitvinov-design/finance.git" ]]; then
  echo "release-guard: origin must point to andylitvinov-design/finance.git." >&2
  exit 1
fi

if [[ -d "reconcile-v2" && "$PWD" == */reconcile-v2 ]]; then
  echo "release-guard: stale reconcile-v2 checkout is not a production source." >&2
  exit 1
fi

if [[ -n "$(git ls-files 'reconcile-v2/*')" ]]; then
  echo "release-guard: this branch reintroduces legacy reconcile-v2 files." >&2
  echo "Port production changes into the repository root on top of origin/main." >&2
  exit 1
fi

base_ref="origin/main"
if git ls-remote --exit-code --heads origin main >/dev/null 2>&1; then
  git fetch origin main --quiet
else
  echo "release-guard: origin/main is required for production releases." >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$base_ref" HEAD; then
  echo "release-guard: this branch is not based on $base_ref." >&2
  echo "Create a fresh branch from origin/main and port the change there." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "release-guard: working tree has uncommitted tracked changes." >&2
  git status --short
  exit 1
fi

if [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "release-guard: working tree has untracked files." >&2
  git status --short --untracked-files=all
  exit 1
fi

node --test tests/*.test.*

echo "release-guard: ok"
