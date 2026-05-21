import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEndpointSpecs,
  collectAgentDebugBundle,
  parseCliArgs,
  redactSecrets,
} from "../scripts/agent-debug-bundle.mjs";

function jsonResponse(payload, status = 200, contentType = "application/json; charset=utf-8") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? contentType : "";
      },
    },
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function textResponse(text, status = 500, contentType = "text/html; charset=utf-8") {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return String(name).toLowerCase() === "content-type" ? contentType : "";
      },
    },
    async text() {
      return text;
    },
  };
}

function makeFetch(fixtures) {
  return async (url) => {
    const entry = Object.entries(fixtures).find(([pattern]) => String(url).includes(pattern));
    if (!entry) throw new Error(`Unexpected URL: ${url}`);
    const value = entry[1];
    return typeof value === "function" ? value(url) : value;
  };
}

test("parseCliArgs supports period, expected sha, json, and include rows", () => {
  const options = parseCliArgs([
    "--period=2026-05",
    "--expected-sha", "abc123",
    "--json",
    "--include-rows",
  ]);

  assert.equal(options.period, "2026-05");
  assert.equal(options.expectedSha, "abc123");
  assert.equal(options.json, true);
  assert.equal(options.includeRows, true);
});

test("buildEndpointSpecs builds period URLs", () => {
  const specs = buildEndpointSpecs({ baseUrl: "https://example.test/", period: "2026-05" });

  assert.deepEqual(specs.map((spec) => spec.url), [
    "https://example.test/api/status",
    "https://example.test/api/audit-snapshot?period=2026-05",
    "https://example.test/api/debug-full?period=2026-05",
    "https://example.test/api/debug-ui-state?period=2026-05",
  ]);
});

test("buildEndpointSpecs builds from/to URLs and includeRows flags", () => {
  const specs = buildEndpointSpecs({
    baseUrl: "https://example.test",
    from: "2026-05-01",
    to: "2026-05-20",
    includeRows: true,
  });

  assert.deepEqual(specs.map((spec) => spec.url), [
    "https://example.test/api/status",
    "https://example.test/api/audit-snapshot?from=2026-05-01&to=2026-05-20&includeRows=1",
    "https://example.test/api/debug-full?from=2026-05-01&to=2026-05-20",
    "https://example.test/api/debug-ui-state?from=2026-05-01&to=2026-05-20&includeRows=1",
  ]);
});

test("redactSecrets removes sensitive values", () => {
  const redacted = redactSecrets(
    "Bearer abcdefghijklmnopqrstuvwxyz user@test.com private_key: verysecretvalue card 1234567890123456 ?debugToken=abc123&x=1"
  );

  assert.equal(redacted.includes("abcdefghijklmnopqrstuvwxyz"), false);
  assert.equal(redacted.includes("user@test.com"), false);
  assert.equal(redacted.includes("verysecretvalue"), false);
  assert.equal(redacted.includes("1234567890123456"), false);
  assert.equal(redacted.includes("debugToken=abc123"), false);
  assert.match(redacted, /Bearer \[redacted\]/);
  assert.match(redacted, /\[email redacted\]/);
  assert.match(redacted, /private_key: \[redacted\]/);
});

test("collectAgentDebugBundle classifies source ok", async () => {
  const bundle = await collectAgentDebugBundle({ period: "2026-05", expectedSha: "abc123" }, makeFetch({
    "/api/status": jsonResponse({ ok: true, commitSha: "abc123", commitRef: "main", gitRepoSlug: "andylitvinov-design/finance" }),
    "/api/audit-snapshot": jsonResponse({ ok: true, period: { from: "2026-05-01", to: "2026-05-31" }, summary: { ledger_rows: 2 }, balances: { uses_amount_net: true, missing_amount_net_rows: 0, fallback_amount_rows: 0 }, warnings: [] }),
    "/api/debug-full": jsonResponse({ ok: true, deploy: { commitSha: "abc123", commitRef: "main", source: "andylitvinov-design/finance" } }),
    "/api/debug-ui-state": jsonResponse({ ok: true, top_metrics: { payable_usd: 1 }, finance_analysis: { actual_income: [] }, expense_analysis: { real_expense: [] }, transfer_analysis: { transfers: [] }, warnings: [] }),
  }));

  assert.equal(bundle.exitCode, 0);
  assert.equal(bundle.report.classification, "source ok");
  assert.equal(bundle.report.production.productionVerified, true);
  assert.equal(bundle.report.audit.summary.ledger_rows, 2);
  assert.equal(bundle.report.debug_ui_state.top_metrics.payable_usd, 1);
});

test("collectAgentDebugBundle exits non-zero on expected SHA mismatch", async () => {
  const bundle = await collectAgentDebugBundle({ period: "2026-05", expectedSha: "expected" }, makeFetch({
    "/api/status": jsonResponse({ ok: true, commitSha: "live", commitRef: "main", gitRepoSlug: "andylitvinov-design/finance" }),
    "/api/audit-snapshot": jsonResponse({ ok: true }),
    "/api/debug-full": jsonResponse({ ok: true }),
    "/api/debug-ui-state": jsonResponse({ ok: true }),
  }));

  assert.equal(bundle.exitCode, 1);
  assert.equal(bundle.report.classification, "deploy/source mismatch");
  assert.equal(bundle.report.production.productionVerified, false);
});

test("collectAgentDebugBundle captures non-JSON body excerpt", async () => {
  const bundle = await collectAgentDebugBundle({ period: "2026-05" }, makeFetch({
    "/api/status": textResponse("<html>Not JSON client_secret=supersecret customer@example.com</html>", 502, "text/html"),
    "/api/audit-snapshot": jsonResponse({ ok: true }),
    "/api/debug-full": jsonResponse({ ok: true }),
    "/api/debug-ui-state": jsonResponse({ ok: true }),
  }));

  assert.equal(bundle.exitCode, 1);
  assert.equal(bundle.report.classification, "API unavailable: /api/status failed");
  const excerpt = bundle.report.endpoint_statuses.status.bodyExcerpt;
  assert.match(excerpt, /client_secret=\[redacted\]/);
  assert.match(excerpt, /\[email redacted\]/);
  assert.equal(excerpt.includes("supersecret"), false);
});

test("collectAgentDebugBundle validates required period", async () => {
  const bundle = await collectAgentDebugBundle({}, makeFetch({}));

  assert.equal(bundle.exitCode, 2);
  assert.equal(bundle.ok, false);
  assert.match(bundle.errors[0], /Provide --period/);
});
