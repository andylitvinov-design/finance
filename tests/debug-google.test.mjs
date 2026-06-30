import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

import handler from "../server/debug-google-route.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

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
    },
  };
}

function jsonResponse(payload, init = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    async json() {
      return payload;
    },
  };
}

test("GET /api/debug-google is disabled unless explicitly gated on", async () => {
  const previousFlag = process.env.ENABLE_DEBUG_GOOGLE;
  delete process.env.ENABLE_DEBUG_GOOGLE;

  try {
    const response = createResponseRecorder();
    await handler({ method: "GET", query: {} }, response);

    assert.equal(response.statusCode, 404);
    assert.equal(response.body?.ok, false);
    assert.equal(response.body?.error, "debug_google_disabled");
  } finally {
    if (previousFlag === undefined) delete process.env.ENABLE_DEBUG_GOOGLE;
    else process.env.ENABLE_DEBUG_GOOGLE = previousFlag;
  }
});

test("GET /api/debug-google returns only safe probe metadata when enabled", async () => {
  const envBackup = snapshotEnv([
    "ENABLE_DEBUG_GOOGLE",
    "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  ]);
  const originalFetch = globalThis.fetch;
  process.env.ENABLE_DEBUG_GOOGLE = "1";
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL = "manual-ledger-test@example.com";
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY = privateKey
    .export({ format: "pem", type: "pkcs8" })
    .toString()
    .replace(/\n/g, "\\n");
  globalThis.fetch = async (url) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "token" });
    }
    if (String(url).includes("sheets.googleapis.com")) {
      return jsonResponse({ values: [["date", "operation"]] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const response = createResponseRecorder();
    await handler({ method: "GET", query: {} }, response);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.spreadsheetId, "1XI_JeQmyrjWtGj_U5o8Rf8kG-oGkC7gmn_e8sbDxoJY");
    assert.equal(response.body?.configured, true);
    assert.equal(response.body?.authClientCreated, true);
    assert.equal(response.body?.readOk, true);
    assert.equal(response.body?.rowCount, 1);
    assert.equal(response.body?.error, null);
    const serialized = JSON.stringify(response.body);
    assert.equal(serialized.includes("manual-ledger-test@example.com"), false);
    assert.equal(serialized.includes("BEGIN PRIVATE KEY"), false);
    assert.equal(serialized.includes("token"), false);
  } finally {
    globalThis.fetch = originalFetch;
    restoreEnv(envBackup);
  }
});

function snapshotEnv(keys) {
  return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
