import test from "node:test";
import assert from "node:assert/strict";

import {
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
