// verify-deployment.mjs — verify a deployment URL returns HTTP success and optionally matches a commit
// Usage:
//   node scripts/verify-deployment.mjs
//   LIVE_URL="https://ezohata-incoming-ledger.vercel.app" EXPECTED_COMMIT="abc123" node scripts/verify-deployment.mjs
//   DEPLOYMENT_URL="https://preview.vercel.app" node scripts/verify-deployment.mjs
// Exit codes: 0=ok, 1=check failed, 2=missing config

const provider = process.env.DEPLOYMENT_PROVIDER || 'vercel';
const expectedCommit = process.env.EXPECTED_COMMIT || '';
const deploymentUrl = process.env.DEPLOYMENT_URL || '';
const liveUrl = process.env.LIVE_URL || 'https://ezohata-incoming-ledger.vercel.app';

const result = {
  provider,
  expectedCommit: expectedCommit || null,
  deploymentUrl: deploymentUrl || null,
  liveUrl,
  checkedAt: new Date().toISOString(),
  ok: false,
  notes: []
};

const urlToCheck = deploymentUrl || liveUrl;

try {
  const response = await fetch(urlToCheck, { redirect: 'follow' });
  result.httpStatus = response.status;
  result.ok = response.ok;
  if (!response.ok) {
    result.notes.push(`HTTP check failed: ${response.status}`);
  }
} catch (error) {
  result.notes.push(`Request failed: ${error.message}`);
}

if (result.ok && expectedCommit) {
  try {
    const statusResp = await fetch(`${liveUrl}/api/status`);
    if (statusResp.ok) {
      const statusBody = await statusResp.text();
      result.statusBody = statusBody.slice(0, 200);
      if (!statusBody.includes(expectedCommit)) {
        result.notes.push(`Expected commit ${expectedCommit} not found in /api/status`);
        result.commitVerified = false;
      } else {
        result.commitVerified = true;
      }
    }
  } catch (e) {
    result.notes.push(`Could not verify commit via /api/status: ${e.message}`);
  }
}

console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
