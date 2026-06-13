#!/usr/bin/env bash
# delivery-checks.sh — run all available local checks before PR/merge
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status_file="${1:-$root/.delivery/status.json}"

run_if_script_exists() {
  local script_name="$1"
  if [ -f package.json ] && node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts['$script_name'] ? 0 : 1)"; then
    echo "== Running npm run $script_name =="
    npm run "$script_name"
  else
    echo "== Skipping $script_name: script not found =="
  fi
}

echo "== Checking Final Result Verification Gate docs =="
rg -q "FINAL RESULT VERIFICATION GATE" "$root/.claude/commands/delivery.md"
rg -q "Original Request Contract" "$root/.claude/commands/delivery.md"
rg -q "PASS.*PARTIAL.*FAIL.*NOT VERIFIED|PARTIAL.*FAIL.*NOT VERIFIED" "$root/.claude/commands/delivery.md"
rg -q "Implementation is not completion" "$root/docs/delivery-loop-program.md"

if [[ -f "$status_file" ]]; then
  echo "== Validating result_verification status =="
  node - "$status_file" <<'NODE'
const fs = require('fs');
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rv = status.result_verification;
if (!rv || !Array.isArray(rv.requirements)) throw new Error('result_verification.requirements must be present');
const allowed = new Set(['PASS', 'PARTIAL', 'FAIL', 'NOT VERIFIED']);
const notPass = [];
for (const [index, item] of rv.requirements.entries()) {
  if (!item.requirement) throw new Error(`requirement ${index + 1} is missing requirement`);
  if (!allowed.has(item.status)) throw new Error(`requirement ${index + 1} has invalid status`);
  if (!item.evidence) throw new Error(`requirement ${index + 1} is missing evidence`);
  if (!item.verification_method) throw new Error(`requirement ${index + 1} is missing verification_method`);
  if (item.status !== 'PASS') notPass.push(item.requirement);
}
if (notPass.length && rv.merge_readiness === 'Ready') {
  throw new Error('merge_readiness cannot be Ready when requirements are not PASS');
}
if (Number(rv.repair_attempts || 0) > 2) throw new Error('repair_attempts cannot exceed 2');
NODE
fi

if [ -f package-lock.json ]; then
  echo "== Checking node_modules =="
  npm ci --prefer-offline 2>/dev/null || npm install
fi

run_if_script_exists build
run_if_script_exists test
run_if_script_exists release-guard

echo ""
echo "== delivery-checks complete =="
