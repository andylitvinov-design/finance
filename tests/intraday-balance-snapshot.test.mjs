import test from "node:test";
import assert from "node:assert/strict";

import { buildDailyCurrencyBalances } from "../server/daily-balance-engine.js";
import { isIntradayBalanceComment } from "../server/manual-google-sheets.js";

function operation(overrides = {}) {
  const row = {
    date: "2026-05-19",
    operation: "income",
    fromChannel: "",
    toChannel: "Яндекс руб",
    amount: "420.51",
    currency: "RUB",
    amountNet: "420.51",
    balanceAmount: 420.51,
    ledgerV2: {
      date: "2026-05-19",
      operation: "income",
      from_channel: "",
      to_channel: "Яндекс руб",
      amount: "420.51",
      currency: "RUB",
      amount_net: "420.51",
      balance_amount: 420.51,
    },
  };
  return {
    ...row,
    ...overrides,
    ledgerV2: {
      ...row.ledgerV2,
      ...(overrides.ledgerV2 || {}),
    },
  };
}

test("intraday/not_eod comment marker is detected", () => {
  assert.equal(isIntradayBalanceComment("intraday/not_eod"), true);
  assert.equal(isIntradayBalanceComment("before movements"), true);
  assert.equal(isIntradayBalanceComment("owner-confirmed EOD balance"), false);
});

test("intraday balance row is not used as same-day EOD provider reported balance", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation(),
      operation({
        amount: "420.51",
        amountNet: "420.51",
        balanceAmount: 420.51,
        ledgerV2: { amount: "420.51", amount_net: "420.51", balance_amount: 420.51 },
      }),
    ],
    [
      { date: "2026-05-18", channel: "Яндекс руб", amount: "70203.51", currency: "RUB" },
      {
        date: "2026-05-19",
        channel: "Яндекс руб",
        amount: "70203.51",
        currency: "RUB",
        comment: "intraday/not_eod: before two YooMoney deposits 420.51 + 420.51",
      },
    ]
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].opening_balance, 70203.51);
  assert.equal(result.rows[0].closing_balance, 71044.53);
  assert.equal(result.rows[0].provider_reported_balance, null);
  assert.equal(result.rows[0].difference, null);
  assert.equal(result.rows[0].status, "needs_verification");
  assert.equal(result.rows[0].provider_status, "intraday_not_eod");
  assert.equal(
    result.rows[0].provider_diagnostic,
    "Intraday/not-EOD balance snapshot ignored for EOD reconciliation"
  );
  assert.equal(result.summary.status_counts.needs_verification, 1);
  assert.equal(result.summary.status_counts.mismatch, 0);
});

test("intraday balance row is not used as next opening snapshot", () => {
  const result = buildDailyCurrencyBalances(
    [operation({ date: "2026-05-20", ledgerV2: { date: "2026-05-20", amount_net: "1", balance_amount: 1 } })],
    [
      {
        date: "2026-05-19",
        channel: "Яндекс руб",
        amount: "70203.51",
        currency: "RUB",
        status: "intraday_not_eod",
      },
    ]
  );

  assert.equal(result.rows[0].opening_balance, null);
  assert.equal(result.rows[0].provider_reported_balance, null);
  assert.equal(result.rows[0].status, "missing_opening_balance");
});

test("unmarked same-day balance row still behaves as normal EOD fact", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation(),
      operation({
        amount: "420.51",
        amountNet: "420.51",
        balanceAmount: 420.51,
        ledgerV2: { amount: "420.51", amount_net: "420.51", balance_amount: 420.51 },
      }),
    ],
    [
      { date: "2026-05-18", channel: "Яндекс руб", amount: "70203.51", currency: "RUB" },
      { date: "2026-05-19", channel: "Яндекс руб", amount: "71044.53", currency: "RUB" },
    ]
  );

  assert.equal(result.rows[0].opening_balance, 70203.51);
  assert.equal(result.rows[0].closing_balance, 71044.53);
  assert.equal(result.rows[0].provider_reported_balance, 71044.53);
  assert.equal(result.rows[0].difference, 0);
  assert.equal(result.rows[0].status, "ok");
});

test("coverage mode ignores intraday row as EOD provider balance", () => {
  const result = buildDailyCurrencyBalances(
    [operation()],
    [
      { date: "2026-05-18", channel: "Яндекс руб", amount: "70203.51", currency: "RUB" },
      {
        date: "2026-05-19",
        channel: "Яндекс руб",
        amount: "70203.51",
        currency: "RUB",
        isIntraday: true,
      },
    ],
    { period: { from: "2026-05-19", to: "2026-05-19" }, activePairs: [{ channel: "Яндекс руб", currency: "RUB" }] }
  );

  const row = result.rows.find((candidate) => candidate.channel === "Яндекс руб" && candidate.currency === "RUB");
  assert.equal(row.provider_reported_balance, null);
  assert.equal(row.difference, null);
  assert.equal(row.status, "needs_verification");
  assert.equal(row.provider_status, "needs_verification");
  assert.equal(row.provider_diagnostic, "Intraday/not-EOD balance snapshot ignored for EOD reconciliation");
  assert.equal(result.summary.status_counts.needs_verification, 1);
});
