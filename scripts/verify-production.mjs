const PRODUCTION_URL = "https://ezohata-incoming-ledger.vercel.app";
const STATUS_URL = `${PRODUCTION_URL}/api/status`;
const HEALTH_URL = `${PRODUCTION_URL}/api/index?health=1`;
const expectedSha = normalizeSha(process.argv[2] || process.env.EXPECTED_SHA || "");

const statusResponse = await fetch(STATUS_URL, {
  headers: { "cache-control": "no-cache" }
});
if (!statusResponse.ok) {
  throw new Error(`Status endpoint failed with HTTP ${statusResponse.status}.`);
}

const statusPayload = await statusResponse.json();
const liveSha = normalizeSha(statusPayload.commitSha);
if (!liveSha) {
  throw new Error("Status endpoint does not expose a live commit SHA.");
}

if (expectedSha && liveSha !== expectedSha) {
  throw new Error(`Production commit mismatch: expected ${expectedSha}, got ${liveSha}.`);
}

const healthResponse = await fetch(HEALTH_URL, {
  headers: { "cache-control": "no-cache" }
});
if (!healthResponse.ok) {
  throw new Error(`Health endpoint failed with HTTP ${healthResponse.status}.`);
}

const healthPayload = await healthResponse.json();
if (!healthPayload?.ok) {
  throw new Error("Health endpoint returned a non-ok payload.");
}

console.log(JSON.stringify({
  ok: true,
  expectedSha: expectedSha || null,
  liveSha,
  buildTime: statusPayload.buildTime || null,
  deploymentEnvironment: statusPayload.deploymentEnvironment || null,
  appVersion: statusPayload.appVersion || null,
  appBuildVersion: statusPayload.appBuildVersion || null,
  smoke: {
    statusEndpoint: true,
    healthEndpoint: true
  }
}, null, 2));

function normalizeSha(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, 40) : "";
}
