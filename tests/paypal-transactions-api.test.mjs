import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  buildPayPalProviderWarning,
  fetchPayPalStatementEntries,
  fetchPayPalStatementEntriesFromMcp,
  getReadablePayPalCounterparty,
  normalizePayPalTransactionDetails,
  parsePayPalManualActivityRows,
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
  assert.equal(entries[2].amountGross, 20);
  assert.equal(entries[2].amountFee, null);
  assert.equal(entries[2].amountNet, null);
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
  assert.equal(income?.amountGross, 324);
  assert.equal(income?.amountFee, 12.94);
  assert.equal(income?.amountNet, 311.06);
  assert.equal(income?.usdAmount, 311.06);
  assert.equal(income?.feeAmount, 12.94);
  assert.equal(income?.feeCurrency, "USD");
});

test("normalizePayPalTransactionDetails does not set net without explicit fee", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "TXN-NOFEE",
        transaction_initiation_date: "2026-04-23T10:00:00Z",
        transaction_amount: { value: "100.00", currency_code: "USD" },
      }
    }
  ]);

  const income = entries.find((entry) => entry.direction === "income");
  assert.equal(income?.amountGross, 100);
  assert.equal(income?.amountFee, null);
  assert.equal(income?.amountNet, null);
  assert.equal(income?.usdAmount, null);
});

test("parsePayPalManualActivityRows keeps generic manual PayPal net unconfirmed", () => {
  const { entries } = parsePayPalManualActivityRows([
    { date: "2026-05-13", name: "Booking.com BV", amount: "-€27.14", type: "Payment" }
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].date, "2026-05-13");
  assert.equal(entries[0].counterpartyName, "Booking.com BV");
  assert.equal(entries[0].direction, "expense");
  assert.equal(entries[0].currency, "EUR");
  assert.equal(entries[0].source, "paypal_manual");
  assert.equal(entries[0].amount_net, null);
  assert.equal(entries[0].amount_gross, -27.14);
  assert.equal(entries[0].feeAmount, null);
  assert.equal(entries[0].fee_missing, true);
  assert.equal(entries[0].needs_provider_permission, true);
  assert.equal(entries[0].net_source, "unconfirmed");
});

test("parsePayPalManualActivityRows sets net only with explicit manual confirmation marker", () => {
  const { entries } = parsePayPalManualActivityRows([
    { date: "2026-05-13", name: "Booking.com BV", amount: "-€27.14", type: "Payment", net_source: "manual_confirmed" },
    { date: "2026-05-11", counterparty: "Client", amount: "+€36", type: "Refund", source: "paypal_personal_manual" }
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].source, "paypal_personal_manual");
  assert.equal(entries[0].amount_net, -27.14);
  assert.equal(entries[0].net_source, "manual_confirmed");
  assert.equal(entries[0].manual_confirmation_marker, "manual_confirmed");
  assert.equal(entries[1].source, "paypal_personal_manual");
  assert.equal(entries[1].amount_net, 36);
  assert.equal(entries[1].net_source, "manual_confirmed");
});

test("parsePayPalManualActivityRows keeps USD and CAD separate from EUR", () => {
  const { entries, summary } = parsePayPalManualActivityRows([
    { date: "2026-05-13", counterparty: "NEXCESS.NET", amount: "-US$42.44", type: "Payment" },
    { date: "2026-04-21", counterparty: "Uber Holdings Canada", amount: "-$13 CAD", type: "Payment" }
  ]);

  assert.equal(entries.length, 2);
  assert.equal(entries[0].currency, "USD");
  assert.equal(entries[0].amount_gross, -42.44);
  assert.equal(entries[0].amount_net, null);
  assert.equal(entries[1].currency, "CAD");
  assert.equal(entries[1].amount_gross, -13);
  assert.equal(entries[1].amount_net, null);
  assert.deepEqual(summary.totalsByCurrency.map((row) => row.currency), ["CAD", "USD"]);
});

test("parsePayPalManualActivityRows classifies refunds as expense corrections, not service income", () => {
  const { entries } = parsePayPalManualActivityRows([
    { date: "2026-05-11", counterparty: "BOOKING HOLDINGS", amount: "+€36", type: "Refund" }
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].direction, "income");
  assert.equal(entries[0].entryKind, "refund");
  assert.equal(entries[0].operationType, "refund");
  assert.equal(entries[0].suggestedCategory, "business");
  assert.equal(entries[0].is_refund, true);
  assert.equal(entries[0].amount_gross, 36);
  assert.equal(entries[0].amount_net, null);
});

test("parsePayPalManualActivityRows de-duplicates stable manual PayPal rows", () => {
  const rows = [
    { date: "2026-05-13", counterparty: "Booking.com BV", amount: "-€27.14", type: "Payment" },
    { date: "2026-05-13", counterparty: "Booking.com BV", amount: "-€27.14", type: "Payment" }
  ];
  const { entries, duplicateCount } = parsePayPalManualActivityRows(rows);

  assert.equal(entries.length, 1);
  assert.equal(duplicateCount, 1);
  assert.equal(entries[0].sourceTransactionId, "paypal_manual:2026-05-13:booking-com-bv:-27-14:eur:payment");
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

test("normalizePayPalTransactionDetails extracts sandbox REST payee business and email fields", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "SANDBOX-PAYOUT-1",
        transaction_event_code: "T0006",
        transaction_initiation_date: "2026-04-20T14:30:00Z",
        transaction_amount: { value: "-42.00", currency_code: "USD" },
        invoice_id: "INV-SANDBOX-1",
        custom_field: "CUSTOM-SANDBOX-1",
        transaction_subject: "INV-SANDBOX-1",
      },
      payee_info: {
        payee_name: {
          alternate_full_name: "Sandbox Merchant LLC"
        },
        email_address: "merchant-facilitator@example.com"
      },
      cart_info: {
        merchant_name: "Lower Priority Merchant",
        item_details: [{ item_name: "Sandbox test item" }]
      }
    }
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].direction, "expense");
  assert.equal(entries[0].counterpartyName, "Sandbox Merchant LLC");
  assert.equal(entries[0].counterpartyEmail, "merchant-facilitator@example.com");
  assert.equal(entries[0].counterpartyType, "company");
  assert.equal(entries[0].counterpartyRole, "payee");
  assert.equal(entries[0].counterpartyLabel, "Кому: Sandbox Merchant LLC");
  assert.equal(entries[0].displayFromTo, "Me → Sandbox Merchant LLC");
  assert.equal(entries[0].externalId, "INV-SANDBOX-1");
});

test("normalizePayPalTransactionDetails extracts sandbox REST payer person and email fields", () => {
  const entries = normalizePayPalTransactionDetails([
    {
      transaction_info: {
        transaction_id: "SANDBOX-INCOME-1",
        transaction_event_code: "T0003",
        transaction_initiation_date: "2026-04-21T10:00:00Z",
        transaction_amount: { value: "120.00", currency_code: "EUR" },
        transaction_subject: "SANDBOX-INCOME-1",
      },
      payer_info: {
        payer_name: {
          alternate_full_name: "Sandbox Buyer"
        },
        email_address: "buyer@example.com"
      }
    }
  ]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0].direction, "income");
  assert.equal(entries[0].counterpartyName, "Sandbox Buyer");
  assert.equal(entries[0].counterpartyEmail, "buyer@example.com");
  assert.equal(entries[0].counterpartyType, "person");
  assert.equal(entries[0].counterpartyRole, "payer");
  assert.equal(entries[0].counterpartyLabel, "От: Sandbox Buyer");
  assert.equal(entries[0].displayFromTo, "Sandbox Buyer → Me");
  assert.equal(entries[0].externalId, "SANDBOX-INCOME-1");
});

test("getReadablePayPalCounterparty keeps sandbox technical ids below readable merchant fields", () => {
  const readable = getReadablePayPalCounterparty({
    transaction_info: {
      transaction_id: "SANDBOX-TECH-1",
      invoice_id: "INV-TECH-1",
      custom_field: "CUSTOM-TECH-1",
      transaction_subject: "INV-TECH-1",
      transaction_note: "event T0006"
    },
    payee_info: {
      email_address: "merchant@example.com"
    }
  }, {
    direction: "expense",
    info: {
      transaction_id: "SANDBOX-TECH-1",
      invoice_id: "INV-TECH-1",
      custom_field: "CUSTOM-TECH-1",
      transaction_subject: "INV-TECH-1",
      transaction_note: "event T0006"
    }
  });

  assert.equal(readable.label, "merchant@example.com");
  assert.equal(readable.email, "merchant@example.com");
  assert.equal(readable.unavailable, false);
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

test("fetchPayPalStatementEntries warns when income fee is missing", async () => {
  const result = await fetchPayPalStatementEntries({
    startDate: "2026-04-01",
    endDate: "2026-04-01",
    clientId: "client",
    clientSecret: "secret",
    environment: "sandbox",
    fetchImpl: async (url, options) => {
      if (String(url).endsWith("/v1/oauth2/token")) {
        return {
          ok: true,
          status: 200,
          async json() {
            return { access_token: "token" };
          }
        };
      }
      assert.match(options.headers.Authorization, /^Bearer token$/);
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            total_pages: 1,
            transaction_details: [
              {
                transaction_info: {
                  transaction_id: "TXN-NOFEE",
                  transaction_initiation_date: "2026-04-01T10:00:00Z",
                  transaction_amount: { value: "100", currency_code: "USD" }
                }
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(result.entries[0].amountNet, null);
  assert.equal(result.entries[0].usdAmount, null);
  assert.equal(result.entries[0].sourceTransactionId, "TXN-NOFEE");
  assert.match(String(result.warnings[0] || ""), /missing fee on income transaction TXN-NOFEE/);
});

test("buildPayPalProviderWarning reports auth and transaction search permission failures", () => {
  const oauthError = new Error("Client Authentication failed");
  oauthError.paypalStatus = 401;
  assert.equal(
    buildPayPalProviderWarning(oauthError, { environment: "live" }),
    "PayPal fee unavailable due to API permissions/auth (environment: live; verify live vs sandbox app credentials)."
  );

  const searchError = new Error("Insufficient permissions for Transaction Search");
  searchError.paypalStatus = 403;
  assert.equal(
    buildPayPalProviderWarning(searchError, { environment: "sandbox" }),
    "PayPal fee unavailable due to API permissions/auth."
  );
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
    PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENVIRONMENT,
  };
  const previousFetch = global.fetch;
  let streamController;

  process.env.PAYPAL_CLIENT_ID = "bad-rest-client";
  process.env.PAYPAL_CLIENT_SECRET = "bad-rest-secret";
  process.env.PAYPAL_MCP_CLIENT_ID = "mcp-client";
  process.env.PAYPAL_MCP_REFRESH_TOKEN = "mcp-refresh";
  process.env.PAYPAL_ENVIRONMENT = "live";

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
    assert.equal(response.body.providerStatus, "auth_failed");
    assert.equal(response.body.phase, "oauth");
    assert.deepEqual(response.body.paypalRest, {
      providerStatus: "auth_failed",
      phase: "oauth",
      environment: "live",
      baseUrl: "https://api-m.paypal.com",
      hasClientId: true,
      hasClientSecret: true,
      maskedClientId: "bad-...ient"
    });
    assert.match(response.body.warnings.join(" | "), /PayPal fee unavailable due to API permissions\/auth/);
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

test("handler returns structured auth_failed diagnostics when PayPal REST OAuth is rejected", async () => {
  const previousEnv = {
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_MCP_CLIENT_ID: process.env.PAYPAL_MCP_CLIENT_ID,
    PAYPAL_MCP_REFRESH_TOKEN: process.env.PAYPAL_MCP_REFRESH_TOKEN,
    PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENVIRONMENT,
  };
  const previousFetch = global.fetch;

  process.env.PAYPAL_CLIENT_ID = "live-client-1234";
  process.env.PAYPAL_CLIENT_SECRET = "bad-rest-secret";
  delete process.env.PAYPAL_MCP_CLIENT_ID;
  delete process.env.PAYPAL_MCP_REFRESH_TOKEN;
  process.env.PAYPAL_ENVIRONMENT = "live";

  try {
    global.fetch = async (url) => {
      assert.match(String(url), /api-m\.paypal\.com\/v1\/oauth2\/token$/);
      return {
        ok: false,
        status: 401,
        async json() {
          return { error: "invalid_client", error_description: "Client Authentication failed" };
        }
      };
    };

    const response = createResponseRecorder();
    await handler(
      { method: "POST", body: { startDate: "2026-05-01", endDate: "2026-05-20" } },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.provider, "paypal");
    assert.equal(response.body.providerStatus, "auth_failed");
    assert.equal(response.body.phase, "oauth");
    assert.equal(response.body.paypalRest.environment, "live");
    assert.equal(response.body.paypalRest.baseUrl, "https://api-m.paypal.com");
    assert.equal(response.body.paypalRest.hasClientId, true);
    assert.equal(response.body.paypalRest.hasClientSecret, true);
    assert.equal(response.body.paypalRest.maskedClientId, "live...1234");
    assert.match(response.body.warnings.join(" | "), /PayPal REST import failed: PayPal OAuth failed \(401\): Client Authentication failed/);
    assert.match(response.body.shortExcerpt, /PayPal OAuth failed \(401\): Client Authentication failed/);
    assert.doesNotMatch(JSON.stringify(response.body), /bad-rest-secret/);
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

test("handler classifies PayPal MCP grant-not-found refresh failures without leaking tokens", async () => {
  const previousEnv = {
    PAYPAL_CLIENT_ID: process.env.PAYPAL_CLIENT_ID,
    PAYPAL_CLIENT_SECRET: process.env.PAYPAL_CLIENT_SECRET,
    PAYPAL_MCP_CLIENT_ID: process.env.PAYPAL_MCP_CLIENT_ID,
    PAYPAL_MCP_REFRESH_TOKEN: process.env.PAYPAL_MCP_REFRESH_TOKEN,
    PAYPAL_ENVIRONMENT: process.env.PAYPAL_ENVIRONMENT,
  };
  const previousFetch = global.fetch;

  process.env.PAYPAL_CLIENT_ID = "live-client-1234";
  process.env.PAYPAL_CLIENT_SECRET = "bad-rest-secret";
  process.env.PAYPAL_MCP_CLIENT_ID = "mcp-client-5678";
  process.env.PAYPAL_MCP_REFRESH_TOKEN = "mcp-refresh-secret-token";
  process.env.PAYPAL_ENVIRONMENT = "live";

  try {
    global.fetch = async (url) => {
      const href = String(url);
      if (href.endsWith("/v1/oauth2/token")) {
        return {
          ok: false,
          status: 401,
          async json() {
            return { error: "invalid_client", error_description: "Client Authentication failed" };
          }
        };
      }
      if (href === "https://mcp.paypal.com/token") {
        return {
          ok: false,
          status: 400,
          async json() {
            return { error: "invalid_grant", error_description: "Grant not found" };
          }
        };
      }
      throw new Error(`Unexpected fetch: ${href}`);
    };

    const response = createResponseRecorder();
    await handler(
      { method: "POST", body: { startDate: "2026-05-01", endDate: "2026-06-02" } },
      response
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.providerStatus, "mcp_grant_not_found");
    assert.equal(response.body.phase, "mcp_token");
    assert.equal(response.body.paypalRest.providerStatus, "auth_failed");
    assert.equal(response.body.paypalRest.phase, "oauth");
    assert.equal(response.body.paypalRest.environment, "live");
    assert.equal(response.body.paypalRest.hasClientId, true);
    assert.equal(response.body.paypalRest.hasClientSecret, true);
    assert.equal(response.body.paypalRest.maskedClientId, "live...1234");
    assert.deepEqual(response.body.paypalMcp, {
      phase: "mcp_token",
      providerStatus: "mcp_grant_not_found",
      hasClientId: true,
      hasRefreshToken: true
    });
    assert.match(response.body.shortExcerpt, /PayPal MCP token refresh failed \(400\): Grant not found/);
    assert.match(response.body.warnings.join(" | "), /PayPal REST import failed: PayPal OAuth failed \(401\): Client Authentication failed/);
    assert.doesNotMatch(JSON.stringify(response.body), /bad-rest-secret|mcp-refresh-secret-token/);
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
