import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  fetchPayPalStatementEntries,
  fetchPayPalStatementEntriesFromMcp,
  normalizePayPalTransactionDetails,
} from "../api/paypal-transactions.js";

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

function createTextResponse({ ok = false, status = 400, body = "", headers = {} } = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        return headers[String(name || "").toLowerCase()] || "";
      }
    },
    async text() {
      return body;
    }
  };
}

function withEnv(values, run) {
  const previousEnv = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) delete process.env[key];
    else process.env[key] = value;
  }
  return Promise.resolve()
    .then(run)
    .finally(() => {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });
}

async function runMcpHandlerWithToolText(toolText) {
  return withEnv(
    {
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      PAYPAL_MCP_CLIENT_ID: "mcp-client",
      PAYPAL_MCP_REFRESH_TOKEN: "mcp-refresh",
    },
    async () => {
      const previousFetch = global.fetch;
      let streamController;
      try {
        global.fetch = async (url, options = {}) => {
          const href = String(url);
          if (href.endsWith("/token")) {
            return {
              ok: true,
              status: 200,
              async text() {
                return JSON.stringify({ access_token: "mcp-access", expires_in: 3600 });
              }
            };
          }
          if (href.endsWith("/sse")) {
            return {
              ok: true,
              status: 200,
              body: new ReadableStream({
                start(controller) {
                  streamController = controller;
                  controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /sse/message?sessionId=bad-tool\n\n"));
                },
                cancel() {}
              })
            };
          }
          if (href.includes("/sse/message?sessionId=bad-tool")) {
            const body = JSON.parse(options.body);
            if (body.method === "initialize") {
              streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "PayPal MCP Agent", version: "1.0.0" } }
              })}\n\n`));
            }
            if (body.method === "tools/call") {
              streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: { content: [{ type: "text", text: toolText }] }
              })}\n\n`));
            }
            return { ok: true, status: 202, async text() { return ""; } };
          }
          throw new Error(`Unexpected fetch: ${href}`);
        };

        const response = createResponseRecorder();
        await handler({ method: "POST", body: { startDate: "2026-04-01", endDate: "2026-04-01" } }, response);
        return response;
      } finally {
        global.fetch = previousFetch;
      }
    }
  );
}

async function runMcpHandlerWithToolNotFound() {
  return withEnv(
    {
      PAYPAL_CLIENT_ID: "",
      PAYPAL_CLIENT_SECRET: "",
      PAYPAL_MCP_CLIENT_ID: "mcp-client",
      PAYPAL_MCP_REFRESH_TOKEN: "mcp-refresh",
    },
    async () => {
      const previousFetch = global.fetch;
      let streamController;
      try {
        global.fetch = async (url, options = {}) => {
          const href = String(url);
          if (href.endsWith("/token")) {
            return { ok: true, status: 200, async text() { return JSON.stringify({ access_token: "mcp-access" }); } };
          }
          if (href.endsWith("/sse")) {
            return {
              ok: true,
              status: 200,
              body: new ReadableStream({
                start(controller) {
                  streamController = controller;
                  controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /sse/message?sessionId=tool-missing\n\n"));
                },
                cancel() {}
              })
            };
          }
          if (href.includes("/sse/message?sessionId=tool-missing")) {
            const body = JSON.parse(options.body);
            if (body.method === "initialize") {
              streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "PayPal MCP Agent" } }
              })}\n\n`));
            }
            if (body.method === "tools/call") {
              streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                error: { code: -32602, message: "tool list_transactions not found" }
              })}\n\n`));
            }
            if (body.method === "tools/list") {
              streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
                jsonrpc: "2.0",
                id: body.id,
                result: { tools: [{ name: "get_transaction" }] }
              })}\n\n`));
            }
            return { ok: true, status: 202, async text() { return ""; } };
          }
          throw new Error(`Unexpected fetch: ${href}`);
        };

        const response = createResponseRecorder();
        await handler({ method: "POST", body: { startDate: "2026-05-20", endDate: "2026-05-20" } }, response);
        return response;
      } finally {
        global.fetch = previousFetch;
      }
    }
  );
}

test("handler returns structured JSON when PayPal MCP tool text is non-JSON", async () => {
  const response = await runMcpHandlerWithToolText("Failed to call list_transactions");

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.provider, "paypal");
  assert.equal(response.body.error, "paypal_manual_import_required");
  assert.equal(response.body.phase, "mcp_fallback");
  assert.equal(response.body.canUseManualImport, true);
  assert.equal(response.body.fallback, "manual_activity_import");
  assert.match(response.body.shortExcerpt, /PayPal MCP tool list_transactions/);
  assert.match(response.body.shortExcerpt, /Failed to call list_transactions/);
  assert.doesNotMatch(response.body.shortExcerpt, /^Unexpected token|SyntaxError/);
});

test("handler returns structured manual fallback when PayPal MCP list_transactions tool is missing", async () => {
  const response = await runMcpHandlerWithToolNotFound();

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.provider, "paypal");
  assert.equal(response.body.error, "paypal_manual_import_required");
  assert.equal(response.body.phase, "mcp_tool_not_found");
  assert.equal(response.body.providerStatus, "mcp_tool_not_found");
  assert.equal(response.body.canUseManualImport, true);
  assert.deepEqual(response.body.availableMcpTools, ["get_transaction"]);
  assert.match(response.body.shortExcerpt, /list_transactions/);
});

test("handler returns manual import guidance for PayPal REST transaction permission failures", async () => {
  await withEnv(
    {
      PAYPAL_CLIENT_ID: "rest-client",
      PAYPAL_CLIENT_SECRET: "rest-secret",
      PAYPAL_MCP_CLIENT_ID: "",
      PAYPAL_MCP_REFRESH_TOKEN: "",
    },
    async () => {
      const previousFetch = global.fetch;
      try {
        global.fetch = async (url) => {
          const href = String(url);
          if (href.endsWith("/v1/oauth2/token")) {
            return { ok: true, status: 200, async text() { return JSON.stringify({ access_token: "rest-access" }); } };
          }
          if (href.includes("/v1/reporting/transactions")) {
            return {
              ok: false,
              status: 403,
              async text() {
                return JSON.stringify({ name: "NOT_AUTHORIZED", message: "Transaction Search reporting permission denied for this account" });
              }
            };
          }
          throw new Error(`Unexpected fetch: ${href}`);
        };

        const response = createResponseRecorder();
        await handler({ method: "POST", body: { startDate: "2026-05-20", endDate: "2026-05-20" } }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.ok, false);
        assert.equal(response.body.provider, "paypal");
        assert.equal(response.body.error, "paypal_manual_import_required");
        assert.equal(response.body.phase, "transaction_search");
        assert.equal(response.body.providerStatus, "permission_denied");
        assert.equal(response.body.canUseManualImport, true);
        assert.match(response.body.shortExcerpt, /NOT_AUTHORIZED|permission denied/i);
      } finally {
        global.fetch = previousFetch;
      }
    }
  );
});

test("handler returns sanitized oauth phase for PayPal invalid_client failures", async () => {
  await withEnv(
    {
      PAYPAL_CLIENT_ID: "rest-client",
      PAYPAL_CLIENT_SECRET: "super-secret-value",
      PAYPAL_MCP_CLIENT_ID: "",
      PAYPAL_MCP_REFRESH_TOKEN: "",
    },
    async () => {
      const previousFetch = global.fetch;
      try {
        global.fetch = async (url) => {
          assert.match(String(url), /\/v1\/oauth2\/token$/);
          return {
            ok: false,
            status: 401,
            async text() {
              return JSON.stringify({ error: "invalid_client", error_description: "Client Authentication failed client_secret=super-secret-value" });
            }
          };
        };

        const response = createResponseRecorder();
        await handler({ method: "POST", body: { startDate: "2026-05-20", endDate: "2026-05-20" } }, response);

        assert.equal(response.statusCode, 200);
        assert.equal(response.body.ok, false);
        assert.equal(response.body.phase, "oauth");
        assert.equal(response.body.providerStatus, "auth_failed");
        assert.equal(response.body.canUseManualImport, true);
        assert.doesNotMatch(JSON.stringify(response.body), /super-secret-value/);
        assert.match(response.body.shortExcerpt, /invalid_client|Client Authentication failed/);
      } finally {
        global.fetch = previousFetch;
      }
    }
  );
});

test("handler imports manual PayPal rows without calling provider credentials", async () => {
  const response = createResponseRecorder();
  await handler({
    method: "POST",
    body: {
      source: "paypal_manual",
      manualRows: [
        { date: "2026-05-13", counterparty: "Booking.com BV", amount: "-€27.14", type: "Payment" }
      ]
    }
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.source, "paypal_manual");
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.entries[0].source, "paypal_manual");
  assert.equal(response.body.entries[0].amount_gross, -27.14);
  assert.equal(response.body.entries[0].amount_net, null);
  assert.equal(response.body.entries[0].net_source, "unconfirmed");
});

test("fetchPayPalStatementEntriesFromMcp reports text/plain MCP token errors with status and excerpt", async () => {
  await assert.rejects(
    fetchPayPalStatementEntriesFromMcp({
      startDate: "2026-04-01",
      endDate: "2026-04-01",
      clientId: "mcp-client",
      refreshToken: "mcp-refresh",
      fetchImpl: async (url) => {
        assert.match(String(url), /\/token$/);
        return createTextResponse({ status: 401, body: "Failed to refresh token", headers: { "content-type": "text/plain" } });
      }
    }),
    (error) => {
      assert.match(error.message, /PayPal MCP token refresh failed \(401\)/);
      assert.match(error.message, /Failed to refresh token/);
      assert.doesNotMatch(error.message, /^Unexpected token|SyntaxError|json is not a function/);
      return true;
    }
  );
});

test("fetchPayPalStatementEntriesFromMcp reports non-JSON SSE events with PayPal MCP event context", async () => {
  let streamController;
  await assert.rejects(
    fetchPayPalStatementEntriesFromMcp({
      startDate: "2026-04-01",
      endDate: "2026-04-01",
      clientId: "mcp-client",
      refreshToken: "mcp-refresh",
      fetchImpl: async (url, options = {}) => {
        const href = String(url);
        if (href.endsWith("/token")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ access_token: "mcp-access", expires_in: 3600 });
            }
          };
        }
        if (href.endsWith("/sse")) {
          return {
            ok: true,
            status: 200,
            body: new ReadableStream({
              start(controller) {
                streamController = controller;
                controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /sse/message?sessionId=bad-event\n\n"));
              },
              cancel() {}
            })
          };
        }
        if (href.includes("/sse/message?sessionId=bad-event")) {
          const body = JSON.parse(options.body);
          if (body.method === "initialize") {
            streamController.enqueue(new TextEncoder().encode("event: message\ndata: Failed to connect\n\n"));
          }
          return { ok: true, status: 202, async text() { return ""; } };
        }
        throw new Error(`Unexpected fetch: ${href}`);
      }
    }),
    /PayPal MCP event returned non-JSON: Failed to connect/
  );
});

test("fetchPayPalStatementEntries reports non-JSON PayPal OAuth failures with status and excerpt", async () => {
  await assert.rejects(
    fetchPayPalStatementEntries({
      startDate: "2026-04-01",
      endDate: "2026-04-01",
      clientId: "client",
      clientSecret: "secret",
      environment: "sandbox",
      fetchImpl: async (url) => {
        assert.match(String(url), /\/v1\/oauth2\/token$/);
        return createTextResponse({ status: 401, body: "Failed to authenticate", headers: { "content-type": "text/plain" } });
      }
    }),
    (error) => {
      assert.match(error.message, /PayPal OAuth failed \(401\)/);
      assert.match(error.message, /Failed to authenticate/);
      assert.doesNotMatch(error.message, /^Unexpected token|SyntaxError/);
      return true;
    }
  );
});

test("fetchPayPalStatementEntries reports non-JSON PayPal transaction failures with status and excerpt", async () => {
  await assert.rejects(
    fetchPayPalStatementEntries({
      startDate: "2026-04-01",
      endDate: "2026-04-01",
      clientId: "client",
      clientSecret: "secret",
      environment: "sandbox",
      fetchImpl: async (url) => {
        const href = String(url);
        if (href.endsWith("/v1/oauth2/token")) {
          return {
            ok: true,
            status: 200,
            async text() {
              return JSON.stringify({ access_token: "token" });
            }
          };
        }
        assert.match(href, /\/v1\/reporting\/transactions/);
        return createTextResponse({ status: 403, body: "Failed to fetch transactions", headers: { "content-type": "text/plain" } });
      }
    }),
    (error) => {
      assert.match(error.message, /PayPal transaction request failed \(403\)/);
      assert.match(error.message, /Failed to fetch transactions/);
      assert.doesNotMatch(error.message, /^Unexpected token|SyntaxError/);
      return true;
    }
  );
});

test("income with PayPal fee preserves gross amount, fee metadata, direction, and separate fee expense row", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "TXN-INCOME-FEE",
        transaction_initiation_date: "2026-04-22T12:00:00Z",
        transaction_amount: { value: "324.00", currency_code: "USD" },
        fee_amount: { value: "-12.94", currency_code: "USD" }
      }
    }
  ]);

  const income = entries.find((entry) => entry.id === "paypal-TXN-INCOME-FEE");
  const fee = entries.find((entry) => entry.id === "paypal-fee-TXN-INCOME-FEE");

  assert.equal(income?.localAmount, 324);
  assert.equal(income?.feeAmount, 12.94);
  assert.equal(income?.direction, "income");
  assert.equal(fee?.direction, "expense");
  assert.equal(fee?.localAmount, 12.94);
});

test("income without PayPal fee keeps gross but leaves net empty for incomplete balance", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "TXN-INCOME-NO-FEE",
        transaction_initiation_date: "2026-05-11T12:00:00Z",
        transaction_amount: { value: "36.00", currency_code: "EUR" }
      }
    }
  ]);

  const income = entries.find((entry) => entry.id === "paypal-TXN-INCOME-NO-FEE");

  assert.equal(income?.localAmount, 36);
  assert.equal(income?.grossAmount, 36);
  assert.equal(income?.feeAmount, null);
  assert.equal(income?.netAmount, null);
  assert.equal(income?.amountNet, null);
  assert.equal(income?.amount_net, null);
  assert.equal(income?.usdAmount, null);
  assert.equal(income?.direction, "income");
  assert.equal(entries.some((entry) => entry.id === "paypal-fee-TXN-INCOME-NO-FEE"), false);
});
