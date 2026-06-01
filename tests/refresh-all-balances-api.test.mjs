import test from "node:test";
import assert from "node:assert/strict";

import handler from "../server/reconcile-balances-and-transfers.js";

test("refresh-all-balances rejects GET because refresh is POST-only", async () => {
  const response = await invoke({ method: "GET", query: {} });

  assert.equal(response.statusCode, 405);
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /Unsupported method: GET/);
});

test("refresh-all-balances POST returns structured refresh report from injected runner", async () => {
  const response = await invoke({
    method: "POST",
    query: {},
    body: JSON.stringify({ from: "2026-06-01", to: "2026-06-02", dryRun: true }),
    runner: async (options) => ({
      ok: true,
      period: { from: options.from, to: options.to },
      refresh_report: {
        provider_matrix: [
          { provider: "wise", channel: "трансервайз дол", currency: "USD", severity: "ok" },
          { provider: "revolut", channel: "REVOLUT евро", currency: "EUR", severity: "red", action_required: "manual screenshot" },
        ],
        totals: {
          canonical_total_usd: 123,
          source: "selected_date_snapshot",
          totals_match: true,
        },
      },
    }),
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.deepEqual(response.body.period, { from: "2026-06-01", to: "2026-06-02" });
  assert.equal(response.body.refresh_report.provider_matrix[1].severity, "red");
  assert.equal(response.body.refresh_report.totals.canonical_total_usd, 123);
});

async function invoke({ method, query = {}, body, runner } = {}) {
  const headers = {};
  const response = {
    statusCode: null,
    body: null,
    setHeader(name, value) {
      headers[name] = value;
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
  await handler({ method, query, body, refreshAllBalancesRunner: runner }, response);
  return { statusCode: response.statusCode, body: response.body, headers };
}
