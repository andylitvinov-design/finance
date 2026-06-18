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
rg -qi "FINAL RESULT VERIFICATION GATE" "$root/.claude/commands/delivery.md"
rg -q "Original Request Contract" "$root/.claude/commands/delivery.md"
rg -q "PASS.*PARTIAL.*FAIL.*NOT VERIFIED|PARTIAL.*FAIL.*NOT VERIFIED" "$root/.claude/commands/delivery.md"
rg -q "Implementation is not completion" "$root/docs/delivery-loop-program.md"
rg -q "SUCCESS_WITH_AUTH_LIMITATION" "$root/docs/delivery-auth-boundary-standard.md"
rg -q "Spiral Validator-Critic Loop" "$root/.claude/commands/delivery.md"
rg -q "spiralValidatorCritic" "$root/docs/delivery-loop-technical-details.md"

if [[ -f "$status_file" ]]; then
  echo "== Validating result_verification status =="
  node - "$status_file" <<'NODE'
const fs = require('fs');
const status = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const rv = status.result_verification;

const finalStatuses = new Set(['SUCCESS', 'SUCCESS_WITH_AUTH_LIMITATION', 'BLOCKED']);
if (status.status && !finalStatuses.has(status.status)) {
  throw new Error('status must be SUCCESS, SUCCESS_WITH_AUTH_LIMITATION, or BLOCKED');
}
const liveVerification = status.liveVerification || {};
const modes = new Set(['PUBLIC_LIVE', 'PREVIEW_DEPLOYMENT', 'LOCAL_AUTH_SIMULATION', 'AUTH_BOUNDARY', 'OWNER_REQUIRED']);
const authBoundaries = new Set(['NONE', 'GOOGLE_OAUTH_EXPECTED', 'SUPABASE_AUTH_EXPECTED', 'PRIVATE_CABINET_EXPECTED', 'OWNER_SESSION_REQUIRED']);
const postLoginStatuses = new Set(['VERIFIED', 'SKIPPED_EXPECTED_AUTH_BOUNDARY', 'OWNER_REQUIRED', 'NOT_APPLICABLE']);
if (liveVerification.mode && !modes.has(liveVerification.mode)) throw new Error('liveVerification.mode is invalid');
if (liveVerification.authBoundary && !authBoundaries.has(liveVerification.authBoundary)) throw new Error('liveVerification.authBoundary is invalid');
if (liveVerification.postLoginStatus && !postLoginStatuses.has(liveVerification.postLoginStatus)) throw new Error('liveVerification.postLoginStatus is invalid');
if (status.status === 'SUCCESS_WITH_AUTH_LIMITATION') {
  if (liveVerification.postLoginStatus !== 'SKIPPED_EXPECTED_AUTH_BOUNDARY' && liveVerification.postLoginStatus !== 'OWNER_REQUIRED') {
    throw new Error('SUCCESS_WITH_AUTH_LIMITATION requires expected auth-boundary postLoginStatus');
  }
  if (!liveVerification.authBoundary || liveVerification.authBoundary === 'NONE') {
    throw new Error('SUCCESS_WITH_AUTH_LIMITATION requires a non-NONE authBoundary');
  }
}
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

const critic = status.spiralValidatorCritic;
if (critic !== undefined) {
  const verdicts = new Set([
    'READY_FOR_MERGE',
    'READY_WITH_NOTES',
    'IMPROVE',
    'IMPROVE_MINOR',
    'SAFETY_STOP',
    'NEEDS_HUMAN_DECISION',
  ]);
  const criticStatuses = new Set(['PASS', 'IMPROVE', 'PARTIAL', 'FAIL', 'NOT VERIFIED']);
  if (!Number.isInteger(critic.loopNumber) || critic.loopNumber < 1 || critic.loopNumber > 3) {
    throw new Error('spiralValidatorCritic.loopNumber must be 1, 2, or 3');
  }
  if (!verdicts.has(critic.verdict)) throw new Error('spiralValidatorCritic.verdict is invalid');
  if (!Array.isArray(critic.requirements) || critic.requirements.length === 0) {
    throw new Error('spiralValidatorCritic.requirements must be a non-empty array');
  }
  const criticNotPass = [];
  for (const [index, item] of critic.requirements.entries()) {
    if (!item.requirement) throw new Error(`critic requirement ${index + 1} is missing requirement`);
    if (!criticStatuses.has(item.status)) throw new Error(`critic requirement ${index + 1} has invalid status`);
    if (!item.evidence) throw new Error(`critic requirement ${index + 1} is missing evidence`);
    if (!item.nextAction) throw new Error(`critic requirement ${index + 1} is missing nextAction`);
    if (item.status !== 'PASS') criticNotPass.push(item.requirement);
  }
  const nextPlan = Array.isArray(critic.nextImprovementPlan) ? critic.nextImprovementPlan.filter(Boolean) : [];
  const safetyRisks = Array.isArray(critic.safetyRisks) ? critic.safetyRisks.filter(Boolean) : [];
  const documentedGaps = [
    ...(Array.isArray(critic.notVerified) ? critic.notVerified : []),
    ...(Array.isArray(critic.missing) ? critic.missing : []),
    ...safetyRisks,
  ].filter(Boolean);
  if (critic.verdict === 'READY_FOR_MERGE' && criticNotPass.length) {
    throw new Error('spiralValidatorCritic READY_FOR_MERGE requires all critic requirements PASS');
  }
  if (critic.verdict === 'READY_WITH_NOTES' && criticNotPass.length && documentedGaps.length === 0) {
    throw new Error('spiralValidatorCritic READY_WITH_NOTES with non-PASS requirements must document gaps');
  }
  if ((critic.verdict === 'IMPROVE' || critic.verdict === 'IMPROVE_MINOR') && nextPlan.length === 0) {
    throw new Error('spiralValidatorCritic IMPROVE/IMPROVE_MINOR requires nextImprovementPlan');
  }
  if (critic.verdict === 'SAFETY_STOP' && safetyRisks.length === 0) {
    throw new Error('spiralValidatorCritic SAFETY_STOP requires safetyRisks');
  }
  if (critic.loopNumber === 3 && critic.verdict === 'IMPROVE') {
    throw new Error('spiralValidatorCritic loopNumber 3 cannot remain IMPROVE');
  }
}
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
