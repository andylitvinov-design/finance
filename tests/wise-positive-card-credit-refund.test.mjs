import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWiseTransaction,
  summarizeWiseStatementEntries
} from "../api/wise-transactions.js";

const EUR_BALANCE = { balanceId: "eur-balance", currency: "EUR" };
const USD_BALANCE = { balanceId: "usd-balance", currency: "USD" };

test("Wise positive CARD credit without purchase wording is refund income", () => {
  const entry = normalizeWiseTransaction({
    date: "2026-05-18T10:00:00.000Z",
    referenceNumber: "CARD-YELLOWSQUARE-CREDIT-55-60",
    type: "CREDIT",
    amount: { value: 55.6, currency: "EUR" },
    details: { type: "CARD", description: "YellowSquare" }
  }, EUR_BALANCE, "profile-1");

  assert.equal(entry.direction, "income");
  assert.equal(entry.localAmount, 55.6);
  assert.equal(entry.suggestedCategory, "serviceIncome");
});

test("Wise positive CARD credit with purchase wording remains expense", () => {
  const entry = normalizeWiseTransaction({
    date: "2026-05-08T12:00:00.000Z",
    referenceNumber: "CARD-3766611855",
    type: "CREDIT",
    amount: { value: 4.4, currency: "USD" },
    details: { type: "CARD", description: "Card transaction at Bolt" }
  }, USD_BALANCE, "profile-1");

  assert.equal(entry.direction, "expense");
  assert.equal(entry.localAmount, 4.4);
});

test("Wise YellowSquare card expense and positive card credit refunds net to zero", () => {
  const entries = [
    normalizeWiseTransaction({
      date: "2026-05-01T10:00:00.000Z",
      referenceNumber: "CARD-YELLOWSQUARE-55-60",
      type: "DEBIT",
      amount: { value: -55.6, currency: "EUR" },
      details: { type: "CARD", description: "Card payment to YellowSquare" }
    }, EUR_BALANCE, "profile-1", 0),
    normalizeWiseTransaction({
      date: "2026-05-18T10:00:00.000Z",
      referenceNumber: "CARD-YELLOWSQUARE-CREDIT-55-60",
      type: "CREDIT",
      amount: { value: 55.6, currency: "EUR" },
      details: { type: "CARD", description: "YellowSquare" }
    }, EUR_BALANCE, "profile-1", 1),
    normalizeWiseTransaction({
      date: "2026-05-10T10:00:00.000Z",
      referenceNumber: "CARD-YELLOWSQUARE-102-96",
      type: "DEBIT",
      amount: { value: -102.96, currency: "EUR" },
      details: { type: "CARD", description: "Card payment to YellowSquare" }
    }, EUR_BALANCE, "profile-1", 2),
    normalizeWiseTransaction({
      date: "2026-05-18T10:00:00.000Z",
      referenceNumber: "CARD-YELLOWSQUARE-CREDIT-102-96",
      type: "CREDIT",
      amount: { value: 102.96, currency: "EUR" },
      details: { type: "CARD", description: "YellowSquare" }
    }, EUR_BALANCE, "profile-1", 3)
  ];

  assert.deepEqual(summarizeWiseStatementEntries(entries).totalsByCurrency.EUR, {
    income: 158.56,
    expense: 158.56,
    net: 0
  });
});
