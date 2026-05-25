import test from "node:test";
import assert from "node:assert/strict";

import {
  excerptBody,
  fetchEndpoint,
  normalizeSha,
  verifyProduction,
  verifyAuditSnapshotResponse,
  verifyStatusResponse,
} from "../scripts/verify-production.mjs";

test("verifyStatusResponse accepts live full SHA that starts with expected short SHA", () => {
  assert.doesNotThrow(() => verifyStatusResponse(jsonResponse({
    status: "ok",
    commitSha: "cf5230b23da5525a0d50056b1daae1d1195fb692",
    commitRef: "main",
    googleSheetReadOk: true,
  }), "cf5230b23da5"));
});

test("verifyStatusResponse rejects stale live commit", () => {
  assert.throws(() => verifyStatusResponse(jsonResponse({
    status: "ok",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    commitRef: "main",
    googleSheetReadOk: true,
  }), "cf5230b23da5"), /Production deploy mismatch/);
});

test("verifyProduction reports deploy_pending without running app checks when live SHA is stale", async () => {
  const requestedUrls = [];
  const result = await verifyProduction("cf5230b23da5", {
    fetchImpl: async (url) => {
      requestedUrls.push(String(url));
      return {
        status: 200,
        headers: new Map([["content-type", "application/json; charset=utf-8"]]),
        text: async () => JSON.stringify({
          ok: true,
          status: "ok",
          commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          commitRef: "main",
          googleSheetReadOk: true,
        }),
      };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, "deploy_pending");
  assert.equal(result.expectedSha, "cf5230b23da5");
  assert.equal(result.liveSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.match(result.message, /expected commit cf5230b23da5, live commit is aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
  assert.equal(requestedUrls.length, 1);
  assert.match(requestedUrls[0], /\/api\/status$/);
});

test("verifyStatusResponse rejects non-main commitRef when present", () => {
  assert.throws(() => verifyStatusResponse(jsonResponse({
    status: "ok",
    commitSha: "cf5230b23da5525a0d50056b1daae1d1195fb692",
    commitRef: "feature",
    googleSheetReadOk: true,
  }), "cf5230b23da5"), /expected commitRef=main/);
});

test("verifyStatusResponse rejects failed optional Google Sheet read flag when present", () => {
  assert.throws(() => verifyStatusResponse(jsonResponse({
    status: "ok",
    commitSha: "cf5230b23da5525a0d50056b1daae1d1195fb692",
    commitRef: "main",
    googleSheetReadOk: false,
  }), "cf5230b23da5"), /googleSheetReadOk=true/);
});

test("verifyAuditSnapshotResponse rejects HTML even with HTTP 200", () => {
  assert.throws(() => verifyAuditSnapshotResponse({
    status: 200,
    contentType: "text/html; charset=utf-8",
    json: null,
    parseError: "Unexpected token <",
  }), /expected application\/json/);
});

test("verifyAuditSnapshotResponse rejects malformed JSON", () => {
  assert.throws(() => verifyAuditSnapshotResponse({
    status: 200,
    contentType: "application/json",
    json: null,
    parseError: "Unexpected end of JSON input",
  }), /not valid JSON/);
});

test("fetchEndpoint records method, status, content-type, JSON payload, and excerpt", async () => {
  const result = await fetchEndpoint("https://example.test/api/status", {
    fetchImpl: async () => ({
      status: 200,
      headers: new Map([["content-type", "application/json; charset=utf-8"]]),
      text: async () => JSON.stringify({ ok: true }),
    }),
  });

  assert.equal(result.method, "GET");
  assert.equal(result.status, 200);
  assert.equal(result.contentType, "application/json; charset=utf-8");
  assert.deepEqual(result.json, { ok: true });
  assert.equal(result.parseError, null);
  assert.equal(result.bodyExcerpt, "{\"ok\":true}");
});

test("normalizeSha trims and limits to 40 characters", () => {
  assert.equal(normalizeSha(` ${"a".repeat(45)} `), "a".repeat(40));
});

test("excerptBody compacts whitespace and truncates long bodies", () => {
  assert.equal(excerptBody("hello\n   world", 20), "hello world");
  assert.equal(excerptBody("a".repeat(25), 10), "aaaaaaaaaa...");
});

function jsonResponse(payload) {
  return {
    status: 200,
    contentType: "application/json; charset=utf-8",
    json: payload,
    parseError: null,
  };
}
