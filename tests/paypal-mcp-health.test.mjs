import test from "node:test";
import assert from "node:assert/strict";

import { buildPayPalMcpHealthReport } from "../scripts/paypal-mcp-health.mjs";

test("buildPayPalMcpHealthReport reports invalid grant without leaking secrets", async () => {
  const report = await buildPayPalMcpHealthReport({
    env: {
      PAYPAL_MCP_CLIENT_ID: "client-secret-value",
      PAYPAL_MCP_REFRESH_TOKEN: "refresh-secret-value",
      PAYPAL_MCP_TOOL_NAME: "list_transactions",
    },
    fetchImpl: async () => ({
      ok: false,
      status: 400,
      headers: { get() { return "application/json"; } },
      async text() {
        return JSON.stringify({ error: "invalid_grant", error_description: "Grant not found" });
      }
    })
  });

  assert.equal(report.ok, false);
  assert.equal(report.actionRequired, "reconnect_paypal_mcp");
  assert.equal(report.mcpTokenRefresh.status, 400);
  assert.equal(report.presence.PAYPAL_MCP_CLIENT_ID.present, true);
  assert.equal(report.presence.PAYPAL_MCP_REFRESH_TOKEN.present, true);
  assert.doesNotMatch(JSON.stringify(report), /client-secret-value|refresh-secret-value/);
});
