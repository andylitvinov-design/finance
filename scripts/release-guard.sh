#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f "index.html" || ! -f "config.js" || ! -f "vercel.json" ]]; then
  echo "release-guard: run from the active incoming-ledger repository root." >&2
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

git fetch origin main --quiet

if ! git merge-base --is-ancestor origin/main HEAD; then
  echo "release-guard: this branch is not based on origin/main." >&2
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
