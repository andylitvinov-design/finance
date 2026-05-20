import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  normalizeRevolutTransaction,
  parseRevolutStatementRows,
  summarizeRevolutStatementEntries,
} from "../server/revolut-transactions.js";

function responseRecorder() {
  return {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

const HEADERS = ["Completed Date UTC", "Started Date UTC", "Transaction ID", "Type", "Description", "Account", "Amount", "Fee", "Currency", "State"];

test("Revolut import preserves signed amount_net and skips pending rows", () => {
  const result = parseRevolutStatementRows([
    HEADERS,
    ["2026-05-01 10:00:00", "", "r-in-1", "TRANSFER", "Client", "USD", "100.00", "0.00", "USD", "COMPLETED"],
    ["2026-05-02 11:00:00", "", "r-out-1", "CARD", "Card", "USD", "-25.50", "0.50", "USD", "COMPLETED"],
    ["", "2026-05-03 12:00:00", "r-pending", "TRANSFER", "Pending", "USD", "50.00", "", "USD", "PENDING"],
  ]);

  assert.equal(result.entries.length, 2);
  assert.equal(result.skipped.length, 1);
  assert.equal(result.entries[0].source, "revolut");
  assert.equal(result.entries[0].provider, "revolut");
  assert.equal(result.entries[0].direction, "income");
  assert.equal(result.entries[0].amount_net, 100);
  assert.equal(result.entries[0].channel, "REVOLUT дол");
  assert.equal(result.entries[1].direction, "expense");
  assert.equal(result.entries[1].amount_net, -25.5);
  assert.equal(result.entries[1].feeAmount, 0.5);
  assert.match(result.warnings.join("\n"), /pending/i);
});

test("Revolut fallback sourceTransactionId is stable", () => {
  const headerMap = { completedUtc: 0, transactionId: 1, description: 2, account: 3, amount: 4, currency: 5, status: 6 };
  const row = ["2026-05-04 08:00:00", "", "No id", "USD", "42.25", "USD", "COMPLETED"];
  const left = normalizeRevolutTransaction(row, 0, { headerMap, warnings: [], skipped: [] });
  const right = normalizeRevolutTransaction(row, 0, { headerMap, warnings: [], skipped: [] });
  assert.equal(left.sourceTransactionId, right.sourceTransactionId);
  assert.match(left.sourceTransactionId, /^[0-9a-f]{24}$/);
});

test("Revolut parser prefers completed UTC date", () => {
  const result = parseRevolutStatementRows([
    ["Started Date UTC", "Completed Date UTC", "Transaction ID", "Amount", "Currency", "State"],
    ["2026-05-01 23:30:00", "2026-05-02 00:30:00", "r-date", "10", "USD", "completed"],
  ]);
  assert.equal(result.entries[0].date, "2026-05-02");
});

test("Revolut non-USD rows stay in channel review", () => {
  const result = parseRevolutStatementRows([
    ["Completed Date UTC", "Transaction ID", "Description", "Amount", "Currency", "State"],
    ["2026-05-04 08:00:00", "r-eur", "EUR", "10", "EUR", "completed"],
  ]);
  assert.equal(result.entries[0].source, "revolut");
  assert.equal(result.entries[0].channel, "");
  assert.equal(result.entries[0].review_status, "needs_review");
});

test("Revolut summary aggregates signed net movement", () => {
  const summary = summarizeRevolutStatementEntries([
    { date: "2026-05-01", currency: "USD", amount_net: 100 },
    { date: "2026-05-02", currency: "USD", amount_net: -25.5 },
  ]);
  assert.deepEqual(summary.totalsByCurrency.USD, { income: 100, expense: 25.5, net: 74.5 });
});

test("Revolut handler returns structured JSON", async () => {
  const optionsResponse = responseRecorder();
  await handler({ method: "OPTIONS", body: "" }, optionsResponse);
  assert.equal(optionsResponse.statusCode, 200);
  assert.deepEqual(optionsResponse.body, { ok: true });

  const getResponse = responseRecorder();
  await handler({ method: "GET", body: "" }, getResponse);
  assert.equal(getResponse.statusCode, 405);
  assert.equal(getResponse.body.ok, false);

  const postResponse = responseRecorder();
  await handler({ method: "POST", body: JSON.stringify({ rows: [HEADERS, ["2026-05-01 10:00:00", "", "r-in-1", "TRANSFER", "Client", "USD", "100.00", "0.00", "USD", "COMPLETED"]] }) }, postResponse);
  assert.equal(postResponse.statusCode, 200);
  assert.equal(postResponse.body.ok, true);
  assert.equal(postResponse.body.provider, "revolut");
  assert.equal(postResponse.body.imported, 1);
  assert.equal(postResponse.body.errors.length, 0);
});
