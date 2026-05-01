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

project_name="$(node -e 'const fs=require("fs"); const p=JSON.parse(fs.readFileSync(".vercel/project.json","utf8")); process.stdout.write(p.projectName || "");')"
if [[ "$project_name" != "ezohata-incoming-ledger" ]]; then
  echo "release-guard: .vercel/project.json must point to ezohata-incoming-ledger." >&2
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "release-guard: vercel CLI is required for production project/env checks." >&2
  exit 1
fi

env_list="$(vercel env ls production 2>&1)"
if ! grep -Eq '(^|[[:space:]])GOOGLE_SERVICE_ACCOUNT_EMAIL([[:space:]]|$)' <<<"$env_list"; then
  echo "release-guard: Vercel Production env is missing GOOGLE_SERVICE_ACCOUNT_EMAIL." >&2
  exit 1
fi
if ! grep -Eq '(^|[[:space:]])GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY([[:space:]]|$)' <<<"$env_list"; then
  echo "release-guard: Vercel Production env is missing GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY." >&2
  exit 1
fi

project_list="$(vercel project ls 2>&1)"
if ! grep -Eq '(^|[[:space:]])ezohata-incoming-ledger([[:space:]]|$)' <<<"$project_list"; then
  echo "release-guard: Vercel project ezohata-incoming-ledger was not found for the current Vercel account." >&2
  exit 1
fi

alias_status="$(curl -fsS https://ezohata-incoming-ledger.vercel.app/api/status)"
alias_project="$(printf '%s' "$alias_status" | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const j=JSON.parse(s); process.stdout.write(j.vercelProjectName || j.service || ""); });')"
alias_production_url="$(printf '%s' "$alias_status" | node -e 'let s=""; process.stdin.on("data", d => s += d); process.stdin.on("end", () => { const j=JSON.parse(s); process.stdout.write((j.vercel && j.vercel.productionUrl) || ""); });')"
if [[ "$alias_project" != "ezohata-incoming-ledger" ]]; then
  echo "release-guard: production alias does not report project ezohata-incoming-ledger." >&2
  exit 1
fi
if [[ "$alias_production_url" != "ezohata-incoming-ledger.vercel.app" ]]; then
  echo "release-guard: production alias status reports unexpected production URL: ${alias_production_url:-missing}." >&2
  exit 1
fi

node --test tests/*.test.*

if [[ "${RELEASE_GUARD_VERIFY_LIVE:-}" == "1" ]]; then
  expected_sha="$(git rev-parse HEAD)"
  npm run verify:live -- "$expected_sha"
fi

echo "release-guard: ok"
