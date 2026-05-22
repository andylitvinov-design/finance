import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWiseImportDiagnostics,
  fetchWiseBalances,
  fetchWiseStatementEntries,
  normalizeWiseTransaction,
  summarizeWiseStatementEntries,
} from "../api/wise-transactions.js";

test("normalizeWiseTransaction maps Wise statements to expense entries with description", () => {
  const entry = normalizeWiseTransaction(
    {
      type: "DEBIT",
      date: "2026-04-20T12:00:00.000Z",
      referenceNumber: "WISE-1",
      amount: { value: "-12.34", currency: "USD" },
      totalFees: { value: "0.44", currency: "USD" },
      details: {
        description: "Card payment to Vendor",
        type: "CARD"
      }
    },
    { id: "balance-1", currency: "USD" },
    "profile-1"
  );

  assert.equal(entry.date, "2026-04-20");
  assert.equal(entry.channel, "трансервайз дол");
  assert.equal(entry.direction, "expense");
  assert.equal(entry.localAmount, 12.34);
  assert.equal(entry.localCurrency, "USD");
  assert.equal(entry.accountAmount, 12.34);
  assert.equal(entry.amountNet, 12.34);
  assert.equal(entry.netAmount, 12.34);
  assert.equal(entry.amountFee, 0.44);
  assert.equal(entry.amount_net, 12.34);
  assert.equal(entry.raw_source_id, "WISE-1");
  assert.equal(entry.external_id, "WISE-1");
  assert.equal(entry.feeAmount, 0.44);
  assert.equal(entry.feeCurrency, "USD");
  assert.equal(entry.organization, "Card payment to Vendor | CARD | reference WISE-1 | balance USD | profile profile-1");
  assert.equal(entry.counterpartyName, "Vendor");
  assert.equal(entry.counterpartyEmail, "");
  assert.equal(entry.counterpartyType, "company");
  assert.equal(entry.counterpartyRole, "merchant");
  assert.equal(entry.counterpartyLabel, "Кому: Vendor");
  assert.equal(entry.merchantName, "Vendor");
  assert.equal(entry.referenceNumber, "WISE-1");
  assert.equal(entry.transferType, "CARD");
  assert.equal(entry.description, "Card payment to Vendor");
});

test("normalizeWiseTransaction keeps Wise card operation date ahead of settlement date", () => {
  const entry = normalizeWiseTransaction(
    {
      type: "DEBIT",
      date: "2026-05-12T09:00:00.000Z",
      operationDate: "2026-05-09T20:15:00.000Z",
      settlementDate: "2026-05-12T09:00:00.000Z",
      referenceNumber: "CARD-SETTLED-LATE",
      amount: { value: "-128.08", currency: "USD" },
      totalFees: { value: "0.37", currency: "USD" },
      details: {
        description: "Card transaction of 108.36 EUR issued by YellowSquare",
        type: "CARD"
      }
    },
    { id: "balance-usd", currency: "USD" },
    "profile-1"
  );

  assert.equal(entry.date, "2026-05-09");
  assert.equal(entry.operationDate, "2026-05-09");
  assert.equal(entry.postedDate, "2026-05-12");
});

test("normalizeWiseTransaction stores EUR card purchase as Wise USD balance movement", () => {
  const entry = normalizeWiseTransaction(
    {
      type: "DEBIT",
      date: "2026-05-09T20:15:00.000Z",
      referenceNumber: "CARD-3771546317",
      amount: { value: "-128.08", currency: "USD" },
      totalFees: { value: "0.37", currency: "USD" },
      details: {
        description: "Card transaction of 108.36 EUR issued by YellowSquare",
        type: "CARD"
      }
    },
    { id: "balance-usd", currency: "USD" },
    "profile-1"
  );

  assert.equal(entry.direction, "expense");
  assert.equal(entry.channel, "трансервайз дол");
  assert.equal(entry.currency, "USD");
  assert.equal(entry.accountAmount, 128.08);
  assert.equal(entry.amountNet, 128.08);
  assert.equal(entry.usdAmount, 128.08);
  assert.equal(entry.localAmount, 108.36);
  assert.equal(entry.localCurrency, "EUR");
  assert.match(entry.comment, /108\.36 EUR/);
});

test("normalizeWiseTransaction keeps card fee informational and does not subtract it from amount_net", () => {
  const entry = normalizeWiseTransaction(
    {
      type: "DEBIT",
      date: "2026-05-16T09:00:00.000Z",
      referenceNumber: "CARD-FEE-1",
      amount: { value: "-142.71", currency: "USD" },
      totalFees: { value: "0.41", currency: "USD" },
      details: {
        description: "Card transaction of 121.00 EUR issued by Vendor",
        type: "CARD"
      }
    },
    { id: "balance-usd", currency: "USD" },
    "profile-1"
  );

  assert.equal(entry.direction, "expense");
  assert.equal(entry.accountAmount, 142.71);
  assert.equal(entry.amountNet, 142.71);
  assert.equal(entry.netAmount, 142.71);
  assert.equal(entry.feeAmount, 0.41);
  assert.equal(entry.amountFee, 0.41);
  assert.equal(entry.localAmount, 121);
  assert.equal(entry.localCurrency, "EUR");
});

test("normalizeWiseTransaction builds stable raw_source_id when Wise reference is missing", () => {
  const entry = normalizeWiseTransaction(
    {
      type: "DEBIT",
      date: "2026-05-17T09:00:00.000Z",
      amount: { value: "-20", currency: "USD" },
      details: {
        description: "Card payment to Vendor",
        type: "CARD"
      }
    },
    { id: "balance-usd", currency: "USD" },
    "profile-1",
    3
  );

  assert.equal(entry.sourceTransactionId, "balance-usd-2026-05-17--20-USD-3");
  assert.equal(entry.raw_source_id, entry.sourceTransactionId);
  assert.equal(entry.external_id, entry.sourceTransactionId);
});

test("buildWiseImportDiagnostics reports coverage, duplicate raw_source_id, and no fee double debit for a single card row", () => {
  const entries = [
    normalizeWiseTransaction(
      {
        type: "DEBIT",
        date: "2026-05-16T09:00:00.000Z",
        referenceNumber: "CARD-DUPLICATE",
        amount: { value: "-142.71", currency: "USD" },
        totalFees: { value: "0.41", currency: "USD" },
        details: {
          description: "Card transaction of 121.00 EUR issued by Vendor",
          type: "CARD"
        }
      },
      { id: "balance-usd", currency: "USD" },
      "profile-1",
      0
    ),
    normalizeWiseTransaction(
      {
        type: "DEBIT",
        date: "2026-05-16T09:00:00.000Z",
        referenceNumber: "CARD-DUPLICATE",
        amount: { value: "-142.71", currency: "USD" },
        totalFees: { value: "0.41", currency: "USD" },
        details: {
          description: "Card transaction of 121.00 EUR issued by Vendor",
          type: "CARD"
        }
      },
      { id: "balance-usd", currency: "USD" },
      "profile-1",
      1
    )
  ];

  const diagnostics = buildWiseImportDiagnostics({
    rawTransactions: [{}, {}],
    normalizedEntries: entries,
    entries,
    periodStart: "2026-05-01",
    periodEnd: "2026-05-22"
  });

  assert.equal(diagnostics.coverage.input_rows_count, 2);
  assert.equal(diagnostics.coverage.parsed_rows_count, 2);
  assert.equal(diagnostics.coverage.ledger_rows_count, 2);
  assert.equal(diagnostics.coverage.duplicate_rows_count, 1);
  assert.equal(diagnostics.coverage.needs_review_rows_count, 0);
  assert.equal(diagnostics.coverage.hard_fail, false);
  assert.equal(diagnostics.fee_double_count.likely_fee_double_count, false);
  assert.match(diagnostics.warnings.join("\n"), /duplicate raw_source_id wise:CARD-DUPLICATE/);
});

test("normalizeWiseTransaction treats CARD transactions as expense before amount normalization", () => {
  const entry = normalizeWiseTransaction(
    {
      type: "CREDIT",
      date: "2026-05-08T12:00:00.000Z",
      referenceNumber: "CARD-3766611855",
      amount: { value: "4.40", currency: "USD" },
      details: {
        description: "Card transaction at Bolt",
        type: "CARD"
      }
    },
    { id: "balance-1", currency: "USD" },
    "profile-1"
  );

  assert.equal(entry.sourceTransactionId, "CARD-3766611855");
  assert.equal(entry.direction, "expense");
  assert.equal(entry.suggestedCategory, "business");
  assert.equal(entry.localAmount, 4.4);
});

test("normalizeWiseTransaction falls back to description when merchant name is not extractable", () => {
  const entry = normalizeWiseTransaction(
    {
      type: "CREDIT",
      date: "2026-04-21T08:00:00.000Z",
      referenceNumber: "WISE-2",
      amount: { value: "88.00", currency: "EUR" },
      details: {
        description: "Invoice 441 from consulting client",
        type: "TRANSFER"
      }
    },
    { id: "balance-2", currency: "EUR" },
    "profile-2"
  );

  assert.equal(entry.direction, "income");
  assert.equal(entry.counterpartyName, "");
  assert.equal(entry.counterpartyEmail, "");
  assert.equal(entry.counterpartyLabel, "От: Invoice 441 from consulting client");
});

test("summarizeWiseStatementEntries groups income and expense by month and currency", () => {
  const summary = summarizeWiseStatementEntries([
    { date: "2026-04-01", direction: "income", localAmount: 50, currency: "EUR" },
    { date: "2026-04-02", direction: "expense", localAmount: 12.5, currency: "EUR" },
    { date: "2026-05-01", direction: "expense", localAmount: 8, currency: "USD" }
  ]);

  assert.deepEqual(summary.months, [
    {
      month: "2026-04",
      totalsByCurrency: {
        EUR: { income: 50, expense: 12.5, net: 37.5 }
      }
    },
    {
      month: "2026-05",
      totalsByCurrency: {
        USD: { income: 0, expense: 8, net: -8 }
      }
    }
  ]);
});

test("summarizeWiseStatementEntries uses Wise account amount by operation date for card purchases", () => {
  const summary = summarizeWiseStatementEntries([
    { date: "2026-05-09", direction: "expense", localAmount: 108.36, localCurrency: "EUR", accountAmount: 128.08, currency: "USD" },
    { date: "2026-05-09", direction: "expense", localAmount: 5.35, localCurrency: "EUR", accountAmount: 6.33, currency: "USD" },
    { date: "2026-05-09", direction: "expense", localAmount: 3, localCurrency: "EUR", accountAmount: 3.55, currency: "USD" },
    { date: "2026-05-12", direction: "expense", localAmount: 6.96, localCurrency: "EUR", accountAmount: 8.19, currency: "USD" },
    { date: "2026-05-12", direction: "expense", localAmount: 5.89, localCurrency: "EUR", accountAmount: 6.93, currency: "USD" },
    { date: "2026-05-12", direction: "expense", localAmount: 2.1, localCurrency: "EUR", accountAmount: 2.48, currency: "USD" },
    { date: "2026-05-12", direction: "expense", localAmount: 30, localCurrency: "EUR", accountAmount: 35.34, currency: "USD" }
  ]);

  assert.deepEqual(summary.months, [
    {
      month: "2026-05",
      totalsByCurrency: {
        USD: { income: 0, expense: 190.9, net: -190.9 }
      }
    }
  ]);
  assert.equal(summary.totalsByCurrency.USD.expense, 190.9);
});

test("fetchWiseStatementEntries loads profiles, balances, and compact statements", async () => {
  const urls = [];
  const result = await fetchWiseStatementEntries({
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    apiToken: "wise-token",
    profileId: "123",
    baseUrl: "https://api.example.com",
    fetchImpl: async (url, options) => {
      urls.push(String(url));
      assert.equal(options.headers.Authorization, "Bearer wise-token");
      if (String(url).endsWith("/v2/profiles")) {
        return {
          ok: true,
          async json() {
            return [{ id: 123 }];
          }
        };
      }
      if (String(url).includes("/v4/profiles/123/balances")) {
        return {
          ok: true,
          async json() {
            return [{ id: "balance-1", currency: "EUR" }];
          }
        };
      }
      assert.match(String(url), /intervalStart=2026-04-01T00%3A00%3A00.000Z/);
      assert.match(String(url), /intervalEnd=2026-04-02T23%3A59%3A59.000Z/);
      return {
        ok: true,
        async json() {
          return {
            transactions: [
              {
                type: "CREDIT",
                date: "2026-04-01T09:00:00.000Z",
                referenceNumber: "WISE-2",
                amount: { value: "20", currency: "EUR" },
                details: { description: "Client payment", type: "TRANSFER" }
              }
            ]
          };
        }
      };
    }
  });

  assert.equal(urls.length, 3);
  assert.deepEqual(result.balances, [
    {
      balanceId: "balance-1",
      channel: "трансервайз евро",
      currency: "EUR",
      amount: 0,
      amountUsd: ""
    }
  ]);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].direction, "income");
  assert.equal(result.entries[0].suggestedCategory, "servicein");
  assert.equal(result.entries[0].feeAmount, null);
  assert.equal(result.diagnostics.coverage.input_rows_count, 1);
  assert.equal(result.diagnostics.coverage.parsed_rows_count, 1);
  assert.equal(result.diagnostics.coverage.ledger_rows_count, 1);
  assert.equal(result.diagnostics.coverage.skipped_rows_count, 0);
  assert.equal(result.diagnostics.coverage.duplicate_rows_count, 0);
  assert.equal(result.diagnostics.coverage.needs_review_rows_count, 0);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.summary.totalsByCurrency.EUR, { income: 20, expense: 0, net: 20 });
});

test("fetchWiseBalances normalizes balance rows with channel and optional usd amount", async () => {
  const balances = await fetchWiseBalances({
    apiToken: "wise-token",
    profileId: "123",
    baseUrl: "https://api.example.com",
    fetchImpl: async (url, options) => {
      assert.equal(options.headers.Authorization, "Bearer wise-token");
      if (String(url).endsWith("/v2/profiles")) {
        return {
          ok: true,
          async json() {
            return [{ id: 123 }];
          }
        };
      }
      return {
        ok: true,
        async json() {
          return [
            {
              id: "balance-usd",
              currency: "USD",
              amount: { value: "150.55", currency: "USD" }
            },
            {
              id: "balance-eur",
              currency: "EUR",
              amount: { value: "80.25", currency: "EUR" },
              totalWorth: { value: "91.50", currency: "USD" }
            }
          ];
        }
      };
    }
  });

  assert.deepEqual(balances, [
    {
      balanceId: "balance-usd",
      channel: "трансервайз дол",
      currency: "USD",
      amount: 150.55,
      amountUsd: 150.55
    },
    {
      balanceId: "balance-eur",
      channel: "трансервайз евро",
      currency: "EUR",
      amount: 80.25,
      amountUsd: 91.5
    }
  ]);
});
