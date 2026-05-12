import test from "node:test";
import assert from "node:assert/strict";

import statusHandler from "../api/status.js";
import indexHandler from "../api/index.js";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    }
  };
}

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

test("GET /api/debug-full returns deploy metadata and endpoint inventory", async () => {
  const envBackup = snapshotEnv([
    "VERCEL_GIT_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_REF",
    "VERCEL_GIT_REPO_SLUG",
    "VERCEL_PROJECT_NAME"
  ]);
  Object.assign(process.env, {
    VERCEL_GIT_COMMIT_SHA: "debugsha123",
    VERCEL_GIT_COMMIT_REF: "main",
    VERCEL_GIT_REPO_SLUG: "andylitvinov-design/finance",
    VERCEL_PROJECT_NAME: "ezohata-incoming-ledger"
  });

  try {
    const response = createResponseRecorder();
    await indexHandler({
      method: "GET",
      query: { action: "debugFull", from: "2026-05-01", to: "2026-05-09" }
    }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.body?.ok, true);
    assert.deepEqual(response.body?.period, { from: "2026-05-01", to: "2026-05-09" });
    assert.equal(response.body?.deploy?.commitSha, "debugsha123");
    assert.equal(response.body?.deploy?.commitRef, "main");
    assert.equal(response.body?.deploy?.project, "ezohata-incoming-ledger");
    assert.equal(response.body?.deploy?.source, "andylitvinov-design/finance");
    assert.equal(response.body?.endpoints?.status?.path, "/api/status");
    assert.equal(response.body?.endpoints?.dashboardData?.path, "/api?action=getDashboardData");
    assert.equal(response.body?.endpoints?.debugFull?.path, "/api/debug-full");
    assert.equal(response.body?.endpoints?.debugAnalytics?.path, "/api/debug-analytics");
    assert.deepEqual(response.body?.warnings, []);
  } finally {
    restoreEnv(envBackup);
  }
});

test("GET /api/debug-analytics returns period guard scaffold", async () => {
  const response = createResponseRecorder();
  await indexHandler({
    method: "GET",
    query: { action: "debugAnalytics", from: "2026-05-01", to: "2026-05-09" }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(response.body?.ok, true);
  assert.deepEqual(response.body?.period, { from: "2026-05-01", to: "2026-05-09" });
  assert.deepEqual(response.body?.periodGuard, {
    status: "needs_verification",
    rowsInsidePeriod: null,
    rowsOutsidePeriod: null,
    allTimeLeakDetected: "needs_verification",
    fieldsNeedingVerification: []
  });
  assert.deepEqual(response.body?.warnings, []);
});

test("POST debug endpoints return 405 JSON", async () => {
  for (const action of ["debugFull", "debugAnalytics"]) {
    const response = createResponseRecorder();
    await indexHandler({ method: "POST", query: { action } }, response);

    assert.equal(response.statusCode, 405);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    assert.equal(response.body?.ok, false);
    assert.match(response.body?.error, /Unsupported method: POST/);
  }
});

test("vercel rewrites expose debug paths through the existing index function", async () => {
  const { readFile } = await import("node:fs/promises");
  const vercelConfig = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));

  assert.deepEqual(vercelConfig.rewrites.slice(0, 3), [
    { source: "/api/balance-snapshots", destination: "/api/index?action=balanceSnapshots" },
    { source: "/api/debug-full", destination: "/api/index?action=debugFull" },
    { source: "/api/debug-analytics", destination: "/api/index?action=debugAnalytics" }
  ]);
  assert.ok(vercelConfig.rewrites.some((rewrite) => rewrite.source === "/api/manual-finance" && rewrite.destination === "/api/manual-workbook?route=manual-finance"));
});

test("existing status and dashboard handlers keep their current contracts", async () => {
  const envBackup = snapshotEnv([
    "EZOHATA_V2_APPS_SCRIPT_URL",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"
  ]);
  delete process.env.EZOHATA_V2_APPS_SCRIPT_URL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;

  try {
    const statusResponse = createResponseRecorder();
    await statusHandler({ method: "GET", query: {} }, statusResponse);
    assert.equal(statusResponse.statusCode, 200);
    assert.equal(statusResponse.body?.ok, true);
    assert.equal(statusResponse.body?.service, "ezohata-incoming-ledger");

    const dashboardResponse = createResponseRecorder();
    await indexHandler({
      method: "GET",
      query: {
        action: "getDashboardData",
        startDate: "2026-05-01",
        endDate: "2026-05-09"
      }
    }, dashboardResponse);
    assert.equal(dashboardResponse.statusCode, 200);
    assert.equal(dashboardResponse.body?.ok, true);
    assert.equal(dashboardResponse.body?.action, "getDashboardData");
    assert.equal(dashboardResponse.body?.source, "snapshot");
    assert.equal(dashboardResponse.body?.fallbackSnapshot, true);
  } finally {
    restoreEnv(envBackup);
  }
});
