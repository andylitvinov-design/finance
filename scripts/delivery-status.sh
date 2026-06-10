#!/usr/bin/env bash
# delivery-status.sh — print git, PR, and live URL status for the final report
set -euo pipefail

echo "== Delivery Status =="
echo "Date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo ""
echo "== Git status =="
git status --short

echo ""
echo "== Current branch =="
git branch --show-current

echo ""
echo "== Recent commits =="
git log --oneline -n 5

if command -v gh >/dev/null 2>&1; then
  echo ""
  echo "== GitHub PR status =="
  gh pr status || true

  echo ""
  echo "== Current PR view =="
  gh pr view --json url,state,mergeable,baseRefName,headRefName,statusCheckRollup 2>/dev/null || true

  echo ""
  echo "== Current PR checks =="
  gh pr checks 2>/dev/null || true
else
  echo ""
  echo "== GitHub CLI not available =="
fi

LIVE_URL="${LIVE_URL:-https://ezohata-incoming-ledger.vercel.app}"
echo ""
echo "== Live URL HEAD: $LIVE_URL =="
curl -fsSI "$LIVE_URL" || true

echo ""
echo "== /api/status =="
curl -fsS "$LIVE_URL/api/status" 2>/dev/null | head -5 || true
