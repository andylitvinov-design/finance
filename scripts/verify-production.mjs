const PRODUCTION_URL = "https://ezohata-incoming-ledger.vercel.app";
const STATUS_URL = `${PRODUCTION_URL}/api/status`;
const AUDIT_SNAPSHOT_URL = `${PRODUCTION_URL}/api/audit-snapshot`;
const BODY_EXCERPT_LIMIT = 800;

export async function fetchEndpoint(url, { fetchImpl = fetch } = {}) {
  const method = "GET";
  const response = await fetchImpl(url, {
    method,
    headers: { "cache-control": "no-cache" },
  });
  const contentType = response.headers?.get?.("content-type") || "";
  const bodyText = await response.text();
  const result = {
    url,
    method,
    status: response.status,
    contentType,
    bodyExcerpt: excerptBody(bodyText),
    bodyText,
    json: null,
    parseError: null,
  };

  try {
    result.json = JSON.parse(bodyText);
  } catch (error) {
    result.parseError = error instanceof Error ? error.message : String(error);
  }

  return result;
}

export async function verifyProduction(expectedSha, { fetchImpl = fetch } = {}) {
  const expected = normalizeSha(expectedSha);
  if (!expected) {
    throw new Error("Expected commit SHA is required. Usage: npm run verify:production -- <expected-sha>");
  }

  const status = await fetchEndpoint(STATUS_URL, { fetchImpl });
  printEndpointReport("status", status);
  try {
    verifyStatusResponse(status, expected);
  } catch (error) {
    if (isDeployShaMismatch(error)) {
      const liveSha = normalizeSha(status.json?.commitSha);
      return {
        ok: false,
        status: "deploy_pending",
        expectedSha: expected,
        liveSha,
        commitRef: status.json?.commitRef || null,
        buildTime: status.json?.buildTime || null,
        deployTime: status.json?.deployTime || null,
        message: `Production deploy pending: expected commit ${expected}, live commit is ${liveSha || "missing"}. App checks skipped until expected SHA is live.`,
      };
    }
    throw error;
  }

  const auditSnapshot = await fetchEndpoint(AUDIT_SNAPSHOT_URL, { fetchImpl });
  printEndpointReport("audit-snapshot", auditSnapshot);
  verifyAuditSnapshotResponse(auditSnapshot);

  return {
    ok: true,
    expectedSha: expected,
    liveSha: status.json.commitSha,
    commitRef: status.json.commitRef || null,
    buildTime: status.json.buildTime || null,
    deployTime: status.json.deployTime || null,
    googleSheetReadOk: status.json.googleSheetReadOk ?? null,
  };
}

export function verifyStatusResponse(result, expectedSha) {
  assertHttpOk(result, "status");
  assertJsonResponse(result, "status");

  const payload = result.json;
  if (Object.hasOwn(payload, "status") && payload.status !== "ok") {
    throw new Error(`Status endpoint mismatch: expected status=ok, got ${payload.status || "missing"}.`);
  }

  const liveSha = normalizeSha(payload.commitSha);
  if (!liveSha) {
    throw new Error("Status endpoint mismatch: commitSha is missing.");
  }

  if (liveSha !== expectedSha && !liveSha.startsWith(expectedSha)) {
    throw new Error(`Production deploy mismatch: expected commit ${expectedSha}, live commit is ${liveSha}.`);
  }

  if (hasMeaningfulValue(payload.commitRef) && payload.commitRef !== "main") {
    throw new Error(`Production deploy mismatch: expected commitRef=main, got ${payload.commitRef}.`);
  }

  if (Object.hasOwn(payload, "googleSheetReadOk") && payload.googleSheetReadOk !== true) {
    throw new Error(`Production health mismatch: expected googleSheetReadOk=true, got ${payload.googleSheetReadOk}.`);
  }
}

export function verifyAuditSnapshotResponse(result) {
  assertHttpOk(result, "audit-snapshot");
  assertJsonResponse(result, "audit-snapshot");
}

export function normalizeSha(value) {
  return String(value || "").trim().slice(0, 40);
}

export function excerptBody(bodyText, limit = BODY_EXCERPT_LIMIT) {
  const compact = String(bodyText || "").replace(/\s+/g, " ").trim();
  return compact.length > limit ? `${compact.slice(0, limit)}...` : compact;
}

function assertHttpOk(result, label) {
  if (result.status !== 200) {
    throw new Error(`${label} endpoint failed: expected HTTP 200, got ${result.status}.`);
  }
}

function assertJsonResponse(result, label) {
  if (!String(result.contentType || "").toLowerCase().includes("application/json")) {
    throw new Error(`${label} endpoint failed: expected application/json, got ${result.contentType || "missing"}.`);
  }
  if (result.parseError) {
    throw new Error(`${label} endpoint failed: body is not valid JSON (${result.parseError}).`);
  }
  if (!result.json || typeof result.json !== "object") {
    throw new Error(`${label} endpoint failed: JSON body is not an object.`);
  }
}

function hasMeaningfulValue(value) {
  const normalized = String(value || "").trim();
  return normalized && normalized !== "unknown";
}

function isDeployShaMismatch(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.startsWith("Production deploy mismatch: expected commit ");
}

function printEndpointReport(label, result) {
  console.log(`[${label}] method=${result.method} status=${result.status} content-type=${result.contentType || "missing"}`);
  console.log(`[${label}] body excerpt: ${result.bodyExcerpt || "<empty>"}`);
}

async function main() {
  const expectedSha = process.argv[2] || process.env.EXPECTED_SHA || "";
  try {
    const result = await verifyProduction(expectedSha);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
