import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  normalizeRevolutTransaction,
  parseRevolutStatementRows,
  summarizeRevolutStatementEntries,
} from "../api/revolut-transactions.js";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
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

const REVOLUT_HEADERS = [
  "Completed Date UTC",
  "Started Date UTC",
  "Transaction ID",
  "Type",
  "Description",
  "Account",
  "Amount",
  "Fee",
  "Currency",
  "State",
];

test("parseRevolutStatementRows imports signed completed rows and skips pending rows", () => {
  const result = parseRevolutStatementRows([
    REVOLUT_HEADERS,
    ["2026-05-01 10:00:00", "2026-05-01 09:59:00", "rev-in-1", "TRANSFER", "Client payment", "USD account", "100.00", "0.00", "USD", "COMPLETED"],
    ["2026-05-02 11:00:00", "2026-05-02 10:59:00", "rev-out-1", "CARD_PAYMENT", "Card payment", "USD account", "-25.50", "0.50", "USD", "COMPLETED"],
    ["", "2026-05-03 12:00:00", "rev-pending", "TRANSFER", "Pending transfer", "USD account", "50.00", "", "USD", "PENDING"],
  ]);

  assert.equal(result.source, "revolut");
  assert.equal(result.entries.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.match(result.warnings.join("\n"), /pending/i);

  assert.equal(result.entries[0].source, "revolut");
  assert.equal(result.entries[0].provider, "revolut");
  assert.equal(result.entries[0].sourceTransactionId, "rev-in-1");
  assert.equal(result.entries[0].direction, "income");
  assert.equal(result.entries[0].operation, "income");
  assert.equal(result.entries[0].amount_net, 100);
  assert.equal(result.entries[0].amountNet, 100);
  assert.equal(result.entries[0].netAmount, 100);
  assert.equal(result.entries[0].channel, "REVOLUT дол");

  assert.equal(result.entries[1].sourceTransactionId, "rev-out-1");
  assert.equal(result.entries[1].direction, "expense");
  assert.equal(result.entries[1].operation, "expense");
  assert.equal(result.entries[1].amount_net, -25.5);
  assert.equal(result.entries[1].amountNet, -25.5);
  assert.equal(result.entries[1].netAmount, -25.5);
  assert.equal(result.entries[1].feeAmount, 0.5);
  assert.equal(result.entries[1].feeCurrency, "USD");
  assert.match(result.entries[1].rawMetadata, /not subtracted from amount_net/);
});

test("normalizeRevolutTransaction uses stable fallback sourceTransactionId when Transaction ID is missing", () => {
  const headerMap = {
    completedUtc: 0,
    startedUtc: 1,
    transactionId: 2,
    description: 3,
    account: 4,
    amount: 5,
    currency: 6,
    status: 7,
  };
  const row = ["2026-05-04 08:00:00", "", "", "No id payment", "USD account", "42.25", "USD", "COMPLETED"];
  const left = normalizeRevolutTransaction(row, 0, { headerMap, warnings: [], skipped: [] });
  const right = normalizeRevolutTransaction(row, 0, { headerMap, warnings: [], skipped: [] });

  assert.equal(left.sourceTransactionId, right.sourceTransactionId);
  assert.match(left.sourceTransactionId, /^[0-9a-f]{24}$/);
});

test("parseRevolutStatementRows prefers completed UTC over started/local dates", () => {
  const result = parseRevolutStatementRows([
    ["Started Date UTC", "Completed Date UTC", "Started Date Local", "Completed Date Local", "Transaction ID", "Amount", "Currency", "State"],
    ["2026-05-01 23:30:00", "2026-05-02 00:30:00", "2026-05-01 20:30:00", "2026-05-01 21:30:00", "rev-date-1", "10", "USD", "completed"],
  ]);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].date, "2026-05-02");
});

test("parseRevolutStatementRows keeps non-USD Revolut rows in review instead of forcing a channel", () => {
  const result = parseRevolutStatementRows([
    ["Completed Date UTC", "Transaction ID", "Description", "Amount", "Currency", "State"],
    ["2026-05-04 08:00:00", "rev-eur-1", "EUR payment", "10", "EUR", "completed"],
  ]);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].source, "revolut");
  assert.equal(result.entries[0].channel, "");
  assert.equal(result.entries[0].review_status, "needs_review");
  assert.match(result.warnings.join("\n"), /EUR channel is not configured/);
});

test("summarizeRevolutStatementEntries aggregates signed amount_net by currency", () => {
  const summary = summarizeRevolutStatementEntries([
    { date: "2026-05-01", currency: "USD", amount_net: 100 },
    { date: "2026-05-02", currency: "USD", amount_net: -25.5 },
  ]);

  assert.deepEqual(summary.totalsByCurrency.USD, {
    income: 100,
    expense: 25.5,
    net: 74.5,
  });
});

test("handler returns structured JSON for OPTIONS, GET and POST", async () => {
  const optionsResponse = createResponseRecorder();
  await handler({ method: "OPTIONS", body: "" }, optionsResponse);
  assert.equal(optionsResponse.statusCode, 200);
  assert.deepEqual(optionsResponse.body, { ok: true });

  const getResponse = createResponseRecorder();
  await handler({ method: "GET", body: "" }, getResponse);
  assert.equal(getResponse.statusCode, 405);
  assert.equal(getResponse.body.ok, false);
  assert.match(getResponse.body.error, /Unsupported method/);

  const postResponse = createResponseRecorder();
  await handler({
    method: "POST",
    body: JSON.stringify({
      rows: [
        REVOLUT_HEADERS,
        ["2026-05-01 10:00:00", "", "rev-in-1", "TRANSFER", "Client payment", "USD account", "100.00", "0.00", "USD", "COMPLETED"],
        ["2026-05-02 11:00:00", "", "rev-out-1", "CARD_PAYMENT", "Card payment", "USD account", "-25.50", "0.50", "USD", "COMPLETED"],
        ["", "2026-05-03 12:00:00", "rev-pending", "TRANSFER", "Pending transfer", "USD account", "50.00", "", "USD", "PENDING"],
      ],
    }),
  }, postResponse);

  assert.equal(postResponse.statusCode, 200);
  assert.equal(postResponse.body.ok, true);
  assert.equal(postResponse.body.provider, "revolut");
  assert.equal(postResponse.body.imported, 2);
  assert.equal(postResponse.body.skipped, 1);
  assert.equal(postResponse.body.errors.length, 0);
});
