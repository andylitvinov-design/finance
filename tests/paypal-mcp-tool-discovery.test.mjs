import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  normalizePayPalTransactionDetails,
} from "../api/paypal-transactions.js";

const ACTIONABLE_ERROR = "PayPal REST import failed and MCP fallback is unavailable because PayPal MCP tool list_transactions is not exposed. Use PayPal REST permissions or PayPal statement file import.";

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

async function withEnv(values, run) {
  const previousEnv = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function jsonResponse(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

function createMcpFetch({ callErrorMessage, callText, tools = [] } = {}) {
  let streamController;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const href = String(url);
    calls.push(href);
    if (href.endsWith("/v1/oauth2/token")) {
      return jsonResponse({
        error_description: "Client Authentication failed client_secret=rest-secret access_token=rest-token"
      }, { ok: false, status: 401 });
    }
    if (href.endsWith("/token")) {
      return jsonResponse({ access_token: "mcp-access-token", expires_in: 3600 });
    }
    if (href.endsWith("/sse")) {
      return {
        ok: true,
        status: 200,
        body: new ReadableStream({
          start(controller) {
            streamController = controller;
            controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /sse/message?sessionId=tool-discovery\n\n"));
          },
          cancel() {}
        })
      };
    }
    if (href.includes("/sse/message?sessionId=tool-discovery")) {
      const body = JSON.parse(options.body);
      if (body.method === "initialize") {
        streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "PayPal MCP Agent", version: "1.0.0" } }
        })}\n\n`));
      }
      if (body.method === "tools/call") {
        if (callErrorMessage) {
          streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            error: { code: -32602, message: callErrorMessage }
          })}\n\n`));
        } else {
          streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { content: [{ type: "text", text: callText || JSON.stringify({ total_pages: 1, transaction_details: [] }) }] }
          })}\n\n`));
        }
      }
      if (body.method === "tools/list") {
        streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
          jsonrpc: "2.0",
          id: body.id,
          result: { tools }
        })}\n\n`));
      }
      return { ok: true, status: 202, async text() { return ""; } };
    }
    throw new Error(`Unexpected fetch: ${href}`);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

async function runHandler(fetchImpl) {
  const previousFetch = global.fetch;
  try {
    global.fetch = fetchImpl;
    const response = createResponseRecorder();
    await handler({ method: "POST", body: { startDate: "2026-04-01", endDate: "2026-04-01" } }, response);
    return response;
  } finally {
    global.fetch = previousFetch;
  }
}

test("REST failure plus missing MCP list_transactions returns actionable structured JSON", async () => {
  await withEnv({
    PAYPAL_CLIENT_ID: "rest-client",
    PAYPAL_CLIENT_SECRET: "rest-secret",
    PAYPAL_MCP_CLIENT_ID: "mcp-client",
    PAYPAL_MCP_REFRESH_TOKEN: "mcp-refresh-token",
    PAYPAL_MCP_TOOL_NAME: undefined,
  }, async () => {
    const fetchImpl = createMcpFetch({
      callErrorMessage: "MCP error -32602: Tool list_transactions not found"
    });

    const response = await runHandler(fetchImpl);

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.provider, "paypal");
    assert.equal(response.body.phase, "mcp_fallback");
    assert.equal(response.body.error, ACTIONABLE_ERROR);
    assert.match(response.body.warnings.join(" | "), /PayPal REST import failed/);
    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /rest-secret|mcp-refresh-token|mcp-access-token|access_token=rest-token|client_secret=rest-secret/);
    assert.doesNotMatch(serialized, /SyntaxError|Unexpected token/);
  });
});

test("MCP tool-not-found requests tools/list and returns available MCP tool names", async () => {
  await withEnv({
    PAYPAL_CLIENT_ID: "rest-client",
    PAYPAL_CLIENT_SECRET: "rest-secret",
    PAYPAL_MCP_CLIENT_ID: "mcp-client",
    PAYPAL_MCP_REFRESH_TOKEN: "mcp-refresh-token",
    PAYPAL_MCP_TOOL_NAME: undefined,
  }, async () => {
    const fetchImpl = createMcpFetch({
      callErrorMessage: "tool not found",
      tools: [{ name: "search_transactions" }]
    });

    const response = await runHandler(fetchImpl);

    assert.deepEqual(response.body.availableMcpTools, ["search_transactions"]);
    assert.equal(fetchImpl.calls.filter((href) => href.endsWith("/sse")).length, 1);
  });
});

test("REST success does not call PayPal MCP token or SSE endpoints", async () => {
  await withEnv({
    PAYPAL_CLIENT_ID: "rest-client",
    PAYPAL_CLIENT_SECRET: "rest-secret",
    PAYPAL_MCP_CLIENT_ID: "mcp-client",
    PAYPAL_MCP_REFRESH_TOKEN: "mcp-refresh-token",
  }, async () => {
    const calls = [];
    const fetchImpl = async (url) => {
      const href = String(url);
      calls.push(href);
      if (href.endsWith("/v1/oauth2/token")) return jsonResponse({ access_token: "rest-access-token" });
      if (href.includes("/v1/reporting/transactions")) {
        return jsonResponse({ total_pages: 1, transaction_details: [] });
      }
      throw new Error(`Unexpected fetch: ${href}`);
    };

    const response = await runHandler(fetchImpl);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.source, "paypal");
    assert.equal(calls.some((href) => href.endsWith("/token") && !href.endsWith("/v1/oauth2/token")), false);
    assert.equal(calls.some((href) => href.endsWith("/sse")), false);
  });
});

test("MCP plain text non-JSON returns capped redacted JSON error", async () => {
  await withEnv({
    PAYPAL_CLIENT_ID: "",
    PAYPAL_CLIENT_SECRET: "",
    PAYPAL_MCP_CLIENT_ID: "mcp-client",
    PAYPAL_MCP_REFRESH_TOKEN: "mcp-refresh-token",
  }, async () => {
    const response = await runHandler(createMcpFetch({
      callText: `Not JSON Bearer secret-token access_token=token-value client_secret=secret-value ${"x".repeat(500)}`
    }));

    assert.equal(response.statusCode, 400);
    assert.equal(response.body.ok, false);
    assert.match(response.body.error, /PayPal MCP tool list_transactions returned non-JSON/);
    assert.doesNotMatch(response.body.error, /secret-token|token-value|secret-value/);
    assert.equal(response.body.error.length < 380, true);
  });
});

test("PayPal normalization keeps missing and explicit fee/net semantics", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "TXN-NOFEE",
        transaction_initiation_date: "2026-04-23T10:00:00Z",
        transaction_amount: { value: "100.00", currency_code: "USD" },
      }
    },
    {
      transaction_info: {
        transaction_id: "TXN-INCOME-FEE",
        transaction_initiation_date: "2026-04-22T12:00:00Z",
        transaction_amount: { value: "324.00", currency_code: "USD" },
        fee_amount: { value: "-12.94", currency_code: "USD" }
      }
    }
  ]);

  const noFeeIncome = entries.find((entry) => entry.id === "paypal-TXN-NOFEE");
  const feeIncome = entries.find((entry) => entry.id === "paypal-TXN-INCOME-FEE");
  const feeRow = entries.find((entry) => entry.id === "paypal-fee-TXN-INCOME-FEE");

  assert.equal(noFeeIncome?.amountGross, 100);
  assert.equal(noFeeIncome?.amountFee, null);
  assert.equal(noFeeIncome?.amountNet, null);
  assert.equal(noFeeIncome?.amount_net, null);
  assert.equal(feeIncome?.amountGross, 324);
  assert.equal(feeIncome?.amountFee, 12.94);
  assert.equal(feeIncome?.amountNet, 311.06);
  assert.equal(feeRow?.direction, "expense");
  assert.equal(feeRow?.localAmount, 12.94);
});
