#!/usr/bin/env bash
# delivery-status.sh — print git, PR, and live URL status for the final report
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status_file="${1:-$root/.delivery/status.json}"

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

echo ""
echo "== Result Verification Status =="
if [[ ! -f "$status_file" ]]; then
  echo "No .delivery/status.json found."
  echo "Final Result Verification Gate is documented; no run status has been recorded."
else
  node - "$status_file" <<'NODE'
const fs = require('fs');
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rv = status.result_verification || {};
const requirements = Array.isArray(rv.requirements) ? rv.requirements : [];
const counts = requirements.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});
console.log(`Original request contract: ${rv.original_request_contract ? 'present' : 'missing'}`);
console.log(`Requirements: ${requirements.length}`);
for (const key of ['PASS', 'PARTIAL', 'FAIL', 'NOT VERIFIED']) console.log(`${key}: ${counts[key] || 0}`);
console.log(`Repair attempts: ${rv.repair_attempts || 0}`);
console.log(`Merge readiness: ${rv.merge_readiness || 'Not ready'}`);
const blocked = requirements.filter((item) => item.status !== 'PASS');
if (blocked.length) {
  console.log('Not verified items:');
  for (const item of blocked) console.log(`- ${item.status}: ${item.requirement}`);
}
NODE
fi

echo ""
echo "== Spiral Validator-Critic Status =="
if [[ ! -f "$status_file" ]]; then
  echo "No .delivery/status.json found."
else
  node - "$status_file" <<'NODE'
const fs = require('fs');
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const critic = status.spiralValidatorCritic;
if (!critic) {
  console.log('Not recorded.');
  process.exit(0);
}
const requirements = Array.isArray(critic.requirements) ? critic.requirements : [];
const counts = requirements.reduce((acc, item) => {
  acc[item.status] = (acc[item.status] || 0) + 1;
  return acc;
}, {});
console.log(`Loop: ${critic.loopNumber || 'unknown'}`);
console.log(`Verdict: ${critic.verdict || 'unknown'}`);
console.log(`Requirements: ${requirements.length}`);
for (const key of ['PASS', 'IMPROVE', 'PARTIAL', 'FAIL', 'NOT VERIFIED']) console.log(`${key}: ${counts[key] || 0}`);
const plan = Array.isArray(critic.nextImprovementPlan) ? critic.nextImprovementPlan.filter(Boolean) : [];
const risks = Array.isArray(critic.safetyRisks) ? critic.safetyRisks.filter(Boolean) : [];
console.log(`Next improvement steps: ${plan.length}`);
for (const item of plan) console.log(`- ${item}`);
console.log(`Safety risks: ${risks.length}`);
for (const item of risks) console.log(`- ${item}`);
NODE
fi
