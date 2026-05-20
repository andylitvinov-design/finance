import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeWiseTransaction,
  summarizeWiseStatementEntries
} from "../api/wise-transactions.js";

const EUR_BALANCE = {
  balanceId: "eur-balance",
  currency: "EUR"
};

const USD_BALANCE = {
  balanceId: "usd-balance",
  currency: "USD"
};

test("Wise card refund keeps income direction when refund marker is present", () => {
  const entry = normalizeWiseTransaction({
    date: "2026-05-18T10:00:00.000Z",
    referenceNumber: "CARD-REFUND-YELLOWSQUARE-55-60",
    type: "CARD",
    amount: { value: 55.6, currency: "EUR" },
    details: {
      type: "CARD",
      description: "Refunded YellowSquare"
    }
  }, EUR_BALANCE, "profile-1");

  assert.equal(entry.direction, "income");
  assert.equal(entry.localAmount, 55.6);
  assert.equal(entry.netAmount, 55.6);
  assert.equal(entry.currency, "EUR");
  assert.equal(entry.channel, "трансервайз евро");
  assert.equal(entry.suggestedCategory, "serviceIncome");
});

test("Wise positive CARD transaction without refund marker remains expense", () => {
  const entry = normalizeWiseTransaction({
    date: "2026-05-08T12:00:00.000Z",
    referenceNumber: "CARD-3766611855",
    type: "CREDIT",
    amount: { value: "4.40", currency: "USD" },
    details: {
      description: "Card transaction at Bolt",
      type: "CARD"
    }
  }, USD_BALANCE, "profile-1");

  assert.equal(entry.sourceTransactionId, "CARD-3766611855");
  assert.equal(entry.direction, "expense");
  assert.equal(entry.suggestedCategory, "business");
  assert.equal(entry.localAmount, 4.4);
});

test("Wise card payment keeps expense direction from negative amount", () => {
  const entry = normalizeWiseTransaction({
    date: "2026-05-10T10:00:00.000Z",
    referenceNumber: "CARD-YELLOWSQUARE-102-96",
    type: "CARD",
    amount: { value: -102.96, currency: "EUR" },
    details: {
      type: "CARD",
      description: "Card payment to YellowSquare"
    }
  }, EUR_BALANCE, "profile-1");

  assert.equal(entry.direction, "expense");
  assert.equal(entry.localAmount, 102.96);
  assert.equal(entry.netAmount, 102.96);
  assert.equal(entry.currency, "EUR");
});

test("Wise summary nets card expense and refund instead of double-counting refunds as expense", () => {
  const entries = [
    normalizeWiseTransaction({
      date: "2026-05-01T10:00:00.000Z",
      referenceNumber: "CARD-YELLOWSQUARE-55-60",
      type: "CARD",
      amount: { value: -55.6, currency: "EUR" },
      details: { type: "CARD", description: "Card payment to YellowSquare" }
    }, EUR_BALANCE, "profile-1", 0),
    normalizeWiseTransaction({
      date: "2026-05-18T10:00:00.000Z",
      referenceNumber: "CARD-REFUND-YELLOWSQUARE-55-60",
      type: "CARD",
      amount: { value: 55.6, currency: "EUR" },
      details: { type: "CARD", description: "Refunded YellowSquare" }
    }, EUR_BALANCE, "profile-1", 1),
    normalizeWiseTransaction({
      date: "2026-05-10T10:00:00.000Z",
      referenceNumber: "CARD-YELLOWSQUARE-102-96",
      type: "CARD",
      amount: { value: -102.96, currency: "EUR" },
      details: { type: "CARD", description: "Card payment to YellowSquare" }
    }, EUR_BALANCE, "profile-1", 2),
    normalizeWiseTransaction({
      date: "2026-05-18T10:00:00.000Z",
      referenceNumber: "CARD-REFUND-YELLOWSQUARE-102-96",
      type: "CARD",
      amount: { value: 102.96, currency: "EUR" },
      details: { type: "CARD", description: "Refunded YellowSquare" }
    }, EUR_BALANCE, "profile-1", 3)
  ];

  const summary = summarizeWiseStatementEntries(entries);

  assert.deepEqual(summary.totalsByCurrency.EUR, {
    income: 158.56,
    expense: 158.56,
    net: 0
  });
});
