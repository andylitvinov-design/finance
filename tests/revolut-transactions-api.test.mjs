import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import handler, {
  normalizeRevolutTransaction,
  parseRevolutStatementRows,
} from "../server/revolut-transactions.js";

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
  "Completed Date",
  "Started Date",
  "Transaction ID",
  "Type",
  "Description",
  "Account",
  "Amount",
  "Fee",
  "Currency",
  "State",
];

test("inbound positive row maps to Revolut income with signed positive net", () => {
  const result = parseRevolutStatementRows([
    REVOLUT_HEADERS,
    ["2026-05-01 10:00:00", "", "", "", "rev-in-1", "TRANSFER", "Client payment", "USD current", "100.00", "0.00", "USD", "COMPLETED"],
  ]);

  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.source, "revolut");
  assert.equal(entry.provider, "revolut");
  assert.equal(entry.direction, "income");
  assert.equal(entry.operation, "income");
  assert.equal(entry.channel, "REVOLUT дол");
  assert.equal(entry.amount_net, 100);
  assert.equal(entry.amountNet, 100);
  assert.equal(entry.netAmount, 100);
  assert.equal(entry.sourceTransactionId, "rev-in-1");
});

test("outbound negative row preserves fee and does not subtract it from signed net", () => {
  const result = parseRevolutStatementRows([
    REVOLUT_HEADERS,
    ["2026-05-02 11:00:00", "", "", "", "rev-out-1", "CARD", "Card payment", "USD current", "-25.50", "0.50", "USD", "successful"],
  ]);

  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.direction, "expense");
  assert.equal(entry.operation, "expense");
  assert.equal(entry.amount_net, -25.5);
  assert.equal(entry.amountNet, -25.5);
  assert.equal(entry.netAmount, -25.5);
  assert.equal(entry.amount, 25.5);
  assert.equal(entry.feeAmount, 0.5);
  assert.equal(entry.amount_fee, 0.5);
  assert.equal(entry.feeCurrency, "USD");
});

test("pending row is skipped with structured warning", () => {
  const result = parseRevolutStatementRows([
    REVOLUT_HEADERS,
    ["2026-05-03 12:00:00", "", "", "", "rev-pending", "TRANSFER", "Pending transfer", "USD current", "50.00", "", "USD", "PENDING"],
  ]);

  assert.equal(result.entries.length, 0);
  assert.equal(result.skippedRows.length, 1);
  assert.equal(result.skippedRows[0].status, "PENDING");
  assert.match(result.warnings.join("\n"), /pending/i);
});

test("missing Transaction ID fallback is stable SHA-256 of date amount currency description account", () => {
  const headerMap = {
    completedUtc: 0,
    transactionId: 1,
    description: 2,
    account: 3,
    amount: 4,
    currency: 5,
    status: 6,
  };
  const row = ["2026-05-04 08:00:00", "", "No id transfer", "USD current", "42.25", "USD", "COMPLETED"];
  const left = normalizeRevolutTransaction(row, 0, { headerMap, warnings: [], skippedRows: [] });
  const right = normalizeRevolutTransaction(row, 0, { headerMap, warnings: [], skippedRows: [] });
  const expected = createHash("sha256")
    .update(["2026-05-04", "42.25", "USD", "No id transfer", "USD current"].join("|"))
    .digest("hex")
    .slice(0, 24);

  assert.equal(left.sourceTransactionId, expected);
  assert.equal(right.sourceTransactionId, expected);
});

test("completed UTC date wins over started UTC and local dates", () => {
  const result = parseRevolutStatementRows([
    REVOLUT_HEADERS,
    ["2026-05-06 00:30:00", "2026-05-05 23:30:00", "2026-05-07", "2026-05-08", "rev-date", "TRANSFER", "Date priority", "USD current", "10", "", "USD", "completed"],
  ]);

  assert.equal(result.entries[0].date, "2026-05-06");
});

test("non-USD row stays needs_review with blank channel when no canonical channel exists", () => {
  const result = parseRevolutStatementRows([
    REVOLUT_HEADERS,
    ["2026-05-04 08:00:00", "", "", "", "rev-mxn", "TRANSFER", "MXN transfer", "MXN current", "10", "", "MXN", "completed"],
  ]);

  assert.equal(result.entries[0].currency, "MXN");
  assert.equal(result.entries[0].channel, "");
  assert.equal(result.entries[0].amount_usd, "");
  assert.equal(result.entries[0].review_status, "needs_review");
});

test("EUR and GBP rows map to canonical Revolut channels", () => {
  const result = parseRevolutStatementRows([
    REVOLUT_HEADERS,
    ["2026-05-04 08:00:00", "", "", "", "rev-eur", "TRANSFER", "EUR transfer", "EUR current", "10", "", "EUR", "completed"],
    ["2026-05-04 09:00:00", "", "", "", "rev-gbp", "TRANSFER", "GBP transfer", "GBP current", "-7", "", "GBP", "completed"],
  ]);

  assert.deepEqual(result.entries.map((entry) => entry.channel), ["REVOLUT евро", "REVOLUT фунт"]);
  assert.deepEqual(result.entries.map((entry) => entry.review_status), ["", ""]);
});

test("summary exposes imported rows skipped rows warnings and totals by currency", () => {
  const result = parseRevolutStatementRows([
    REVOLUT_HEADERS,
    ["2026-05-01 10:00:00", "", "", "", "rev-in-1", "TRANSFER", "Client payment", "USD current", "100.00", "0.00", "USD", "COMPLETED"],
    ["2026-05-02 11:00:00", "", "", "", "rev-out-1", "CARD", "Card payment", "USD current", "-25.50", "0.50", "USD", "COMPLETED"],
    ["2026-05-03 12:00:00", "", "", "", "rev-pending", "TRANSFER", "Pending transfer", "USD current", "50.00", "", "USD", "PENDING"],
  ]);

  assert.equal(result.entries.length, 2);
  assert.equal(result.skippedRows.length, 1);
  assert.match(result.warnings.join("\n"), /pending/i);
  assert.deepEqual(result.summary.totalsByCurrency.USD, {
    income: 100,
    expense: 25.5,
    net: 74.5,
  });
});

test("handler OPTIONS returns 200 structured JSON", async () => {
  const response = createResponseRecorder();
  await handler({ method: "OPTIONS", body: "" }, response);

  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.deepEqual(response.body, { ok: true });
});

test("handler GET returns 405 structured JSON", async () => {
  const response = createResponseRecorder();
  await handler({ method: "GET", body: "" }, response);

  assert.equal(response.statusCode, 405);
  assert.equal(response.body.ok, false);
  assert.equal(response.body.provider, "revolut");
  assert.equal(response.body.source, "revolut");
  assert.equal(response.body.imported, 0);
  assert.equal(response.body.skipped, 0);
  assert.deepEqual(response.body.entries, []);
});

test("handler POST fixture returns imported and skipped counts", async () => {
  const response = createResponseRecorder();
  await handler({
    method: "POST",
    body: JSON.stringify({
      rows: [
        REVOLUT_HEADERS,
        ["2026-05-01 10:00:00", "", "", "", "rev-in-1", "TRANSFER", "Client payment", "USD current", "100.00", "0.00", "USD", "COMPLETED"],
        ["2026-05-02 11:00:00", "", "", "", "rev-out-1", "CARD", "Card payment", "USD current", "-25.50", "0.50", "USD", "COMPLETED"],
        ["2026-05-03 12:00:00", "", "", "", "rev-pending", "TRANSFER", "Pending transfer", "USD current", "50.00", "", "USD", "PENDING"],
      ],
      dryRun: true,
    }),
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.provider, "revolut");
  assert.equal(response.body.source, "revolut");
  assert.equal(response.body.imported, 2);
  assert.equal(response.body.skipped, 1);
  assert.equal(response.body.entries.length, 2);
  assert.equal(response.body.skippedRows.length, 1);
  assert.deepEqual(response.body.errors, []);
  assert.match(response.body.warnings.join("\n"), /pending/i);
});
