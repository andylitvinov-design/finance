import test from "node:test";
import assert from "node:assert/strict";

import handler, {
  normalizePayoneerTransaction,
  parsePayoneerStatementRows,
  summarizePayoneerStatementEntries,
} from "../server/payoneer-transactions.js";

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
    },
  };
}

test("parsePayoneerStatementRows maps income with gross fee and net to ledger entry", () => {
  const result = parsePayoneerStatementRows([
    ["Transaction Date", "Transaction ID", "Description", "Currency", "Gross Amount", "Fee", "Net Amount"],
    ["2026-05-10", "PYO-IN-1", "Client payment", "USD", "100.00", "3.00", "97.00"],
  ]);

  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.date, "2026-05-10");
  assert.equal(entry.channel, "Payoneer - dol");
  assert.equal(entry.direction, "income");
  assert.equal(entry.localAmount, 97);
  assert.equal(entry.grossAmount, 100);
  assert.equal(entry.feeAmount, 3);
  assert.equal(entry.netAmount, 97);
  assert.equal(entry.amount_net, 97);
  assert.equal(entry.source, "payoneer");
  assert.equal(entry.sourceTransactionId, "PYO-IN-1");
  assert.equal(entry.usdAmount, 97);
});

test("parsePayoneerStatementRows supports decorated real export headers", () => {
  const result = parsePayoneerStatementRows([
    ["Transaction Date (UTC)", "Reference Number", "Transaction Description", "Currency Code", "Gross Amount (USD)", "Transaction Fee (USD)", "Net Amount (USD)"],
    ["2026-05-14 12:30:00", "PYO-REAL-1", "Payment from client", "USD", "$1,000.00", "$30.00", "$970.00"],
  ]);

  assert.equal(result.entries.length, 1);
  const entry = result.entries[0];
  assert.equal(entry.date, "2026-05-14");
  assert.equal(entry.channel, "Payoneer - dol");
  assert.equal(entry.direction, "income");
  assert.equal(entry.sourceTransactionId, "PYO-REAL-1");
  assert.equal(entry.grossAmount, 1000);
  assert.equal(entry.feeAmount, 30);
  assert.equal(entry.netAmount, 970);
  assert.equal(entry.amount_net, 970);
  assert.deepEqual(result.warnings, []);
});

test("normalizePayoneerTransaction determines expense before amount normalization", () => {
  const headerMap = {
    date: 0,
    id: 1,
    description: 2,
    currency: 3,
    amount: 4,
  };
  const warnings = [];
  const entry = normalizePayoneerTransaction(
    ["2026-05-11", "PYO-OUT-1", "Withdrawal to bank", "USD", "-42.50"],
    0,
    { headerMap, warnings }
  );

  assert.equal(entry.direction, "expense");
  assert.equal(entry.localAmount, 42.5);
  assert.equal(entry.netAmount, null);
  assert.equal(entry.amount_net, "");
  assert.equal(entry.feeAmount, null);
  assert.match(warnings.join(" | "), /fee is missing/);
  assert.match(warnings.join(" | "), /net amount is missing/);
});

test("parsePayoneerStatementRows keeps missing fee structured and does not fake fee", () => {
  const result = parsePayoneerStatementRows([
    ["Date", "Reference ID", "Details", "Currency", "Net"],
    ["2026-05-12", "PYO-NOFEE", "Client payment", "EUR", "88.00"],
  ]);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].channel, "Payoneer - eur");
  assert.equal(result.entries[0].feeAmount, null);
  assert.equal(result.entries[0].amount_fee, "");
  assert.equal(result.entries[0].netAmount, 88);
  assert.match(result.warnings.join(" | "), /PYO-NOFEE: Payoneer fee is missing/);
});

test("parsePayoneerStatementRows does not use gross as net when fee and net are missing", () => {
  const result = parsePayoneerStatementRows([
    ["Date", "Reference ID", "Details", "Currency", "Gross Amount"],
    ["2026-05-12", "PYO-GROSSONLY", "Client payment", "USD", "120.00"],
  ]);

  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].grossAmount, 120);
  assert.equal(result.entries[0].netAmount, null);
  assert.equal(result.entries[0].amount_net, "");
  assert.match(result.warnings.join(" | "), /PYO-GROSSONLY: Payoneer net amount is missing/);
});

test("parsePayoneerStatementRows preserves duplicate source transaction ids", () => {
  const result = parsePayoneerStatementRows([
    ["Date", "Payment ID", "Details", "Currency", "Amount", "Fee", "Net"],
    ["2026-05-13", "PYO-DUP", "Client payment", "USD", "50.00", "2.00", "48.00"],
    ["2026-05-13", "PYO-DUP", "Client payment duplicate", "USD", "50.00", "2.00", "48.00"],
  ]);

  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].sourceTransactionId, "PYO-DUP");
  assert.equal(result.entries[1].sourceTransactionId, "PYO-DUP");
});

test("parsePayoneerStatementRows summarizes by month and currency", () => {
  const summary = summarizePayoneerStatementEntries([
    { date: "2026-05-01", direction: "income", localAmount: 97, currency: "USD" },
    { date: "2026-05-02", direction: "expense", localAmount: 12, currency: "USD" },
    { date: "2026-06-01", direction: "income", localAmount: 20, currency: "EUR" },
  ]);

  assert.deepEqual(summary.months, [
    { month: "2026-05", totalsByCurrency: { USD: { income: 97, expense: 12, net: 85 } } },
    { month: "2026-06", totalsByCurrency: { EUR: { income: 20, expense: 0, net: 20 } } },
  ]);
});

test("handler returns JSON 405 for GET", async () => {
  const response = createResponseRecorder();
  await handler({ method: "GET", body: null }, response);

  assert.equal(response.statusCode, 405);
  assert.match(response.headers["content-type"], /application\/json/);
  assert.deepEqual(response.body, { ok: false, error: "Unsupported method: GET" });
});

test("handler returns structured error for missing required columns", async () => {
  const response = createResponseRecorder();
  await handler({
    method: "POST",
    body: JSON.stringify({
      text: "Unknown,Header\nvalue,123",
    }),
  }, response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.body.ok, false);
  assert.match(response.body.error, /header was not found|required column/);
  assert.doesNotMatch(response.body.error, /SyntaxError|<html/i);
});

test("handler imports sample CSV as structured JSON", async () => {
  const response = createResponseRecorder();
  await handler({
    method: "POST",
    body: JSON.stringify({
      text: [
        "Date,Transaction ID,Description,Currency,Gross Amount,Service Fee,Net Amount",
        "2026-05-10,PYO-IN-1,Client payment,USD,100.00,3.00,97.00",
      ].join("\n"),
      dryRun: true,
    }),
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.source, "payoneer");
  assert.equal(response.body.entries.length, 1);
  assert.equal(response.body.summary.totalsByCurrency.USD.net, 97);
  assert.deepEqual(response.body.warnings, []);
});
