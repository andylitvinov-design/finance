import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  fetchPayPalStatementEntries,
  fetchPayPalStatementEntriesFromMcp,
  normalizePayPalTransactionDetails,
  summarizePayPalStatementEntries,
  splitDateRange,
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


test("splitDateRange keeps PayPal chunks within 31 days", () => {
  assert.deepEqual(splitDateRange("2026-01-01", "2026-02-05"), [
    { startDate: "2026-01-01", endDate: "2026-01-31" },
    { startDate: "2026-02-01", endDate: "2026-02-05" },
  ]);
});

test("normalizePayPalTransactionDetails maps expenses and fees to ledger entries", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "TXN-1",
        transaction_initiation_date: "2026-04-20T14:30:00Z",
        transaction_amount: { value: "-12.50", currency_code: "USD" },
        fee_amount: { value: "-0.80", currency_code: "USD" },
        transaction_subject: "Software",
        invoice_id: "INV-1",
        custom_field: "ORDER-1",
        transaction_event_code: "T0006"
      },
      payee_info: {
        email_address: "merchant@example.com",
        payee_name: "Software Inc"
      },
      cart_info: {
        item_details: [{ item_name: "Ignored because subject wins" }]
      }
    },
    {
      transaction_info: {
        transaction_id: "TXN-2",
        transaction_initiation_date: "2026-04-21T09:00:00Z",
        transaction_amount: { value: "20.00", currency_code: "EUR" }
      },
      payer_info: {
        payer_id: "PAYER-1",
        payer_name: {
          given_name: "Jane",
          surname: "Doe"
        },
        email_address: "payer@example.com"
      }
    }
  ]);

  assert.equal(entries.length, 3);
  assert.equal(entries[0].direction, "expense");
  assert.equal(entries[0].suggestedCategory, "business");
  assert.equal(entries[0].channel, "пейпал дол");
  assert.equal(entries[0].localAmount, 12.5);
  assert.equal(entries[0].organization, "Software | invoice INV-1 | custom ORDER-1 | event T0006");
  assert.equal(entries[0].counterpartyName, "Software Inc");
  assert.equal(entries[0].counterpartyEmail, "merchant@example.com");
  assert.equal(entries[0].counterpartyType, "company");
  assert.equal(entries[0].counterpartyRole, "payee");
  assert.equal(entries[0].counterpartyLabel, "Кому: Software Inc");
  assert.equal(entries[0].fromEntity, "me");
  assert.equal(entries[0].toEntity, "Software Inc");
  assert.equal(entries[0].operationType, "payout");
  assert.equal(entries[0].displayFromTo, "Me → Software Inc");
  assert.equal(entries[0].externalId, "INV-1");
  assert.equal(entries[0].entryKind, "payment");
  assert.equal(entries[0].payeeName, "Software Inc");
  assert.equal(entries[0].payeeEmail, "merchant@example.com");
  assert.equal(entries[0].transactionSubject, "Software");
  assert.equal(entries[1].organization, "PayPal fee: Software | invoice INV-1 | custom ORDER-1 | event T0006");
  assert.equal(entries[1].suggestedCategory, "business");
  assert.equal(entries[1].counterpartyLabel, "Кому: Комиссия PayPal");
  assert.equal(entries[1].fromEntity, "me");
  assert.equal(entries[1].toEntity, "PayPal Fee");
  assert.equal(entries[1].operationType, "fee");
  assert.equal(entries[1].displayFromTo, "Me → PayPal Fee");
  assert.equal(entries[1].externalId, "INV-1");
  assert.equal(entries[1].entryKind, "fee");
  assert.equal(entries[2].direction, "income");
  assert.equal(entries[2].suggestedCategory, "servicein");
  assert.equal(entries[2].channel, "пейпал евр");
  assert.equal(entries[2].feeAmount, null);
  assert.equal(entries[2].counterpartyName, "Jane Doe");
  assert.equal(entries[2].counterpartyEmail, "payer@example.com");
  assert.equal(entries[2].counterpartyType, "person");
  assert.equal(entries[2].counterpartyRole, "payer");
  assert.equal(entries[2].counterpartyLabel, "От: Jane Doe");
  assert.equal(entries[2].fromEntity, "Jane Doe");
  assert.equal(entries[2].toEntity, "Me");
  assert.equal(entries[2].operationType, "service_in");
  assert.equal(entries[2].displayFromTo, "Jane Doe → Me");
  assert.equal(entries[2].externalId, "TXN-2");
  assert.equal(entries[2].entryKind, "payment");
  assert.equal(entries[2].payerName, "Jane Doe");
  assert.equal(entries[2].payerEmail, "payer@example.com");
  assert.equal(entries[2].payerId, "PAYER-1");
});

test("normalizePayPalTransactionDetails keeps fee metadata on income entries", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "TXN-INCOME",
        transaction_initiation_date: "2026-04-22T12:00:00Z",
        transaction_amount: { value: "324.00", currency_code: "USD" },
        fee_amount: { value: "-12.94", currency_code: "USD" }
      }
    }
  ]);

  const income = entries.find((entry) => entry.direction === "income");
  assert.equal(income?.feeAmount, 12.94);
  assert.equal(income?.feeCurrency, "USD");
});

test("normalizePayPalTransactionDetails classifies currency conversion legs as exchange", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "CONVERSION-1",
        paypal_reference_id: "REF-EX-1",
        transaction_event_code: "T0200",
        transaction_initiation_date: "2026-04-22T14:30:00Z",
        transaction_amount: { value: "-8.46", currency_code: "EUR" }
      }
    },
    {
      transaction_info: {
        transaction_id: "CONVERSION-2",
        paypal_reference_id: "REF-EX-1",
        transaction_event_code: "T1105",
        transaction_initiation_date: "2026-04-22T14:30:00Z",
        transaction_amount: { value: "13.00", currency_code: "CAD" }
      }
    }
  ]);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries.map((entry) => entry.direction), ["exchange", "exchange"]);
  assert.deepEqual(entries.map((entry) => entry.suggestedCategory), ["exchange", "exchange"]);
  assert.deepEqual(entries.map((entry) => entry.entryKind), ["exchange", "exchange"]);
  assert.deepEqual(entries.map((entry) => entry.operationType), ["exchange", "exchange"]);
  assert.deepEqual(entries.map((entry) => entry.fromEntity), ["PayPal EUR", "PayPal EUR"]);
  assert.deepEqual(entries.map((entry) => entry.toEntity), ["PayPal CAD", "PayPal CAD"]);
  assert.deepEqual(entries.map((entry) => entry.displayFromTo), ["PayPal EUR → PayPal CAD", "PayPal EUR → PayPal CAD"]);
  assert.deepEqual(entries.map((entry) => entry.exchangeLeg), ["out", "in"]);
  assert.equal(entries[0].exchangeGroupId, "REF-EX-1");
  assert.equal(entries[1].exchangeGroupId, "REF-EX-1");
});

test("normalizePayPalTransactionDetails keeps sparse MCP invoice ids out of counterparty labels", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "4DE49858FX1604308",
        transaction_event_code: "T0200",
        transaction_initiation_date: "2026-04-22T14:30:00Z",
        transaction_amount: { value: "-8.46", currency_code: "EUR" },
        invoice_id: "2202611623284821200_1",
      }
    },
    {
      transaction_info: {
        transaction_id: "3N88835107811011F",
        transaction_event_code: "T0003",
        transaction_initiation_date: "2026-04-22T14:30:00Z",
        transaction_amount: { value: "-12.00", currency_code: "USD" },
        invoice_id: "2202611623284821200_1",
      }
    }
  ]);

  assert.equal(entries[0].displayFromTo, "PayPal EUR → PayPal EUR");
  assert.equal(entries[0].externalId, "2202611623284821200_1");
  assert.equal(entries[0].counterpartyName, "");
  assert.equal(entries[1].displayFromTo, "Me → counterparty unavailable");
  assert.equal(entries[1].counterpartyLabel, "Кому: counterparty unavailable");
  assert.equal(entries[1].counterpartyName, "");
  assert.equal(entries[1].organization, "2202611623284821200_1 | invoice 2202611623284821200_1 | event T0003");
});

test("normalizePayPalTransactionDetails ignores technical transaction subjects as readable counterparties", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "5P31220414740291C",
        transaction_event_code: "T0003",
        transaction_initiation_date: "2026-04-22T14:30:00Z",
        transaction_amount: { value: "-12.00", currency_code: "USD" },
        invoice_id: "43610720",
        transaction_subject: "42127468",
      }
    }
  ]);

  assert.equal(entries[0].displayFromTo, "Me → counterparty unavailable");
  assert.equal(entries[0].counterpartyLabel, "Кому: counterparty unavailable");
  assert.equal(entries[0].externalId, "43610720");
});

test("normalizePayPalTransactionDetails keeps refunds out of merchant expense labeling", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "REFUND-1",
        transaction_event_code: "T1107",
        transaction_initiation_date: "2026-04-25T14:30:00Z",
        transaction_amount: { value: "12.50", currency_code: "USD" },
        transaction_subject: "Refund for Software order",
        transaction_note: "Refund from merchant"
      },
      payer_info: {
        payer_name: {
          given_name: "Merchant",
          surname: "Support"
        },
        email_address: "support@example.com"
      }
    }
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].direction, "income");
  assert.equal(entries[0].entryKind, "refund");
  assert.equal(entries[0].counterpartyLabel, "От: Merchant Support");
  assert.equal(entries[0].fromEntity, "Merchant Support");
  assert.equal(entries[0].toEntity, "Me");
  assert.equal(entries[0].displayFromTo, "Merchant Support → Me");
});

test("summarizePayPalStatementEntries groups income and expense by month and currency", () => {
  const summary = summarizePayPalStatementEntries([
    { date: "2026-04-01", direction: "income", localAmount: 100, currency: "USD" },
    { date: "2026-04-02", direction: "expense", localAmount: 35.25, currency: "USD" },
    { date: "2026-04-02", direction: "exchange", localAmount: 10, currency: "USD" },
    { date: "2026-04-03", direction: "expense", localAmount: 5, currency: "EUR" },
    { date: "2026-05-01", direction: "income", localAmount: 20, currency: "USD" }
  ]);

  assert.deepEqual(summary.months, [
    {
      month: "2026-04",
      totalsByCurrency: {
        EUR: { income: 0, expense: 5, net: -5 },
        USD: { income: 100, expense: 35.25, exchange: 10, net: 64.75 }
      }
    },
    {
      month: "2026-05",
      totalsByCurrency: {
        USD: { income: 20, expense: 0, net: 20 }
      }
    }
  ]);
  assert.deepEqual(summary.totalsByCurrency.USD, { income: 120, expense: 35.25, exchange: 10, net: 84.75 });
});

test("fetchPayPalStatementEntries requests token and transactions", async () => {
  const urls = [];
  const result = await fetchPayPalStatementEntries({
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    clientId: "client",
    clientSecret: "secret",
    environment: "sandbox",
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      if (String(url).endsWith("/v1/oauth2/token")) {
        assert.match(options.headers.Authorization, /^Basic /);
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "token" };
          }
        };
      }
      assert.match(options.headers.Authorization, /^Bearer token$/);
      assert.match(String(url), /start_date=2026-04-01T00%3A00%3A00Z/);
      assert.match(String(url), /end_date=2026-04-02T23%3A59%3A59Z/);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            total_pages: 1,
            transaction_details: [
              {
                transaction_info: {
                  transaction_id: "TXN-3",
                  transaction_initiation_date: "2026-04-01T10:00:00Z",
                  transaction_amount: { value: "-5.00", currency_code: "CAD" }
                }
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(urls.length, 2);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].channel, "пейпал сad");
  assert.deepEqual(result.summary.totalsByCurrency.CAD, { income: 0, expense: 5, net: -5 });
  assert.equal(result.transactionCount, 1);
});

test("fetchPayPalStatementEntriesFromMcp refreshes OAuth and calls list_transactions", async () => {
  let streamController;
  const postedMethods = [];
  const result = await fetchPayPalStatementEntriesFromMcp({
    startDate: "2026-04-01",
    endDate: "2026-04-01",
    clientId: "mcp-client",
    refreshToken: "mcp-refresh",
    fetchImpl: async (url, options = {}) => {
      const href = String(url);
      if (href.endsWith("/token")) {
        assert.match(String(options.body), /grant_type=refresh_token/);
        assert.match(String(options.body), /client_id=mcp-client/);
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "mcp-access", expires_in: 3600 };
          }
        };
      }
      if (href.endsWith("/sse")) {
        assert.equal(options.headers.Authorization, "Bearer mcp-access");
        return {
          ok: true,
          status: 200,
          body: new ReadableStream({
            start(controller) {
              streamController = controller;
              controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /sse/message?sessionId=test\n\n"));
            },
            cancel() {}
          })
        };
      }
      if (href.includes("/sse/message?sessionId=test")) {
        const body = JSON.parse(options.body);
        postedMethods.push(body.method);
        if (body.method === "initialize") {
          streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { protocolVersion: "2024-11-05", capabilities: {}, serverInfo: { name: "PayPal MCP Agent", version: "1.0.0" } }
          })}\n\n`));
        }
        if (body.method === "tools/call") {
          assert.equal(body.params.name, "list_transactions");
          assert.equal(body.params.arguments.start_date, "2026-04-01T00:00:00Z");
          streamController.enqueue(new TextEncoder().encode(`event: message\ndata: ${JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    total_pages: 1,
                    transaction_details: [
                      {
                        transaction_info: {
                          transaction_id: "MCP-1",
                          transaction_initiation_date: "2026-04-01T18:29:03Z",
                          transaction_amount: { currency_code: "EUR", value: "-1.82" }
                        }
                      }
                    ]
                  })
                }
              ]
            }
          })}\n\n`));
        }
        return { ok: true, status: 202, async text() { return ""; } };
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }
  });

  assert.deepEqual(postedMethods, ["initialize", "notifications/initialized", "tools/call"]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].channel, "пейпал евр");
  assert.deepEqual(result.summary.totalsByCurrency.EUR, { income: 0, expense: 1.82, net: -1.82 });
});

test("fetchPayPalStatementEntriesFromMcp enriches sparse rows through REST transaction search", async () => {
  let streamController;
  const searchedUrls = [];
  const result = await fetchPayPalStatementEntriesFromMcp({
    startDate: "2026-04-01",
    endDate: "2026-04-01",
    clientId: "mcp-client",
    refreshToken: "mcp-refresh",
    restClientId: "rest-client",
    restClientSecret: "rest-secret",
    environment: "sandbox",
    fetchImpl: async (url, options = {}) => {
      const href = String(url);
      if (href === "https://mcp.paypal.com/token") {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "mcp-access", expires_in: 3600 };
          }
        };
      }
      if (href.endsWith("/v1/oauth2/token")) {
        assert.match(options.headers.Authorization, /^Basic /);
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "rest-access" };
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
              controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /sse/message?sessionId=enrich\n\n"));
            },
            cancel() {}
          })
        };
      }
      if (href.includes("/sse/message?sessionId=enrich")) {
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
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    total_pages: 1,
                    transaction_details: [
                      {
                        transaction_info: {
                          transaction_id: "MCP-ENRICH-1",
                          transaction_initiation_date: "2026-04-01T18:29:03Z",
                          transaction_amount: { currency_code: "CAD", value: "-50.00" },
                          invoice_id: "2202611623284821200_1",
                          transaction_event_code: "T0006"
                        }
                      }
                    ]
                  })
                }
              ]
            }
          })}\n\n`));
        }
        return { ok: true, status: 202, async text() { return ""; } };
      }
      if (href.includes("/v1/reporting/transactions")) {
        searchedUrls.push(href);
        assert.equal(options.headers.Authorization, "Bearer rest-access");
        assert.match(href, /transaction_id=MCP-ENRICH-1/);
        assert.match(href, /fields=all/);
        assert.match(href, /balance_affecting_records_only=N/);
        return {
          ok: true,
          status: 200,
          async json() {
            return {
              total_pages: 1,
              transaction_details: [
                {
                  transaction_info: {
                    transaction_id: "MCP-ENRICH-1",
                    transaction_initiation_date: "2026-04-01T18:29:03Z",
                    transaction_amount: { currency_code: "USD", value: "-15.00" }
                  },
                  payee_info: { payee_name: "Wrong Currency LLC" }
                },
                {
                  transaction_info: {
                    transaction_id: "MCP-ENRICH-1",
                    transaction_initiation_date: "2026-04-01T18:29:03Z",
                    transaction_amount: { currency_code: "CAD", value: "-50.00" },
                    transaction_subject: "invoice 2202611623284821200_1"
                  },
                  payee_info: {
                    email_address: "merchant@example.com",
                    payee_name: { alternate_full_name: "Merchant Company Ltd" }
                  },
                  cart_info: {
                    item_details: [{ item_name: "Technical fallback should not win" }]
                  }
                }
              ]
            };
          }
        };
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }
  });

  assert.equal(searchedUrls.length, 1);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.counterpartyDebugSamples.length, 0);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].counterpartyName, "Merchant Company Ltd");
  assert.equal(result.entries[0].counterpartyEmail, "merchant@example.com");
  assert.equal(result.entries[0].counterpartyLabel, "Кому: Merchant Company Ltd");
  assert.equal(result.entries[0].displayFromTo, "Me → Merchant Company Ltd");
  assert.equal(result.entries[0].localAmount, 50);
  assert.equal(result.entries[0].currency, "CAD");
});

test("fetchPayPalStatementEntriesFromMcp reports sanitized samples when REST enrichment is unavailable", async () => {
  let streamController;
  const result = await fetchPayPalStatementEntriesFromMcp({
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
          async json() {
            return { access_token: "mcp-access", expires_in: 3600 };
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
              controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /sse/message?sessionId=no-rest\n\n"));
            },
            cancel() {}
          })
        };
      }
      if (href.includes("/sse/message?sessionId=no-rest")) {
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
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    total_pages: 1,
                    transaction_details: [
                      {
                        transaction_info: {
                          transaction_id: "NO-REST-1",
                          transaction_initiation_date: "2026-04-01T18:29:03Z",
                          transaction_amount: { currency_code: "EUR", value: "-1.82" },
                          invoice_id: "2202611623284821200_1",
                          transaction_event_code: "T0006"
                        }
                      }
                    ]
                  })
                }
              ]
            }
          })}\n\n`));
        }
        return { ok: true, status: 202, async text() { return ""; } };
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }
  });

  assert.match(result.warnings[0], /REST enrichment skipped/);
  assert.equal(result.counterpartyDebugSamples[0].reason, "missing_rest_credentials");
  assert.equal(result.counterpartyDebugSamples[0].transactionId, "NO-REST-1");
  assert.deepEqual(result.counterpartyDebugSamples[0].detailFields, ["transaction_info"]);
  assert.equal(result.entries[0].counterpartyName, "");
  assert.equal(result.entries[0].displayFromTo, "Me → counterparty unavailable");
  assert.doesNotMatch(result.entries[0].counterpartyLabel, /invoice|event|220261/i);
});

test("handler falls back to PayPal MCP when REST credentials fail", async () => {
  const previousEnv = {
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_MCP_CLIENT_ID: process.env.PAYPAL_MCP_CLIENT_ID,
    PAYPAL_MCP_REFRESH_TOKEN: process.env.PAYPAL_MCP_REFRESH_TOKEN,
  };
  const previousFetch = global.fetch;
  let streamController;

  process.env.PAYPAL_CLIENT_ID = "bad-rest-client";
  process.env.PAYPAL_CLIENT_SECRET = "bad-rest-secret";
  process.env.PAYPAL_MCP_CLIENT_ID = "mcp-client";
  process.env.PAYPAL_MCP_REFRESH_TOKEN = "mcp-refresh";

  try {
    global.fetch = async (url, options = {}) => {
      const href = String(url);
      if (href.endsWith("/v1/oauth2/token")) {
        return {
          ok: false,
          status: 401,
          async json() {
            return { error_description: "Client Authentication failed" };
          }
        };
      }
      if (href.endsWith("/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "mcp-access", expires_in: 3600 };
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
              controller.enqueue(new TextEncoder().encode("event: endpoint\ndata: /sse/message?sessionId=fallback\n\n"));
            },
            cancel() {}
          })
        };
      }
      if (href.includes("/sse/message?sessionId=fallback")) {
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
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    total_pages: 1,
                    transaction_details: [
                      {
                        transaction_info: {
                          transaction_id: "FALLBACK-1",
                          transaction_initiation_date: "2026-04-01T18:29:03Z",
                          transaction_amount: { currency_code: "USD", value: "10.00" }
                        }
                      }
                    ]
                  })
                }
              ]
            }
          })}\n\n`));
        }
        return { ok: true, status: 202, async text() { return ""; } };
      }
      throw new Error(`Unexpected fetch: ${href}`);
    };

    const response = createResponseRecorder();
    await handler(
      { method: "POST", body: { startDate: "2026-04-01", endDate: "2026-04-01" } },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.source, "paypal-mcp");
    assert.equal(response.body.entries[0].sourceTransactionId, "FALLBACK-1");
    assert.equal(response.body.entries[0].suggestedCategory, "servicein");
  } finally {
    global.fetch = previousFetch;
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
});
