import { execFileSync } from "node:child_process";

const PRODUCTION_URL = "https://ezohata-incoming-ledger.vercel.app";
const STATUS_URL = `${PRODUCTION_URL}/api/status`;
const HEALTH_URL = `${PRODUCTION_URL}/api/index?health=1`;
const AUDIT_SNAPSHOT_URL = `${PRODUCTION_URL}/api/audit-snapshot`;
const EXPECTED_LEDGER_ROWS = 26;
const expectedSha = normalizeSha(process.argv[2] || process.env.EXPECTED_SHA || detectOriginMainSha());

const statusResponse = await fetch(STATUS_URL, {
  headers: { "cache-control": "no-cache" }
});
if (!statusResponse.ok) {
  throw new Error(`Status endpoint failed with HTTP ${statusResponse.status}.`);
}

const statusPayload = await statusResponse.json();
const liveSha = normalizeSha(statusPayload.commitSha === "unknown" ? "" : statusPayload.commitSha);
if (!liveSha) {
  throw new Error(`Status endpoint does not expose a live commit SHA (${statusPayload.status || "unknown"}${statusPayload.error ? `: ${statusPayload.error}` : ""}).`);
}

if (expectedSha && liveSha !== expectedSha) {
  throw new Error(`Production commit mismatch: expected ${expectedSha}, got ${liveSha}.`);
}

if (!statusPayload.hasGoogleServiceAccountEmail) {
  throw new Error("Production status reports missing GOOGLE_SERVICE_ACCOUNT_EMAIL.");
}
if (!statusPayload.hasGoogleServiceAccountPrivateKey) {
  throw new Error("Production status reports missing GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.");
}
if (!statusPayload.googleSheetConfigured) {
  throw new Error(`Production status reports Google Sheet is not configured (${statusPayload.googleSheetReadError || "unknown error"}).`);
}
if (!statusPayload.googleSheetReadOk) {
  throw new Error(`Production status reports Google Sheet read failed (${statusPayload.googleSheetReadError || "unknown error"}).`);
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

const auditResponse = await fetch(AUDIT_SNAPSHOT_URL, {
  headers: { "cache-control": "no-cache" }
});
if (!auditResponse.ok) {
  throw new Error(`Audit snapshot endpoint failed with HTTP ${auditResponse.status}.`);
}

const auditPayload = await auditResponse.json();
const ledgerRows = Number(auditPayload?.summary?.ledger_rows || 0);
const fallbackAmountRows = Number(auditPayload?.balances?.fallback_amount_rows || 0);
const googleWarnings = (auditPayload?.warnings || []).filter((warning) => /google sheets|service account|manual google sheets read access/i.test(String(warning || "")));
if (!ledgerRows) {
  throw new Error("Audit snapshot critical failure: ledger_rows is 0.");
}
if (ledgerRows !== EXPECTED_LEDGER_ROWS) {
  throw new Error(`Audit snapshot ledger_rows mismatch: expected ${EXPECTED_LEDGER_ROWS}, got ${ledgerRows}.`);
}
if (fallbackAmountRows !== 0) {
  throw new Error(`Audit snapshot fallback_amount_rows must be 0, got ${fallbackAmountRows}.`);
}
if (googleWarnings.length) {
  throw new Error(`Audit snapshot includes Google Sheets access warnings: ${googleWarnings.join(" | ")}`);
}
if (auditPayload?.exchange?.compatibility_mode !== false) {
  throw new Error("Audit snapshot exchange.compatibility_mode must be false.");
}

console.log(JSON.stringify({
  ok: true,
  expectedSha: expectedSha || null,
  liveSha,
  buildTime: statusPayload.buildTime || null,
  deployTime: statusPayload.deployTime || null,
  deploymentEnvironment: statusPayload.deploymentEnvironment || null,
  appVersion: statusPayload.appVersion || null,
  appBuildVersion: statusPayload.appBuildVersion || null,
  googleSheetReadOk: statusPayload.googleSheetReadOk,
  auditSnapshot: {
    ledgerRows,
    fallbackAmountRows,
    exchangeCompatibilityMode: auditPayload?.exchange?.compatibility_mode
  },
  smoke: {
    statusEndpoint: true,
    healthEndpoint: true,
    auditSnapshotEndpoint: true
  }
}, null, 2));

function normalizeSha(value) {
  const normalized = String(value || "").trim();
  return normalized ? normalized.slice(0, 40) : "";
}

function detectOriginMainSha() {
  try {
    return execFileSync("git", ["rev-parse", "origin/main"], {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}
