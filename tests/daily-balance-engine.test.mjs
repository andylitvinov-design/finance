import test from "node:test";
import assert from "node:assert/strict";

import { buildDailyCurrencyBalances } from "../server/daily-balance-engine.js";

function operation(overrides = {}) {
  const row = {
    date: "2026-05-02",
    operation: "income",
    fromChannel: "",
    toChannel: "wise usd",
    amount: "300",
    currency: "USD",
    amountNet: "300",
    balanceAmount: 300,
    ledgerV2: {
      date: "2026-05-02",
      operation: "income",
      from_channel: "",
      to_channel: "wise usd",
      amount: "300",
      currency: "USD",
      amount_net: "300",
      balance_amount: 300,
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

test("same channel with USD and EUR produces separate daily balance rows", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ currency: "USD", ledgerV2: { currency: "USD", balance_amount: 100, amount_net: "100" } }),
      operation({ currency: "EUR", ledgerV2: { currency: "EUR", balance_amount: 200, amount_net: "200" } }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-01", channel: "wise usd", amount: "500", currency: "EUR" },
    ]
  );

  assert.deepEqual(
    result.rows.map((row) => ({ channel: row.channel, currency: row.currency, net_change: row.net_change })),
    [
      { channel: "wise usd", currency: "EUR", net_change: 200 },
      { channel: "wise usd", currency: "USD", net_change: 100 },
    ]
  );
});

test("opening plus income minus expense calculates closing balance", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ ledgerV2: { to_channel: "wise usd", currency: "USD", amount_net: "300", balance_amount: 300 } }),
      operation({
        operation: "expense",
        fromChannel: "wise usd",
        toChannel: "",
        amountNet: "50",
        balanceAmount: -50,
        ledgerV2: {
          operation: "expense",
          from_channel: "wise usd",
          to_channel: "",
          currency: "USD",
          amount_net: "50",
          balance_amount: -50,
        },
      }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "wise usd", amount: "1250", currency: "USD" },
    ]
  );

  assert.equal(result.rows.length, 1);
  assert.deepEqual(result.rows[0], {
    date: "2026-05-02",
    channel: "wise usd",
    currency: "USD",
    opening_balance: 1000,
    opening_balance_source: "manual",
    inflow: 300,
    outflow: 50,
    net_change: 250,
    closing_balance: 1250,
    provider_reported_balance: 1250,
    provider_reported_balance_source: "manual",
    difference: 0,
    status: "ok",
  });
});

test("auto Остатки factual provider balance is preserved as provider_auto source", () => {
  const result = buildDailyCurrencyBalances(
    [operation({ ledgerV2: { amount_net: "300", balance_amount: 300 } })],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD", source: "manual_fact" },
      { date: "2026-05-02", channel: "wise usd", amount: "1300", currency: "USD", source: "provider_auto", sourceSheet: "Авто Остатки" },
    ]
  );

  assert.equal(result.rows[0].provider_reported_balance, 1300);
  assert.equal(result.rows[0].provider_reported_balance_source, "provider_auto");
  assert.equal(result.rows[0].status, "ok");
});

test("missing amount_net row is excluded and counted", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ ledgerV2: { amount_net: "", balance_amount: 999 } }),
      operation({ ledgerV2: { amount_net: "10", balance_amount: 10 } }),
    ],
    [{ date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" }]
  );

  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].net_change, 10);
  assert.equal(result.summary.excluded_missing_amount_net_rows, 1);
});

test("exchange CAD out and USD in do not mix currencies", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({
        operation: "exchange_out",
        fromChannel: "td cad",
        toChannel: "wise usd",
        currency: "CAD",
        ledgerV2: {
          operation: "exchange",
          from_channel: "td cad",
          to_channel: "wise usd",
          currency: "CAD",
          amount_net: "100",
          balance_amount: -100,
        },
      }),
      operation({
        operation: "exchange_in",
        fromChannel: "td cad",
        toChannel: "wise usd",
        currency: "USD",
        ledgerV2: {
          operation: "exchange",
          from_channel: "td cad",
          to_channel: "wise usd",
          currency: "USD",
          amount_net: "73",
          balance_amount: 73,
        },
      }),
    ],
    [
      { date: "2026-05-01", channel: "td cad", amount: "1000", currency: "CAD" },
      { date: "2026-05-01", channel: "wise usd", amount: "500", currency: "USD" },
    ]
  );

  assert.deepEqual(
    result.rows.map((row) => ({
      channel: row.channel,
      currency: row.currency,
      net_change: row.net_change,
      closing_balance: row.closing_balance,
    })),
    [
      { channel: "td cad", currency: "CAD", net_change: -100, closing_balance: 900 },
      { channel: "wise usd", currency: "USD", net_change: 73, closing_balance: 573 },
    ]
  );
});

test("provider reported balance mismatch returns mismatch status and difference", () => {
  const result = buildDailyCurrencyBalances(
    [operation({ ledgerV2: { amount_net: "300", balance_amount: 300 } })],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "wise usd", amount: "1249", currency: "USD" },
    ]
  );

  assert.equal(result.rows[0].closing_balance, 1300);
  assert.equal(result.rows[0].provider_reported_balance, 1249);
  assert.equal(result.rows[0].difference, -51);
  assert.equal(result.rows[0].status, "mismatch");
  assert.equal(result.summary.mismatch_rows, 1);
});

test("Ostatki same-day date is treated as end-of-day provider reported balance", () => {
  const result = buildDailyCurrencyBalances(
    [operation({ ledgerV2: { amount_net: "300", balance_amount: 300 } })],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "wise usd", amount: "1300", currency: "USD" },
    ]
  );

  assert.equal(result.rows[0].opening_balance, 1000);
  assert.equal(result.rows[0].closing_balance, 1300);
  assert.equal(result.rows[0].provider_reported_balance, 1300);
  assert.equal(result.rows[0].status, "ok");
});

test("previous snapshot plus intervening movement produces next opening balance", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ date: "2026-05-02", ledgerV2: { date: "2026-05-02", amount_net: "300", balance_amount: 300 } }),
      operation({ date: "2026-05-03", ledgerV2: { date: "2026-05-03", amount_net: "20", balance_amount: 20 } }),
    ],
    [{ date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" }]
  );

  const may3 = result.rows.find((row) => row.date === "2026-05-03");
  assert.equal(may3.opening_balance, 1300);
  assert.equal(may3.closing_balance, 1320);
  assert.equal(may3.provider_reported_balance, null);
  assert.equal(may3.status, "missing_provider_balance");
});

test("missing opening balance does not create a false mismatch", () => {
  const result = buildDailyCurrencyBalances(
    [operation({ ledgerV2: { amount_net: "300", balance_amount: 300 } })],
    [{ date: "2026-05-02", channel: "wise usd", amount: "1300", currency: "USD" }]
  );

  assert.equal(result.rows[0].opening_balance, null);
  assert.equal(result.rows[0].closing_balance, null);
  assert.equal(result.rows[0].provider_reported_balance, 1300);
  assert.equal(result.rows[0].difference, null);
  assert.equal(result.rows[0].status, "missing_opening_balance");
});

test("summary includes status counts and top actionable rows", () => {
  const result = buildDailyCurrencyBalances(
    [
      operation({ date: "2026-05-02", ledgerV2: { date: "2026-05-02", amount_net: "300", balance_amount: 300 } }),
      operation({ date: "2026-05-03", ledgerV2: { date: "2026-05-03", amount_net: "20", balance_amount: 20 } }),
      operation({
        date: "2026-05-04",
        fromChannel: "broken usd",
        ledgerV2: {
          date: "2026-05-04",
          from_channel: "broken usd",
          to_channel: "",
          currency: "USD",
          amount_net: "1",
          balance_amount: -1,
        },
      }),
    ],
    [
      { date: "2026-05-01", channel: "wise usd", amount: "1000", currency: "USD" },
      { date: "2026-05-02", channel: "wise usd", amount: "1299", currency: "USD" },
      { date: "2026-05-04", channel: "broken usd", amount: "10", currency: "" },
    ]
  );

  assert.deepEqual(result.summary.status_counts, {
    ok: 0,
    mismatch: 1,
    missing_opening_balance: 0,
    missing_provider_balance: 1,
    needs_verification: 1,
  });
  assert.deepEqual(
    result.actionable_rows.map((row) => row.status),
    ["mismatch", "needs_verification", "missing_provider_balance"]
  );
});
